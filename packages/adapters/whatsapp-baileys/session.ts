import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  proto,
  jidNormalizedUser,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import type { ContactIdentityPort } from "../../modules/contacts/public-api.js";
import { Database } from "../../persistence/database.js";
import { CredentialCipher } from "../../security/cipher.js";
import { logger } from "../../observability/logger.js";
import type { MessageIngestionPort } from "../../modules/messaging/public-api.js";
import type { SendOutcome } from "../../modules/messaging/domain/reply-policy.js";
import { SessionLeaseService } from "./lease.service.js";
import { DatabaseAuthStateStore } from "./auth-state.store.js";
import { normalizeMessage } from "./normalizer.js";
export class WhatsAppSession {
  private socket?: WASocket;
  private stopped = false;
  private connected = false;
  private failures = 0;
  private nextAttempt = 0;
  private tasks = Promise.resolve();
  private pendingEvents = 0;
  constructor(
    readonly accountId: string,
    readonly token: number,
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
    private readonly lease: SessionLeaseService,
    private readonly messages: MessageIngestionPort,
    private readonly identities: ContactIdentityPort,
  ) {}
  async start(): Promise<void> {
    if (this.stopped || this.socket || Date.now() < this.nextAttempt) return;
    const auth = await new DatabaseAuthStateStore(
      this.db,
      this.cipher,
      this.lease,
    ).load(this.accountId, this.token);
    const socket = makeWASocket({
      auth: auth.state,
      logger: logger.child({ module: "baileys", level: "silent" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 20000,
      defaultQueryTimeoutMs: 15000,
      getMessage: async (key) => {
        const [row] = await this.db.query<{
          raw_ciphertext: string | null;
          body: string;
        }>(
          "SELECT raw_ciphertext,body FROM messages WHERE account_id=$1 AND external_id=$2 LIMIT 1",
          [this.accountId, key.id],
        );
        if (!row) return undefined;
        return row.raw_ciphertext
          ? proto.Message.fromObject(
              JSON.parse(
                this.cipher.decrypt(
                  row.raw_ciphertext,
                  `message:${this.accountId}:${key.id}`,
                ),
                BufferJSON.reviver,
              ),
            )
          : { conversation: row.body };
      },
    });
    this.socket = socket;
    const enqueue = (fn: () => Promise<void>) => {
      if (this.stopped) return;
      if (this.pendingEvents >= 100) {
        this.stop();
        logger.error(
          { accountId: this.accountId },
          "gateway_event_backpressure",
        );
        return;
      }
      this.pendingEvents++;
      this.tasks = this.tasks
        .then(fn)
        .catch(async () => {
          logger.error({ accountId: this.accountId }, "gateway_event_failed");
          await this.status("DEGRADED", "event_persistence_failed").catch(
            () => {},
          );
          this.stop();
        })
        .finally(() => {
          this.pendingEvents--;
        });
    };
    socket.ev.on("creds.update", () => enqueue(auth.save));
    socket.ev.on("connection.update", (update) =>
      enqueue(() => this.connection(update)),
    );
    socket.ev.on("messages.upsert", (event) =>
      enqueue(async () => {
        for (const message of event.messages) {
          const input = normalizeMessage(
            this.accountId,
            message,
            event.type !== "notify",
          );
          if (input) await this.messages.receive(input);
        }
      }),
    );
    socket.ev.on("messaging-history.set", (event) =>
      enqueue(async () => {
        for (const message of event.messages) {
          const input = normalizeMessage(this.accountId, message, true);
          if (input) await this.messages.receive(input);
        }
      }),
    );
    socket.ev.on("messages.update", (events) =>
      enqueue(async () => {
        for (const event of events) {
          if (event.key.id && event.update.status && event.update.status >= 3)
            await this.messages.receipt(
              this.accountId,
              event.key.id,
              event.update.status >= 4 ? "READ" : "DELIVERED",
            );
        }
      }),
    );
    socket.ev.on("lid-mapping.update", (mapping) =>
      enqueue(() =>
        mapping.pn
          ? this.mapIdentity(mapping.lid, mapping.pn)
          : Promise.resolve(),
      ),
    );
  }
  private async connection(
    update: BaileysEventMap["connection.update"],
  ): Promise<void> {
    if (this.stopped) return;
    if (update.qr)
      await this.db.transaction(async (tx) => {
        await this.lease.assert(tx, this.accountId, this.token);
        await tx.query(
          "UPDATE wa_accounts SET qr=$2,qr_expires_at=now()+interval '45 seconds',status='QR_PENDING' WHERE id=$1",
          [
            this.accountId,
            this.cipher.encrypt(update.qr!, `qr:${this.accountId}`),
          ],
        );
      });
    if (update.connection === "open") {
      this.connected = true;
      this.failures = 0;
      await this.status("CONNECTED");
    }
    if (update.connection === "close") {
      this.connected = false;
      this.socket = undefined;
      const error = update.lastDisconnect?.error;
      const statusCode =
        error && "output" in error
          ? (error.output as { statusCode?: number })?.statusCode
          : undefined;
      if (statusCode === DisconnectReason.loggedOut) {
        await this.status("LOGGED_OUT", "relink_required");
        await this.db.query(
          "UPDATE wa_accounts SET enabled=false WHERE id=$1",
          [this.accountId],
        );
        this.stopped = true;
      } else {
        this.failures++;
        this.nextAttempt =
          Date.now() +
          Math.min(60000, 1000 * 2 ** Math.min(this.failures, 6)) +
          Math.random() * 1500;
        await this.status(
          this.failures >= 6 ? "DEGRADED" : "RECONNECTING",
          "temporary_disconnect",
        );
        if (this.failures >= 10) {
          this.stopped = true;
          await this.db.query(
            "UPDATE wa_accounts SET enabled=false WHERE id=$1",
            [this.accountId],
          );
        }
      }
    }
  }
  private async status(
    status: string,
    error: string | null = null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lease.assert(tx, this.accountId, this.token);
      const changed = await tx.query(
        "SELECT id FROM wa_accounts WHERE id=$1 AND status<>$2",
        [this.accountId, status],
      );
      await tx.query(
        "UPDATE wa_accounts SET status=$2,last_error=$3,last_seen_at=now(),qr=NULL WHERE id=$1",
        [this.accountId, status, error],
      );
      if (changed.rowCount)
        await tx.query(
          "INSERT INTO fact_session_events(account_id,state) VALUES($1,$2)",
          [this.accountId, status],
        );
    });
  }
  private async mapIdentity(lid: string, pn: string): Promise<void> {
    lid = jidNormalizedUser(lid);
    pn = jidNormalizedUser(pn);
    await this.identities.mapIdentity(this.accountId, lid, pn);
  }

  async send(jid: string, body: string): Promise<SendOutcome> {
    if (!this.connected || !this.socket || this.stopped)
      return { kind: "REJECTED", code: "account_disconnected" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.socket.sendMessage(jid, { text: body }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            this.stop();
            reject(new Error("send_timeout"));
          }, 15000);
        }),
      ]);
      return result?.key.id
        ? { kind: "ACCEPTED", externalMessageId: result.key.id }
        : { kind: "UNKNOWN", reason: "missing_ack" };
    } catch {
      return { kind: "UNKNOWN", reason: "network_outcome_uncertain" };
    } finally {
      clearTimeout(timer);
    }
  }
  stop(): void {
    this.stopped = true;
    this.connected = false;
    this.socket?.end(new Error("session_stopped"));
    this.socket = undefined;
  }
  async drain(): Promise<void> {
    this.stop();
    await this.tasks;
  }
  get terminal(): boolean {
    return this.stopped;
  }
  get ready(): boolean {
    return this.connected && !this.stopped;
  }
}
