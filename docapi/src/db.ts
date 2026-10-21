import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Plan } from "./config.js";

export interface Account {
  id: number;
  email: string;
  plan: Plan;
  key_prefix: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  checkout_session_id: string | null;
  created_at: string;
}

export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateKey(): string {
  return `dk_live_${crypto.randomBytes(24).toString("base64url")}`;
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        plan TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT UNIQUE,
        checkout_session_id TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS accounts_email ON accounts(email);
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        month TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS usage_account_month ON usage(account_id, month);
    `);
  }

  /** Creates an account and returns it with its API key. The key is never stored, only its hash. */
  createAccount(input: {
    email: string;
    plan: Plan;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    checkoutSessionId?: string | null;
  }): { account: Account; key: string } {
    const key = generateKey();
    const result = this.db
      .prepare(
        `INSERT INTO accounts (email, plan, key_hash, key_prefix, stripe_customer_id, stripe_subscription_id, checkout_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.email,
        input.plan,
        hashKey(key),
        key.slice(0, 12),
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.checkoutSessionId ?? null,
      );
    return { account: this.getAccount(Number(result.lastInsertRowid))!, key };
  }

  getAccount(id: number): Account | undefined {
    return this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined;
  }

  findByKey(key: string): Account | undefined {
    return this.db.prepare(`SELECT * FROM accounts WHERE key_hash = ?`).get(hashKey(key)) as Account | undefined;
  }

  findFreeByEmail(email: string): Account | undefined {
    return this.db.prepare(`SELECT * FROM accounts WHERE email = ? AND plan = 'free' AND stripe_subscription_id IS NULL`).get(email) as
      | Account
      | undefined;
  }

  findByCheckoutSession(sessionId: string): Account | undefined {
    return this.db.prepare(`SELECT * FROM accounts WHERE checkout_session_id = ?`).get(sessionId) as Account | undefined;
  }

  setPlanBySubscription(subscriptionId: string, plan: Plan): boolean {
    return this.db.prepare(`UPDATE accounts SET plan = ? WHERE stripe_subscription_id = ?`).run(plan, subscriptionId).changes > 0;
  }

  /**
   * Atomically checks the monthly quota and reserves one document.
   * Returns the reservation id, or null when the quota is used up.
   */
  reserveUsage(accountId: number, docType: string, limit: number): number | null {
    const month = currentMonth();
    const reserve = this.db.transaction(() => {
      const { used } = this.db
        .prepare(`SELECT COUNT(*) AS used FROM usage WHERE account_id = ? AND month = ? AND status != 'failed'`)
        .get(accountId, month) as { used: number };
      if (used >= limit) return null;
      const result = this.db
        .prepare(`INSERT INTO usage (account_id, month, doc_type, status) VALUES (?, ?, ?, 'pending')`)
        .run(accountId, month, docType);
      return Number(result.lastInsertRowid);
    });
    return reserve.immediate();
  }

  completeUsage(id: number, model: string, inputTokens: number, outputTokens: number): void {
    this.db
      .prepare(`UPDATE usage SET status = 'ok', model = ?, input_tokens = ?, output_tokens = ? WHERE id = ?`)
      .run(model, inputTokens, outputTokens, id);
  }

  /** Failed extractions don't count against the quota. */
  failUsage(id: number): void {
    this.db.prepare(`UPDATE usage SET status = 'failed' WHERE id = ?`).run(id);
  }

  usedThisMonth(accountId: number): number {
    const { used } = this.db
      .prepare(`SELECT COUNT(*) AS used FROM usage WHERE account_id = ? AND month = ? AND status != 'failed'`)
      .get(accountId, currentMonth()) as { used: number };
    return used;
  }

  close(): void {
    this.db.close();
  }
}
