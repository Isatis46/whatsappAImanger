import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import type { AppServices } from "./services.js";
import { isAdmin } from "../../../packages/core/errors.js";
export function realtime(server: HttpServer, s: AppServices) {
  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: s.config.APP_ORIGIN, credentials: true },
    transports: ["websocket"],
    maxHttpBufferSize: 10000,
    allowRequest: (req, callback) =>
      callback(
        null,
        !req.headers.origin || req.headers.origin === s.config.APP_ORIGIN,
      ),
  });
  io.use(async (socket, next) => {
    try {
      const cookies = Object.fromEntries(
        (socket.handshake.headers.cookie ?? "")
          .split(";")
          .map((v) => v.trim().split("=")),
      );
      const token = cookies.wa_session ?? "";
      await s.identity.authenticate(token);
      socket.data.token = token;
      socket.data.since = new Date();
      next();
    } catch {
      next(new Error("unauthenticated"));
    }
  });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const socket of io.sockets.sockets.values()) {
        try {
          const { scope } = await s.identity.authenticate(
            String(socket.data.token),
          );
          const since = socket.data.since as Date;
          const until = new Date();
          const events = await s.db.query<{
            id: string;
            event_type: string;
            account_id: string;
            aggregate_id: string;
          }>(
            `SELECT id,event_type,account_id,aggregate_id FROM outbox_events WHERE organization_id=$1 AND ($2 OR account_id=ANY($3::uuid[])) AND occurred_at>=$4 AND occurred_at<$5 ORDER BY occurred_at LIMIT 100`,
            [
              scope.organizationId,
              isAdmin(scope),
              scope.accountIds,
              since,
              until,
            ],
          );
          for (const event of events)
            socket.emit(`${event.event_type}.v1`, {
              eventId: event.id,
              accountId: event.account_id,
              aggregateId: event.aggregate_id,
            });
          socket.emit("sync", { at: until.toISOString() });
          socket.data.since = until;
        } catch {
          socket.disconnect(true);
        }
      }
    } finally {
      busy = false;
    }
  }, 3000);
  timer.unref();
  return {
    close: () => {
      clearInterval(timer);
      io.close();
    },
  };
}
