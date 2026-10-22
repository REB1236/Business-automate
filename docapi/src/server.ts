import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { createClaudeExtractor } from "./extract.js";
import { buildApp } from "./app.js";
import { createLemonSqueezy } from "./billing.js";

const config = loadConfig();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const store = new Store(config.dbPath);
const app = buildApp({
  config,
  store,
  extractor: createClaudeExtractor({
    model: config.model,
    effort: config.effort,
    escalationModel: config.escalationModel,
    escalationEffort: config.escalationEffort,
  }),
  billing:
    config.lemonSqueezy.apiKey && config.lemonSqueezy.storeId && config.lemonSqueezy.webhookSecret
      ? createLemonSqueezy({
          apiKey: config.lemonSqueezy.apiKey,
          storeId: config.lemonSqueezy.storeId,
          webhookSecret: config.lemonSqueezy.webhookSecret,
        })
      : null,
});

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.log.info(
  config.adminToken ? `Admin stats enabled (token is ${config.adminToken.length} characters)` : "Admin stats disabled (ADMIN_TOKEN not set)",
);
const ls = config.lemonSqueezy;
app.log.info(
  ls.apiKey && ls.storeId && ls.webhookSecret && ls.variantStarter && ls.variantPro
    ? "Paid plans enabled (Lemon Squeezy)"
    : "Paid plans disabled (Lemon Squeezy not fully configured)",
);
app.log.info(`Models: ${config.model} (${config.effort}), escalation: ${config.escalationModel ?? "off"}`);

await app.listen({ port: config.port, host: "0.0.0.0" });
