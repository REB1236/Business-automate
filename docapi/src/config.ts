export type Plan = "free" | "starter" | "pro";

export interface Config {
  port: number;
  baseUrl: string;
  brandName: string;
  dbPath: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxFileBytes: number;
  monthlyLimits: Record<Plan, number>;
  stripe: {
    secretKey?: string;
    webhookSecret?: string;
    priceStarter?: string;
    pricePro?: string;
  };
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadConfig(): Config {
  const effort = (process.env.EFFORT ?? "medium") as Config["effort"];
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error("EFFORT must be one of low, medium, high, xhigh, max");
  }
  return {
    port: int("PORT", 3000),
    baseUrl: (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    brandName: process.env.BRAND_NAME ?? "DocExtract",
    dbPath: process.env.DB_PATH ?? "data/docapi.db",
    model: process.env.MODEL ?? "claude-opus-5-5",
    effort,
    maxFileBytes: int("MAX_FILE_MB", 10) * 1024 * 1024,
    monthlyLimits: {
      free: int("LIMIT_FREE", 20),
      starter: int("LIMIT_STARTER", 300),
      pro: int("LIMIT_PRO", 1000),
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || undefined,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
      priceStarter: process.env.STRIPE_PRICE_STARTER || undefined,
      pricePro: process.env.STRIPE_PRICE_PRO || undefined,
    },
  };
}
