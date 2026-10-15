import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Inject,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBody, ApiHeader } from "@nestjs/swagger";
import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import { createReadStream } from "node:fs";
import { resolve, basename } from "node:path";
import { AppServices } from "./services.js";
import {
  ensure,
  requireRole,
  type Scope,
} from "../../../packages/core/errors.js";
import {
  loginSchema,
  accountSchema,
  accountPatchSchema,
  modeSchema,
  sendSchema,
  agentSchema,
  userSchema,
  periodSchema,
  paginationSchema,
  uuid,
} from "../../../packages/contracts/index.js";
export type AuthRequest = FastifyRequest & {
  auth: { scope: Scope; csrfToken: string; email: string; displayName: string };
};
const id = (value: string) => uuid.parse(value);
function bodySchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: "input" });
  delete json.$schema;
  return ApiBody({ schema: json as import("@nestjs/swagger").SchemaObject });
}
@Controller("auth")
@ApiTags("Authentication")
export class AuthController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Post("login")
  @bodySchema(loginSchema)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = loginSchema.parse(body);
    const result = await this.s.identity.login(
      input.email,
      input.password,
      input.otp,
    );
    reply.setCookie("wa_session", result.token, {
      httpOnly: true,
      secure: this.s.config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 43200,
    });
    return { csrfToken: result.csrfToken };
  }
  @Get("me") async me(@Req() req: AuthRequest) {
    const mfaEnabled = await this.s.mfa.enabled(req.auth.scope.userId);
    return {
      ...req.auth.scope,
      email: req.auth.email,
      displayName: req.auth.displayName,
      csrfToken: req.auth.csrfToken,
      mfaEnabled,
      mfaRequired:
        this.s.config.NODE_ENV === "production" &&
        ["SUPER_ADMIN", "ORG_ADMIN", "INTEGRATION_MANAGER"].includes(
          req.auth.scope.role,
        ) &&
        !mfaEnabled,
    };
  }
  @Post("mfa/setup") async setup(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ password: z.string().min(1).max(256) })
      .parse(body);
    const result = await this.s.mfa.setup(
      req.auth.scope,
      input.password,
      req.auth.email,
    );
    return { image: await QRCode.toDataURL(result.uri) };
  }
  @Post("mfa/confirm") confirm(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = z.object({ otp: z.string().regex(/^\d{6}$/) }).parse(body);
    return this.s.mfa.confirm(req.auth.scope, input.otp);
  }
  @Post("logout") async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.s.identity.logout(req.cookies.wa_session ?? "");
    reply.clearCookie("wa_session", { path: "/" });
    return { loggedOut: true };
  }
}
@Controller("accounts")
@ApiTags("Accounts")
export class AccountsController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Get() list(@Req() req: AuthRequest) {
    return this.s.accounts.list(req.auth.scope);
  }
  @Post() @bodySchema(accountSchema) create(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.s.accounts.create(req.auth.scope, accountSchema.parse(body));
  }
  @Get(":id") get(@Req() req: AuthRequest, @Param("id") account: string) {
    return this.s.accounts.get(req.auth.scope, id(account));
  }
  @Patch(":id") @bodySchema(accountPatchSchema) patch(
    @Req() req: AuthRequest,
    @Param("id") account: string,
    @Body() body: unknown,
  ) {
    return this.s.accounts.patch(
      req.auth.scope,
      id(account),
      accountPatchSchema.parse(body),
    );
  }
  @Post(":id/connect") connect(
    @Req() req: AuthRequest,
    @Param("id") account: string,
  ) {
    return this.s.accounts.connection(req.auth.scope, id(account), true);
  }
  @Post(":id/disconnect") disconnect(
    @Req() req: AuthRequest,
    @Param("id") account: string,
  ) {
    return this.s.accounts.connection(req.auth.scope, id(account), false);
  }
  @Get(":id/status") status(
    @Req() req: AuthRequest,
    @Param("id") account: string,
  ) {
    return this.s.accounts.get(req.auth.scope, id(account));
  }
  @Get(":id/qr") async qr(
    @Req() req: AuthRequest,
    @Param("id") account: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const row = await this.s.accounts.qr(req.auth.scope, id(account));
    reply.header("Cache-Control", "no-store");
    return {
      expiresAt: row.expiresAt,
      image: row.qr
        ? await QRCode.toDataURL(this.s.cipher.decrypt(row.qr, `qr:${account}`))
        : null,
    };
  }
}
@Controller("conversations")
@ApiTags("Inbox")
export class ConversationsController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.s.conversations.list(
      req.auth.scope,
      paginationSchema
        .extend({
          accountId: uuid.optional(),
          mode: z.enum(["AI", "HUMAN", "ASSIST", "PAUSED"]).optional(),
          q: z.string().max(100).optional(),
        })
        .parse(query),
    );
  }
  @Get(":id") async get(
    @Req() req: AuthRequest,
    @Param("id") conversation: string,
  ) {
    requireRole(req.auth.scope, ["SUPERVISOR", "AGENT"]);
    return this.s.conversations.get(req.auth.scope, id(conversation));
  }
  @Get(":id/messages") messages(
    @Req() req: AuthRequest,
    @Param("id") conversation: string,
    @Query() query: unknown,
  ) {
    return this.s.conversations.messages(
      req.auth.scope,
      id(conversation),
      paginationSchema.parse(query),
    );
  }
  @Post(":id/messages")
  @bodySchema(sendSchema)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Unique operation key; reuse only for the same request.",
  })
  send(
    @Req() req: AuthRequest,
    @Param("id") conversation: string,
    @Body() body: unknown,
  ) {
    return this.s.conversations.send(
      req.auth.scope,
      id(conversation),
      sendSchema.parse(body),
      String(req.headers["idempotency-key"] ?? ""),
    );
  }
  @Patch(":id/mode") @bodySchema(modeSchema) mode(
    @Req() req: AuthRequest,
    @Param("id") conversation: string,
    @Body() body: unknown,
  ) {
    return this.s.conversations.mode(
      req.auth.scope,
      id(conversation),
      modeSchema.parse(body),
    );
  }
  @Post(":id/handoff") handoff(
    @Req() req: AuthRequest,
    @Param("id") conversation: string,
    @Body() body: unknown,
  ) {
    const input = modeSchema.omit({ mode: true }).parse(body);
    return this.s.conversations.mode(req.auth.scope, id(conversation), {
      ...input,
      mode: "HUMAN",
    });
  }
  @Patch(":id") details(
    @Req() req: AuthRequest,
    @Param("id") conversation: string,
    @Body() body: unknown,
  ) {
    return this.s.conversations.updateDetails(
      req.auth.scope,
      id(conversation),
      z
        .object({
          tags: z.array(z.string().max(30)).max(12).optional(),
          note: z.string().max(2000).optional(),
          close: z.boolean().optional(),
          expectedVersion: z.number().int().positive(),
        })
        .parse(body),
    );
  }
}
@Controller("agents")
@ApiTags("Agents")
export class AgentsController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Get() list(@Req() req: AuthRequest) {
    return this.s.agents.list(req.auth.scope);
  }
  @Post() @bodySchema(agentSchema) create(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.s.agents.save(req.auth.scope, agentSchema.parse(body));
  }
  @Post(":id/versions") @bodySchema(agentSchema) version(
    @Req() req: AuthRequest,
    @Param("id") agent: string,
    @Body() body: unknown,
  ) {
    return this.s.agents.save(
      req.auth.scope,
      agentSchema.parse(body),
      id(agent),
    );
  }
  @Post(":id/simulate")
  @ApiOperation({ summary: "Generate a reply without sending to WhatsApp" })
  async simulate(
    @Req() req: AuthRequest,
    @Param("id") agent: string,
    @Body() body: unknown,
  ) {
    requireRole(req.auth.scope, []);
    const input = z
      .object({ message: z.string().min(1).max(6000) })
      .parse(body);
    const rows = await this.s.agents.list(req.auth.scope);
    const selected = rows.find((row) => row.id === id(agent));
    ensure(selected, "agent_not_found", 404);
    ensure(
      this.s.providers.list().includes(String(selected.provider)),
      "provider_not_configured",
      409,
    );
    return this.s.orchestrator.simulate(String(selected.provider), {
      model: String(selected.model),
      messages: [
        { role: "system", content: String(selected.prompt) },
        { role: "user", content: input.message },
      ],
      maxOutputTokens: Number(selected.maxOutputTokens),
    });
  }
}
@Controller("llm")
@ApiTags("Models")
export class ModelsController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Get("providers") providers(@Req() req: AuthRequest) {
    requireRole(req.auth.scope, ["SUPERVISOR"]);
    return [
      { key: "openai", configured: this.s.providers.list().includes("openai") },
      { key: "local", configured: this.s.providers.list().includes("local") },
    ];
  }
  @Get("models") models(@Req() req: AuthRequest) {
    requireRole(req.auth.scope, ["SUPERVISOR"]);
    return [
      { provider: "openai", model: this.s.config.OPENAI_MODEL },
      ...(this.s.config.LOCAL_LLM_MODEL
        ? [{ provider: "local", model: this.s.config.LOCAL_LLM_MODEL }]
        : []),
    ];
  }
}
@Controller("reports")
@ApiTags("Reports")
export class ReportsController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Get("accounts/:id/overview") overview(
    @Req() req: AuthRequest,
    @Param("id") account: string,
    @Query() query: unknown,
  ) {
    return this.s.reports.overview(
      req.auth.scope,
      id(account),
      periodSchema.parse(query),
    );
  }
  @Get("accounts/:id/timeline") timeline(
    @Req() req: AuthRequest,
    @Param("id") account: string,
    @Query() query: unknown,
  ) {
    return this.s.reports.timeline(
      req.auth.scope,
      id(account),
      periodSchema.parse(query),
    );
  }
  @Get("accounts/:id/ai-usage") usage(
    @Req() req: AuthRequest,
    @Param("id") account: string,
    @Query() query: unknown,
  ) {
    return this.s.reports.aiUsage(
      req.auth.scope,
      id(account),
      periodSchema.parse(query),
    );
  }
  @Get("accounts/:id/reliability") reliability(
    @Req() req: AuthRequest,
    @Param("id") account: string,
    @Query() query: unknown,
  ) {
    return this.s.reports.reliability(
      req.auth.scope,
      id(account),
      periodSchema.parse(query),
    );
  }
  @Get("comparison") async comparison(
    @Req() req: AuthRequest,
    @Query() query: unknown,
  ) {
    const input = periodSchema
      .and(
        z.object({
          accountIds: z
            .string()
            .transform((s) => s.split(","))
            .pipe(z.array(uuid).min(1).max(10)),
        }),
      )
      .parse(query);
    return Promise.all(
      input.accountIds.map((account) =>
        this.s.reports.overview(req.auth.scope, account, input),
      ),
    );
  }
  @Post("exports") export(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = periodSchema
      .and(z.object({ accountId: uuid, format: z.enum(["csv", "xlsx"]) }))
      .parse(body);
    return this.s.reports.requestExport(
      req.auth.scope,
      input.accountId,
      input,
      input.format,
    );
  }
  @Get("exports") exports(@Req() req: AuthRequest) {
    return this.s.reports.exports(req.auth.scope);
  }
  @Get("exports/:id/download") async download(
    @Req() req: AuthRequest,
    @Param("id") exportId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.s.reports.exportFile(req.auth.scope, id(exportId));
    ensure(
      basename(file.storage_key) === file.storage_key,
      "invalid_storage_key",
    );
    reply
      .header(
        "Content-Disposition",
        `attachment; filename="report-${exportId}.${file.format}"`,
      )
      .header("Cache-Control", "no-store")
      .type(
        file.format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    return reply.send(
      createReadStream(resolve(this.s.config.STORAGE_PATH, file.storage_key)),
    );
  }
}
@Controller()
@ApiTags("Administration")
export class AdministrationController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Delete("contacts/:id") anonymize(
    @Req() req: AuthRequest,
    @Param("id") contact: string,
  ) {
    return this.s.contacts.anonymize(req.auth.scope, id(contact));
  }
  @Get("api-tokens") tokens(@Req() req: AuthRequest) {
    return this.s.tokens.list(req.auth.scope);
  }
  @Post("api-tokens") createToken(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        name: z.string().min(1).max(100),
        accountIds: z.array(uuid).min(1).max(100),
        days: z.number().int().min(1).max(365),
      })
      .parse(body);
    return this.s.tokens.create(
      req.auth.scope,
      input.name,
      input.accountIds,
      input.days,
    );
  }
  @Delete("api-tokens/:id") revokeToken(
    @Req() req: AuthRequest,
    @Param("id") token: string,
  ) {
    return this.s.tokens.revoke(req.auth.scope, id(token));
  }
  @Get("users") users(@Req() req: AuthRequest) {
    return this.s.admin.users(req.auth.scope);
  }
  @Post("users") @bodySchema(userSchema) createUser(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.s.admin.createUser(req.auth.scope, userSchema.parse(body));
  }
  @Patch("users/:id") updateUser(
    @Req() req: AuthRequest,
    @Param("id") user: string,
    @Body() body: unknown,
  ) {
    return this.s.admin.updateUser(
      req.auth.scope,
      id(user),
      z
        .object({
          active: z.boolean().optional(),
          accountIds: z.array(uuid).max(100).optional(),
        })
        .parse(body),
    );
  }
  @Get("roles") roles(@Req() req: AuthRequest) {
    requireRole(req.auth.scope, []);
    return [
      "ORG_ADMIN",
      "SUPERVISOR",
      "AGENT",
      "ANALYST",
      "INTEGRATION_MANAGER",
      "AUDITOR",
    ];
  }
  @Get("audit-logs") audits(@Req() req: AuthRequest) {
    return this.s.admin.auditLog(req.auth.scope);
  }
  @Get("settings") settings(@Req() req: AuthRequest) {
    return this.s.admin.settings(req.auth.scope);
  }
  @Patch("settings") updateSettings(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.s.admin.updateSettings(
      req.auth.scope,
      z.object({ automationEnabled: z.boolean() }).parse(body)
        .automationEnabled,
    );
  }
  @Get("integrations") integrations(@Req() req: AuthRequest) {
    return this.s.admin.integrations(req.auth.scope);
  }
  @Post("integrations/:id/test") test(@Req() req: AuthRequest) {
    requireRole(req.auth.scope, ["INTEGRATION_MANAGER"]);
    return { enabled: false, reason: "provider_not_configured" };
  }
  @Get("knowledge/documents") knowledge(
    @Req() req: AuthRequest,
    @Query("accountId") account: string,
  ) {
    return this.s.admin.knowledge(req.auth.scope, id(account));
  }
  @Post("knowledge/documents") saveKnowledge(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        accountId: uuid,
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(50000),
      })
      .parse(body);
    return this.s.admin.saveKnowledge(
      req.auth.scope,
      input.accountId,
      input.title,
      input.body,
    );
  }
  @Delete("knowledge/documents/:id") deleteKnowledge(
    @Req() req: AuthRequest,
    @Param("id") document: string,
  ) {
    return this.s.admin.deleteKnowledge(req.auth.scope, id(document));
  }
}
@Controller("health")
@ApiTags("Health")
export class HealthController {
  constructor(@Inject(AppServices) private readonly s: AppServices) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.s.db.query("SELECT 1");
    await this.s.queue.getJobCounts("waiting");
    return { status: "ready", database: true, redis: true };
  }
  @Get("system") async system(@Req() req: AuthRequest) {
    requireRole(req.auth.scope, []);
    const workers = await this.s.db.query(
      "SELECT kind,max(seen_at) AS \"lastSeenAt\",bool_or(seen_at>now()-interval '45 seconds') AS healthy FROM worker_heartbeats GROUP BY kind",
    );
    const queues = await this.s.queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
    );
    const [outbound] = await this.s.db.query(
      `SELECT count(*) FILTER(WHERE i.status='UNKNOWN_DELIVERY')::int AS unknown,count(*) FILTER(WHERE i.status='QUEUED')::int AS queued FROM outbound_intents i JOIN wa_accounts a ON a.id=i.account_id WHERE a.organization_id=$1`,
      [req.auth.scope.organizationId],
    );
    return {
      workers,
      queues,
      outbound,
      openaiConfigured: this.s.providers.list().includes("openai"),
    };
  }
}
export const controllers = [
  AuthController,
  AccountsController,
  ConversationsController,
  AgentsController,
  ModelsController,
  ReportsController,
  AdministrationController,
  HealthController,
];
