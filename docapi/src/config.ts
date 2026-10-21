export type Plan = "free" | "starter" | "pro";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Config {
  port: number;
  baseUrl: string;
  brandName: string;
  dbPath: string;
  model: string;
  effort: Effort;
  escalationModel?: string;
  escalationEffort: Effort;
  adminToken?: string;
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

/** Strips whitespace and wrapping quotes that hosting panels sometimes keep around a value. */
function cleanSecret(raw: string | undefined): string | undefined {
  const value = raw?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  return value || undefined;
}

function effort(name: string, fallback: Effort): Effort {
  const value = (process.env[name] || fallback) as Effort;
  if (!EFFORTS.includes(value)) throw new Error(`${name} must be one of ${EFFORTS.join(", ")}`);
  return value;
}

export function loadConfig(): Config {
  // ESCALATION_MODEL="" turns escalation off; unset keeps the default.
  const escalationModel = process.env.ESCALATION_MODEL ?? "claude-opus-5-5";
  return {
    port: int("PORT", 3000),
    baseUrl: (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    brandName: process.env.BRAND_NAME ?? "DocExtract",
    dbPath: process.env.DB_PATH ?? "data/docapi.db",
    model: process.env.MODEL || "claude-haiku-5-5",
    effort: effort("EFFORT", "low"),
    escalationModel: escalationModel || undefined,
    escalationEffort: effort("ESCALATION_EFFORT", "medium"),
    adminToken: cleanSecret(process.env.ADMIN_TOKEN),
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
