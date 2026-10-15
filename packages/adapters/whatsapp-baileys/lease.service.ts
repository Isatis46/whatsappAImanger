import { Database, type Connection } from "../../persistence/database.js";
export class SessionLeaseService {
  constructor(
    private readonly db: Database,
    readonly workerId: string,
  ) {}
  async acquire(accountId: string): Promise<number | null> {
    const [row] = await this.db.query<{ fencing_token: string }>(
      `INSERT INTO wa_session_leases(account_id,worker_id,lease_until) VALUES($1,$2,now()+interval '45 seconds') ON CONFLICT(account_id) DO UPDATE SET worker_id=$2,fencing_token=wa_session_leases.fencing_token+1,lease_until=now()+interval '45 seconds' WHERE wa_session_leases.lease_until<now() RETURNING fencing_token`,
      [accountId, this.workerId],
    );
    return row ? Number(row.fencing_token) : null;
  }
  async renew(accountId: string, token: number): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE wa_session_leases SET lease_until=now()+interval '45 seconds' WHERE account_id=$1 AND worker_id=$2 AND fencing_token=$3 AND lease_until>now() RETURNING account_id`,
      [accountId, this.workerId, token],
    );
    return rows.length === 1;
  }
  async assert(
    tx: Connection,
    accountId: string,
    token: number,
  ): Promise<void> {
    const result = await tx.query(
      "SELECT account_id FROM wa_session_leases WHERE account_id=$1 AND worker_id=$2 AND fencing_token=$3 AND lease_until>now() FOR UPDATE",
      [accountId, this.workerId, token],
    );
    if (!result.rowCount) throw new Error("lease_lost");
  }
  async release(accountId: string, token: number): Promise<void> {
    await this.db.query(
      "UPDATE wa_session_leases SET lease_until=now() WHERE account_id=$1 AND worker_id=$2 AND fencing_token=$3",
      [accountId, this.workerId, token],
    );
  }
}
