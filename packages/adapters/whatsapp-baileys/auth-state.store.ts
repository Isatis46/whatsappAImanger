import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationState,
  type SignalDataTypeMap,
  type SignalDataSet,
} from "@whiskeysockets/baileys";
import { Database } from "../../persistence/database.js";
import { CredentialCipher } from "../../security/cipher.js";
import { SessionLeaseService } from "./lease.service.js";
export class DatabaseAuthStateStore {
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
    private readonly lease: SessionLeaseService,
  ) {}
  async load(
    accountId: string,
    token: number,
  ): Promise<{ state: AuthenticationState; save: () => Promise<void> }> {
    const [row] = await this.db.query<{ ciphertext: string }>(
      "SELECT ciphertext FROM wa_auth_credentials WHERE account_id=$1",
      [accountId],
    );
    const creds: AuthenticationState["creds"] = row
      ? JSON.parse(
          this.cipher.decrypt(row.ciphertext, `auth:${accountId}`),
          BufferJSON.reviver,
        )
      : initAuthCreds();
    const state: AuthenticationState = {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          category: T,
          ids: string[],
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const rows = await this.db.query<{
            key_id: string;
            ciphertext: string;
          }>(
            "SELECT key_id,ciphertext FROM wa_auth_signal_keys WHERE account_id=$1 AND category=$2 AND key_id=ANY($3::text[])",
            [accountId, category, ids],
          );
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const key of rows) {
            let value = JSON.parse(
              this.cipher.decrypt(
                key.ciphertext,
                `key:${accountId}:${category}:${key.key_id}`,
              ),
              BufferJSON.reviver,
            );
            if (category === "app-state-sync-key")
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            result[key.key_id] = value as SignalDataTypeMap[T];
          }
          return result;
        },
        set: async (data: SignalDataSet) => {
          await this.db.transaction(async (tx) => {
            await this.lease.assert(tx, accountId, token);
            for (const [category, keys] of Object.entries(data))
              for (const [id, value] of Object.entries(keys ?? {})) {
                if (value === null)
                  await tx.query(
                    "DELETE FROM wa_auth_signal_keys WHERE account_id=$1 AND category=$2 AND key_id=$3",
                    [accountId, category, id],
                  );
                else
                  await tx.query(
                    "INSERT INTO wa_auth_signal_keys(account_id,category,key_id,ciphertext) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,category,key_id) DO UPDATE SET ciphertext=excluded.ciphertext",
                    [
                      accountId,
                      category,
                      id,
                      this.cipher.encrypt(
                        JSON.stringify(value, BufferJSON.replacer),
                        `key:${accountId}:${category}:${id}`,
                      ),
                    ],
                  );
              }
          });
        },
      },
    };
    const save = async () => {
      await this.db.transaction(async (tx) => {
        await this.lease.assert(tx, accountId, token);
        await tx.query(
          "INSERT INTO wa_auth_credentials(account_id,ciphertext) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=now()",
          [
            accountId,
            this.cipher.encrypt(
              JSON.stringify(creds, BufferJSON.replacer),
              `auth:${accountId}`,
            ),
          ],
        );
      });
    };
    await save();
    return { state, save };
  }
}
