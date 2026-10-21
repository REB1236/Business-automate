import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import formbody from "@fastify/formbody";
import Stripe from "stripe";
import crypto from "crypto";
import type { Config, Plan } from "./config.js";
import type { Account, Store } from "./db.js";
import { DOC_TYPES, type DocType } from "./schemas.js";
import { ExtractionError, SUPPORTED_MEDIA_TYPES, type Extractor, type MediaType } from "./extract.js";
import { keyPage, landingPage, messagePage } from "./pages.js";

export interface AppDeps {
  config: Config;
  store: Store;
  extractor: Extractor;
  stripe?: Stripe | null;
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

export function buildApp({ config, store, extractor, stripe = null }: AppDeps): FastifyInstance {
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

  const priceToPlan = new Map<string, Plan>();
  if (config.stripe.priceStarter) priceToPlan.set(config.stripe.priceStarter, "starter");
  if (config.stripe.pricePro) priceToPlan.set(config.stripe.pricePro, "pro");
  const billingEnabled = Boolean(stripe && config.stripe.priceStarter && config.stripe.pricePro);

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

  // ─── Billing (Stripe) ────────────────────────────────────────

  app.post<{ Body: { plan?: string; email?: string } }>("/billing/checkout", async (request, reply) => {
    if (!billingEnabled || !stripe) return reply.code(503).type("text/html").send(messagePage(config, "Not available", "Paid plans are not open yet."));
    const plan = request.body?.plan;
    const price = plan === "starter" ? config.stripe.priceStarter : plan === "pro" ? config.stripe.pricePro : undefined;
    if (!price) return reply.code(400).type("text/html").send(messagePage(config, "Unknown plan", "Choose Starter or Pro."));
    const email = String(request.body?.email ?? "").trim().toLowerCase();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer_email: EMAIL_RE.test(email) ? email : undefined,
      success_url: `${config.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.baseUrl}/`,
    });
    return reply.redirect(session.url!, 303);
  });

  app.get<{ Querystring: { session_id?: string } }>("/billing/success", async (request, reply) => {
    reply.type("text/html");
    if (!stripe) return reply.code(503).send(messagePage(config, "Not available", "Paid plans are not open yet."));
    const sessionId = request.query.session_id;
    if (!sessionId) return reply.code(400).send(messagePage(config, "Missing session", "No checkout session was given."));

    if (store.findByCheckoutSession(sessionId)) {
      return reply.send(
        messagePage(config, "Key already issued", "The API key for this purchase was already shown. If you lost it, contact support."),
      );
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (session.status !== "complete" || session.payment_status !== "paid" || !session.subscription) {
      return reply.code(402).send(messagePage(config, "Payment not completed", "The payment is not complete yet. Refresh this page in a minute."));
    }
    const subscription = session.subscription as Stripe.Subscription;
    const plan = priceToPlan.get(subscription.items.data[0]?.price.id ?? "");
    if (!plan) return reply.code(500).send(messagePage(config, "Unknown plan", "Contact support with your receipt."));

    try {
      const { key } = store.createAccount({
        email: session.customer_details?.email ?? session.customer_email ?? "unknown",
        plan,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
        stripeSubscriptionId: subscription.id,
        checkoutSessionId: session.id,
      });
      return reply.send(keyPage(config, key, plan));
    } catch {
      // A concurrent visit created it first.
      return reply.send(messagePage(config, "Key already issued", "The API key for this purchase was already shown."));
    }
  });

  app.post("/v1/billing/portal", async (request, reply) => {
    const account = authenticate(request, reply);
    if (!account) return reply;
    if (!stripe || !account.stripe_customer_id) return reply.code(400).send({ error: "This key has no paid subscription." });
    const portal = await stripe.billingPortal.sessions.create({ customer: account.stripe_customer_id, return_url: `${config.baseUrl}/` });
    return { url: portal.url };
  });

  // The webhook needs the raw body to verify Stripe's signature.
  app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/billing/webhook", async (request, reply) => {
      if (!stripe || !config.stripe.webhookSecret) return reply.code(503).send();
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          request.body as Buffer,
          String(request.headers["stripe-signature"] ?? ""),
          config.stripe.webhookSecret,
        );
      } catch {
        return reply.code(400).send({ error: "Invalid signature" });
      }

      if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        const active = event.type === "customer.subscription.updated" && ["active", "trialing"].includes(subscription.status);
        const plan = active ? (priceToPlan.get(subscription.items.data[0]?.price.id ?? "") ?? "free") : "free";
        store.setPlanBySubscription(subscription.id, plan);
      }
      return { received: true };
    });
  });

  return app;
}
