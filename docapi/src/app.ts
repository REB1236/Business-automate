import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import formbody from "@fastify/formbody";
import crypto from "crypto";
import type { Config, Plan } from "./config.js";
import type { Account, Store } from "./db.js";
import { DOC_TYPES, type DocType } from "./schemas.js";
import { ExtractionError, SUPPORTED_MEDIA_TYPES, type Extractor, type MediaType } from "./extract.js";
import { keyPage, landingPage, legalPage, messagePage, pendingPage } from "./pages.js";
import { PAID_STATUSES, type Billing } from "./billing.js";

export interface AppDeps {
  config: Config;
  store: Store;
  extractor: Extractor;
  billing?: Billing | null;
}

export function redactUrl(url: string): string {
  return url.replace(/([?&]token=)[^&]*/g, "$1REDACTED");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_SIGNUPS_PER_IP_PER_DAY = 3;

export function buildApp({ config, store, extractor, billing = null }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : {
            serializers: {
              // Never write the admin token to the logs.
              req: (req) => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }),
            },
          },
    trustProxy: true,
  });
  app.register(formbody);
  app.register(multipart, { limits: { fileSize: config.maxFileBytes, files: 1, fields: 5 } });

  const ls = config.lemonSqueezy;
  const variantToPlan = new Map<string, Plan>();
  if (ls.variantStarter) variantToPlan.set(String(ls.variantStarter), "starter");
  if (ls.variantPro) variantToPlan.set(String(ls.variantPro), "pro");
  const billingEnabled = Boolean(billing && ls.variantStarter && ls.variantPro);

  const freeSignups = new Map<string, { day: string; count: number }>();

  function authenticate(request: FastifyRequest, reply: FastifyReply): Account | undefined {
    const header = request.headers.authorization;
    const key = header?.startsWith("Bearer ") ? header.slice(7).trim() : (request.headers["x-api-key"] as string | undefined);
    const account = key ? store.findByKey(key) : undefined;
    if (!account) {
      reply.code(401).send({ error: "Missing or invalid API key. Send it as 'Authorization: Bearer <key>'." });
      return undefined;
    }
    return account;
  }

  app.get("/", async (_request, reply) => reply.type("text/html").send(landingPage(config, billingEnabled)));
  app.get("/health", async () => ({ ok: true }));
  for (const page of ["terms", "privacy", "refunds"] as const) {
    app.get(`/${page}`, async (_request, reply) => reply.type("text/html").send(legalPage(config, page)));
  }

  // ─── API ─────────────────────────────────────────────────────

  app.post<{ Body: { email?: string } }>("/v1/keys/free", async (request, reply) => {
    const email = String(request.body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: "A valid email is required." });
    if (store.findFreeByEmail(email)) {
      return reply.code(409).send({ error: "A free key already exists for this email." });
    }
    const day = new Date().toISOString().slice(0, 10);
    const seen = freeSignups.get(request.ip);
    const count = seen && seen.day === day ? seen.count : 0;
    if (count >= FREE_SIGNUPS_PER_IP_PER_DAY) {
      return reply.code(429).send({ error: "Too many free keys created from this address today." });
    }
    freeSignups.set(request.ip, { day, count: count + 1 });

    const { key } = store.createAccount({ email, plan: "free" });
    return reply.code(201).send({ api_key: key, plan: "free", monthly_limit: config.monthlyLimits.free });
  });

  app.get("/v1/usage", async (request, reply) => {
    const account = authenticate(request, reply);
    if (!account) return reply;
    return { plan: account.plan, used: store.usedThisMonth(account.id), limit: config.monthlyLimits[account.plan] };
  });

  app.post("/v1/extract", async (request, reply) => {
    const account = authenticate(request, reply);
    if (!account) return reply;
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "Send the document as multipart/form-data with a 'file' field." });
    }

    let file: Buffer | undefined;
    let mediaType: string | undefined;
    let docType: string = "auto";
    try {
      for await (const part of request.parts()) {
        if (part.type === "file" && part.fieldname === "file") {
          file = await part.toBuffer();
          mediaType = part.mimetype;
        } else if (part.type === "field" && part.fieldname === "type") {
          docType = String(part.value);
        }
      }
    } catch (err) {
      if (err instanceof app.multipartErrors.RequestFileTooLargeError) {
        return reply.code(413).send({ error: `File too large. Maximum is ${config.maxFileBytes / 1024 / 1024} MB.` });
      }
      throw err;
    }

    if (!DOC_TYPES.includes(docType as DocType)) {
      return reply.code(400).send({ error: `'type' must be one of: ${DOC_TYPES.join(", ")}.` });
    }
    if (!file || file.length === 0) return reply.code(400).send({ error: "Missing 'file'." });
    if (!SUPPORTED_MEDIA_TYPES.includes(mediaType as MediaType)) {
      return reply.code(415).send({ error: `Unsupported file type. Use one of: ${SUPPORTED_MEDIA_TYPES.join(", ")}.` });
    }

    const limit = config.monthlyLimits[account.plan];
    const reservation = store.reserveUsage(account.id, docType, limit);
    if (reservation === null) {
      return reply.code(429).send({ error: `Monthly limit of ${limit} documents reached. Upgrade your plan or wait for next month.` });
    }

    try {
      const result = await extractor({ file, mediaType: mediaType as MediaType, docType: docType as DocType });
      store.completeUsage(reservation, result);
      return { type: docType, data: result.data, checks: result.checks, usage: { used: store.usedThisMonth(account.id), limit } };
    } catch (err) {
      store.failUsage(reservation);
      if (err instanceof ExtractionError) return reply.code(422).send({ error: err.message });
      request.log.error({ err }, "extraction failed");
      return reply.code(502).send({ error: "Extraction failed. This request was not counted. Please retry." });
    }
  });

  // Owner-only figures: documents, Claude cost and accounts for the month.
  // The token can also be passed as ?token=... so the page opens in a browser.
  app.get<{ Querystring: { month?: string; token?: string } }>("/admin/stats", async (request, reply) => {
    const header = request.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : (request.query.token ?? "");
    if (!config.adminToken || !safeEqual(given, config.adminToken)) return reply.code(404).send({ error: "Not found" });
    const month = /^\d{4}-\d{2}$/.test(request.query.month ?? "") ? request.query.month : undefined;
    return store.stats(month);
  });

  // ─── Billing (Lemon Squeezy) ─────────────────────────────────
  // Flow: checkout (with a random token) → Lemon Squeezy payment → webhook creates the account
  // and parks its key on the token → the buyer's success page shows the key once.

  app.post<{ Body: { plan?: string; email?: string } }>("/billing/checkout", async (request, reply) => {
    reply.type("text/html");
    if (!billingEnabled || !billing) return reply.code(503).send(messagePage(config, "Not available", "Paid plans are not open yet."));
    const plan = request.body?.plan;
    const variantId = plan === "starter" ? ls.variantStarter : plan === "pro" ? ls.variantPro : undefined;
    if (!variantId) return reply.code(400).send(messagePage(config, "Unknown plan", "Choose Starter or Pro."));
    const email = String(request.body?.email ?? "").trim().toLowerCase();

    const checkoutToken = crypto.randomBytes(24).toString("base64url");
    store.createPendingCheckout(checkoutToken, plan as Plan);
    const url = await billing.createCheckout({
      variantId,
      email: EMAIL_RE.test(email) ? email : undefined,
      checkoutToken,
      redirectUrl: `${config.baseUrl}/billing/success?token=${checkoutToken}`,
    });
    return reply.redirect(url, 303);
  });

  app.get<{ Querystring: { token?: string } }>("/billing/success", async (request, reply) => {
    reply.type("text/html");
    const token = request.query.token ?? "";
    const pending = token ? store.getPendingCheckout(token) : undefined;
    if (!pending) return reply.code(404).send(messagePage(config, "Unknown purchase", "This link is not valid."));
    if (!pending.account_id) return reply.send(pendingPage(config));
    const key = store.revealCheckoutKey(token);
    if (!key) {
      return reply.send(
        messagePage(config, "Key already shown", "The API key for this purchase was already shown. If you lost it, contact support."),
      );
    }
    return reply.send(keyPage(config, key, pending.plan));
  });

  app.post("/v1/billing/portal", async (request, reply) => {
    const account = authenticate(request, reply);
    if (!account) return reply;
    if (!billing || !account.billing_subscription_id) return reply.code(400).send({ error: "This key has no paid subscription." });
    const url = await billing.customerPortalUrl(account.billing_subscription_id);
    if (!url) return reply.code(502).send({ error: "Could not open the billing portal. Please retry." });
    return { url };
  });

  // The webhook needs the raw body to verify the signature.
  app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/billing/webhook", async (request, reply) => {
      if (!billing) return reply.code(503).send();
      const raw = request.body as Buffer;
      if (!billing.verifyWebhook(raw, String(request.headers["x-signature"] ?? ""))) {
        return reply.code(400).send({ error: "Invalid signature" });
      }

      const event = JSON.parse(raw.toString("utf8"));
      const name: string = event.meta?.event_name ?? "";
      if (!name.startsWith("subscription_") || event.data?.type !== "subscriptions") return { received: true };

      const subscriptionId = String(event.data.id);
      const attributes = event.data.attributes ?? {};
      const variantPlan = variantToPlan.get(String(attributes.variant_id));
      const plan: Plan = variantPlan && PAID_STATUSES.has(attributes.status) ? variantPlan : "free";

      // Create the account on the first paid event we see for this subscription (events can arrive out of order).
      if (!store.findBySubscription(subscriptionId) && variantPlan && plan !== "free") {
        store.fulfillCheckout({
          token: event.meta?.custom_data?.checkout_token ?? null,
          email: String(attributes.user_email ?? "unknown"),
          plan,
          customerId: String(attributes.customer_id ?? ""),
          subscriptionId,
        });
      } else {
        store.setPlanBySubscription(subscriptionId, plan);
      }
      return { received: true };
    });
  });

  return app;
}
