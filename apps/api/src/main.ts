import { readConfig } from "../../../packages/core/config.js";
import { logger } from "../../../packages/observability/logger.js";
import { createApp } from "./app.js";
import { realtime } from "./realtime.js";
const config = readConfig();
const { app, services } = await createApp(config);
await app.listen(config.PORT, "0.0.0.0");
const live = realtime(app.getHttpServer(), services);
logger.info({ port: config.PORT }, "api_started");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  live.close();
  await app.close();
  await services.close();
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
