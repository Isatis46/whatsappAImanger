import { Database, audit } from "../../../persistence/database.js";
import {
  ensure,
  isAdmin,
  requireAccount,
  requireRole,
  type Scope,
} from "../../../core/errors.js";
export type Period = { from: string; to: string; timezone: string };
export class ReportingRepository {
  constructor(private readonly db: Database) {}
  async authorize(scope: Scope, accountId: string): Promise<void> {
    requireRole(scope, ["SUPERVISOR", "ANALYST"]);
    requireAccount(scope, accountId);
    const [account] = await this.db.query(
      "SELECT id FROM wa_accounts WHERE id=$1 AND organization_id=$2",
      [accountId, scope.organizationId],
    );
    ensure(account, "account_not_found", 404);
  }
  async overview(scope: Scope, accountId: string, period: Period) {
    await this.authorize(scope, accountId);
    const [counts] = await this.db.query(
      `SELECT count(*) FILTER(WHERE direction='INBOUND' AND NOT history)::int AS "inboundMessages",count(*) FILTER(WHERE direction='OUTBOUND' AND NOT history)::int AS "outboundMessages",count(DISTINCT conversation_id) FILTER(WHERE NOT history)::int AS "activeConversations",count(*) FILTER(WHERE history)::int AS "historyMessages",max(projected_at) AS "dataAsOf",max(event_time) AS "latestEventTime" FROM fact_messages WHERE account_id=$1 AND event_time>=$2 AND event_time<$3`,
      [accountId, period.from, period.to],
    );
    const [ai] = await this.db.query(
      `SELECT count(*)::int AS runs,count(*) FILTER(WHERE status='FAILED')::int AS failures,count(*) FILTER(WHERE status='STALE')::int AS cancelled,sum(input_tokens)::bigint AS "inputTokens",sum(output_tokens)::bigint AS "outputTokens",CASE WHEN count(*) FILTER(WHERE status IN ('SUCCEEDED','DRAFT','STALE') AND cost_minor IS NULL)>0 THEN NULL ELSE sum(cost_minor) END AS "costMinor",avg(latency_ms)::int AS "latencyMs" FROM agent_runs WHERE account_id=$1 AND started_at>=$2 AND started_at<$3`,
      [accountId, period.from, period.to],
    );
    const [conversations] = await this.db.query(
      `SELECT count(*)::int AS "newConversations",count(*) FILTER(WHERE EXISTS(SELECT 1 FROM conversation_activities ca WHERE ca.conversation_id=c.id AND ca.kind='mode.HUMAN'))::int AS "handedOff" FROM conversations c WHERE account_id=$1 AND opened_at>=$2 AND opened_at<$3`,
      [accountId, period.from, period.to],
    );
    const [response] = await this.db.query(
      `WITH times AS(SELECT c.id,extract(epoch FROM(min(m.event_time) FILTER(WHERE m.direction='OUTBOUND' AND m.source IN ('AI','HUMAN'))-min(m.event_time) FILTER(WHERE m.direction='INBOUND')))*1000 AS ms FROM conversations c JOIN messages m ON m.conversation_id=c.id AND NOT m.history WHERE c.account_id=$1 AND c.opened_at>=$2 AND c.opened_at<$3 GROUP BY c.id) SELECT count(*)::int AS "sampleCount",percentile_cont(0.5) WITHIN GROUP(ORDER BY ms) AS "p50Ms",percentile_cont(0.95) WITHIN GROUP(ORDER BY ms) AS "p95Ms" FROM times WHERE ms>=0`,
      [accountId, period.from, period.to],
    );
    const [delivery] = await this.db.query(
      `SELECT count(*) FILTER(WHERE status IN ('ACCEPTED','DELIVERED','READ'))::int AS accepted,count(*) FILTER(WHERE status IN ('DELIVERED','READ'))::int AS delivered,count(*) FILTER(WHERE status='UNKNOWN_DELIVERY')::int AS unknown,count(*) FILTER(WHERE status='FINAL_FAILURE')::int AS failed FROM outbound_intents WHERE account_id=$1 AND created_at>=$2 AND created_at<$3`,
      [accountId, period.from, period.to],
    );
    return {
      accountId,
      period,
      dataAsOf: counts?.dataAsOf ?? null,
      sampleCount:
        Number(counts?.inboundMessages ?? 0) +
        Number(counts?.outboundMessages ?? 0),
      metricVersion: "1.0",
      filtersApplied: period,
      metrics: counts,
      ai: { ...ai, currency: "USD" },
      conversations,
      response,
      delivery,
    };
  }
  async timeline(scope: Scope, accountId: string, period: Period) {
    await this.authorize(scope, accountId);
    return this.db.query(
      `SELECT to_char(event_time AT TIME ZONE $4,'YYYY-MM-DD') AS day,count(*) FILTER(WHERE direction='INBOUND')::int AS inbound,count(*) FILTER(WHERE direction='OUTBOUND')::int AS outbound FROM fact_messages WHERE account_id=$1 AND event_time>=$2 AND event_time<$3 AND NOT history GROUP BY day ORDER BY day`,
      [accountId, period.from, period.to, period.timezone],
    );
  }
  async aiUsage(scope: Scope, accountId: string, period: Period) {
    await this.authorize(scope, accountId);
    return this.db.query(
      `SELECT provider,model,status,count(*)::int AS runs,sum(input_tokens)::bigint AS "inputTokens",sum(output_tokens)::bigint AS "outputTokens",sum(cost_minor) AS "knownCostMinor",count(*) FILTER(WHERE cost_minor IS NULL)::int AS "unpricedRuns",avg(latency_ms)::int AS "latencyMs" FROM agent_runs WHERE account_id=$1 AND started_at>=$2 AND started_at<$3 GROUP BY provider,model,status`,
      [accountId, period.from, period.to],
    );
  }
  async reliability(scope: Scope, accountId: string, period: Period) {
    await this.authorize(scope, accountId);
    return this.db.query(
      `SELECT state,count(*)::int AS transitions FROM fact_session_events WHERE account_id=$1 AND occurred_at>=$2 AND occurred_at<$3 GROUP BY state`,
      [accountId, period.from, period.to],
    );
  }
  async requestExport(
    scope: Scope,
    accountId: string,
    period: Period,
    format: "csv" | "xlsx",
  ) {
    await this.authorize(scope, accountId);
    return this.db.transaction(async (tx) => {
      const [row] = await this.db.query<{ id: string }>(
        `INSERT INTO report_exports(organization_id,user_id,account_id,format,filters) VALUES($1,$2,$3,$4,$5) RETURNING id,state`,
        [scope.organizationId, scope.userId, accountId, format, period],
        tx,
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "report.export_requested",
        row!.id,
      );
      return row!;
    });
  }
  async exports(scope: Scope) {
    requireRole(scope, ["SUPERVISOR", "ANALYST"]);
    return this.db.query(
      `SELECT id,account_id AS "accountId",format,state,error_code AS "errorCode",created_at AS "createdAt",expires_at AS "expiresAt" FROM report_exports WHERE organization_id=$1 AND user_id=$2 AND ($3 OR account_id=ANY($4::uuid[])) ORDER BY created_at DESC LIMIT 30`,
      [scope.organizationId, scope.userId, isAdmin(scope), scope.accountIds],
    );
  }
  async exportFile(scope: Scope, id: string) {
    const [row] = await this.db.query<{
      account_id: string;
      storage_key: string;
      format: string;
    }>(
      `SELECT * FROM report_exports WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND state='READY' AND expires_at>now()`,
      [id, scope.organizationId, scope.userId],
    );
    ensure(row, "export_unavailable", 404);
    await this.authorize(scope, row.account_id);
    await audit(
      this.db.pool,
      scope.organizationId,
      scope.userId,
      "report.export_downloaded",
      id,
    );
    return row;
  }
}
