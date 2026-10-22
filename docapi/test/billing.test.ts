import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { Store } from "../src/db.js";
import { createLemonSqueezy, type Billing } from "../src/billing.js";

process.env.NODE_ENV = "test";

const SECRET = "whsec_test";
const real = createLemonSqueezy({ apiKey: "x", storeId: "1", webhookSecret: SECRET });

function signed(body: object) {
  const payload = JSON.stringify(body);
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return { payload, headers: { "content-type": "application/json", "x-signature": signature } };
}

function subscriptionEvent(name: string, attrs: Record<string, unknown>, token?: string) {
  return {
    meta: { event_name: name, ...(token ? { custom_data: { checkout_token: token } } : {}) },
    data: { type: "subscriptions", id: "sub_1", attributes: { variant_id: 111, customer_id: 9, user_email: "buyer@co.com", status: "active", ...attrs } },
  };
}

describe("Lemon Squeezy billing", () => {
  let app: FastifyInstance;
  let store: Store;
  let config: Config;
  let checkouts: { variantId: string; email?: string; checkoutToken: string; redirectUrl: string }[];

  beforeEach(() => {
    config = {
      ...loadConfig(),
      baseUrl: "https://api.example.com",
      lemonSqueezy: { apiKey: "x", storeId: "1", webhookSecret: SECRET, variantStarter: "111", variantPro: "222" },
    };
    store = new Store(":memory:");
    checkouts = [];
    const billing: Billing = {
      createCheckout: async (input) => {
        checkouts.push(input);
        return "https://docextract.lemonsqueezy.com/checkout/abc";
      },
      customerPortalUrl: async () => "https://docextract.lemonsqueezy.com/billing?signed",
      verifyWebhook: real.verifyWebhook,
    };
    app = buildApp({ config, store, extractor: async () => ({}) as never, billing });
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  it("verifies webhook signatures", () => {
    const { payload, headers } = signed({ a: 1 });
    expect(real.verifyWebhook(Buffer.from(payload), headers["x-signature"])).toBe(true);
    expect(real.verifyWebhook(Buffer.from(payload), "bad")).toBe(false);
    expect(real.verifyWebhook(Buffer.from(payload + " "), headers["x-signature"])).toBe(false);
  });

  it("rejects unsigned webhooks", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      payload: JSON.stringify(subscriptionEvent("subscription_created", {})),
      headers: { "content-type": "application/json", "x-signature": "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("runs the full purchase flow and shows the key once", async () => {
    const checkout = await app.inject({ method: "POST", url: "/billing/checkout", payload: { plan: "starter", email: "Buyer@Co.com" } });
    expect(checkout.statusCode).toBe(303);
    expect(checkout.headers.location).toBe("https://docextract.lemonsqueezy.com/checkout/abc");
    const { checkoutToken, variantId, email, redirectUrl } = checkouts[0];
    expect(variantId).toBe("111");
    expect(email).toBe("buyer@co.com");
    expect(redirectUrl).toBe(`https://api.example.com/billing/success?token=${checkoutToken}`);

    // Before the webhook: waiting page.
    let page = await app.inject({ method: "GET", url: `/billing/success?token=${checkoutToken}` });
    expect(page.body).toContain("Confirming your payment");

    const hook = await app.inject({ method: "POST", url: "/billing/webhook", ...signed(subscriptionEvent("subscription_created", {}, checkoutToken)) });
    expect(hook.statusCode).toBe(200);

    page = await app.inject({ method: "GET", url: `/billing/success?token=${checkoutToken}` });
    const key = page.body.match(/dk_live_[A-Za-z0-9_-]+/)?.[0];
    expect(key).toBeTruthy();
    const usage = await app.inject({ method: "GET", url: "/v1/usage", headers: { authorization: `Bearer ${key}` } });
    expect(usage.json()).toMatchObject({ plan: "starter", limit: 300 });

    // Second visit does not show the key again.
    page = await app.inject({ method: "GET", url: `/billing/success?token=${checkoutToken}` });
    expect(page.body).toContain("already shown");
    expect(page.body).not.toContain(key!);

    // Duplicate webhook does not create a second account.
    await app.inject({ method: "POST", url: "/billing/webhook", ...signed(subscriptionEvent("subscription_created", {}, checkoutToken)) });
    expect(store.stats().accounts_by_plan).toEqual([{ plan: "starter", accounts: 1 }]);

    // Upgrade to Pro, then expiry drops to free.
    await app.inject({ method: "POST", url: "/billing/webhook", ...signed(subscriptionEvent("subscription_updated", { variant_id: 222 })) });
    expect((await app.inject({ method: "GET", url: "/v1/usage", headers: { authorization: `Bearer ${key}` } })).json().plan).toBe("pro");

    await app.inject({ method: "POST", url: "/billing/webhook", ...signed(subscriptionEvent("subscription_cancelled", { variant_id: 222, status: "cancelled" })) });
    expect((await app.inject({ method: "GET", url: "/v1/usage", headers: { authorization: `Bearer ${key}` } })).json().plan).toBe("pro");

    await app.inject({ method: "POST", url: "/billing/webhook", ...signed(subscriptionEvent("subscription_expired", { variant_id: 222, status: "expired" })) });
    expect((await app.inject({ method: "GET", url: "/v1/usage", headers: { authorization: `Bearer ${key}` } })).json().plan).toBe("free");

    const portal = await app.inject({ method: "POST", url: "/v1/billing/portal", headers: { authorization: `Bearer ${key}` } });
    expect(portal.json().url).toContain("lemonsqueezy.com/billing");
  });

  it("creates the account even if an update arrives before the created event", async () => {
    await app.inject({ method: "POST", url: "/billing/checkout", payload: { plan: "pro" } });
    const token = checkouts[0].checkoutToken;
    await app.inject({ method: "POST", url: "/billing/webhook", ...signed(subscriptionEvent("subscription_updated", { variant_id: 222 }, token)) });
    const page = await app.inject({ method: "GET", url: `/billing/success?token=${token}` });
    expect(page.body).toMatch(/dk_live_/);
  });

  it("serves the legal pages", async () => {
    for (const path of ["/terms", "/privacy", "/refunds"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Lemon Squeezy");
    }
  });

  it("rejects unknown success links", async () => {
    expect((await app.inject({ method: "GET", url: "/billing/success?token=nope" })).statusCode).toBe(404);
  });
});
