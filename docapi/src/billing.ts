import crypto from "crypto";

/** What the app needs from the payment provider. Injected so tests can use a fake. */
export interface Billing {
  createCheckout(input: { variantId: string; email?: string; checkoutToken: string; redirectUrl: string }): Promise<string>;
  customerPortalUrl(subscriptionId: string): Promise<string | null>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

const API = "https://api.lemonsqueezy.com/v1";

export function createLemonSqueezy(options: { apiKey: string; storeId: string; webhookSecret: string }): Billing {
  const headers = {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${options.apiKey}`,
  };

  async function call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${API}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`Lemon Squeezy ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  return {
    async createCheckout({ variantId, email, checkoutToken, redirectUrl }) {
      const body = {
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: { ...(email ? { email } : {}), custom: { checkout_token: checkoutToken } },
            product_options: { redirect_url: redirectUrl },
          },
          relationships: {
            store: { data: { type: "stores", id: options.storeId } },
            variant: { data: { type: "variants", id: variantId } },
          },
        },
      };
      const json = await call("/checkouts", { method: "POST", body: JSON.stringify(body) });
      return json.data.attributes.url as string;
    },

    async customerPortalUrl(subscriptionId) {
      const json = await call(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
      return (json.data?.attributes?.urls?.customer_portal as string | undefined) ?? null;
    },

    verifyWebhook(rawBody, signature) {
      const digest = Buffer.from(crypto.createHmac("sha256", options.webhookSecret).update(rawBody).digest("hex"), "utf8");
      const given = Buffer.from(signature, "utf8");
      return digest.length === given.length && crypto.timingSafeEqual(digest, given);
    },
  };
}

/** Subscription statuses that keep paid access. `cancelled` keeps access until the period ends (then `expired`). */
export const PAID_STATUSES = new Set(["active", "on_trial", "past_due", "cancelled"]);
