import "reflect-metadata";
import {
  Module,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { FastifyReply } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { DomainError } from "../../../packages/core/errors.js";
import { Database } from "../../../packages/persistence/database.js";
import type { Config } from "../../../packages/core/config.js";
import { logger } from "../../../packages/observability/logger.js";
import { AppServices } from "./services.js";
import { controllers, type AuthRequest } from "./controllers.js";
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let code = "internal_error";
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
    } else if (error instanceof ZodError) {
      status = 400;
      code = "invalid_input";
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 404 ? "not_found" : "request_failed";
    } else if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["23505", "23503"].includes(String(error.code))
    ) {
      status = 409;
      code = "record_conflict";
    }
    if (status === 500)
      logger.error(
        { errorType: error instanceof Error ? error.name : "unknown" },
        "request_failed",
      );
    reply
      .status(status)
      .type("application/problem+json")
      .send({
        type: "about:blank",
        title: code,
        status,
        code,
        requestId: reply.request.id,
      });
  }
}
export async function createApp(config: Config) {
  const services = new AppServices(new Database(config.DATABASE_URL), config);
  @Module({
    controllers,
    providers: [{ provide: AppServices, useValue: services }],
  })
  class ApiModule {}
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter({
      bodyLimit: 100000,
      genReqId: () => randomUUID(),
      trustProxy: config.NODE_ENV === "production",
    }),
    { logger: false },
  );
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new ErrorFilter());
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: 240,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });
  const server = app.getHttpAdapter().getInstance();
  server.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-ID", req.id);
    const path = req.url.split("?")[0];
    if (req.method === "OPTIONS") return;
    if (req.headers.origin && req.headers.origin !== config.APP_ORIGIN) {
      reply.code(403).send({ code: "origin_not_allowed" });
      return;
    }
    if (
      path === "/api/v1/health/live" ||
      path === "/api/v1/health/ready" ||
      path === "/api/v1/auth/login"
    )
      return;
    try {
      if (req.headers.authorization?.startsWith("Bearer ")) {
        if (
          req.method !== "GET" ||
          !(
            path === "/api/v1/accounts" ||
            /^\/api\/v1\/reports\/(accounts\/[^/]+\/(overview|timeline|ai-usage|reliability)|comparison)$/.test(
              path ?? "",
            )
          )
        ) {
          reply.code(403).send({ code: "token_scope_forbidden" });
          return;
        }
        const scope = await services.tokens.authenticate(
          req.headers.authorization.slice(7),
        );
        (req as AuthRequest).auth = {
          scope,
          csrfToken: "",
          email: "",
          displayName: "API",
        };
        return;
      }
      const auth = await services.identity.authenticate(
        req.cookies.wa_session ?? "",
      );
      (req as AuthRequest).auth = auth;
      if (
        config.NODE_ENV === "production" &&
        ["SUPER_ADMIN", "ORG_ADMIN", "INTEGRATION_MANAGER"].includes(
          auth.scope.role,
        ) &&
        !(await services.mfa.enabled(auth.scope.userId)) &&
        !path?.startsWith("/api/v1/auth/") &&
        path !== "/api/v1/settings"
      ) {
        reply.code(403).send({ code: "mfa_enrollment_required" });
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        const value = String(req.headers["x-csrf-token"] ?? "");
        const a = Buffer.from(value);
        const b = Buffer.from(auth.csrfToken);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          reply.code(403).send({ code: "csrf_invalid" });
          return;
        }
      }
    } catch {
      reply.code(401).send({ code: "unauthenticated" });
    }
  });
  // Login has a separate brute-force budget in addition to the general IP limit.
  server.addHook("onRoute", (route) => {
    if (route.url === "/api/v1/auth/login")
      route.config = {
        ...route.config,
        rateLimit: { max: 10, timeWindow: "15 minutes" },
      };
  });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("WhatsApp AI Manager")
      .setVersion("1.0")
      .addCookieAuth("wa_session")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("api/v1/docs", app, document, {
    jsonDocumentUrl: "api/v1/openapi.json",
  });
  await app.init();
  await server.ready();
  return { app, services };
}
