import Stripe from "stripe";
import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { createClaudeExtractor } from "./extract.js";
import { buildApp } from "./app.js";

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
  stripe: config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null,
});

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
