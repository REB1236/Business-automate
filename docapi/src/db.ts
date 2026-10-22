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
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
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
    // Columns added after the first release.
    const columns = (this.db.prepare(`PRAGMA table_info(usage)`).all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes("cost_usd")) this.db.exec(`ALTER TABLE usage ADD COLUMN cost_usd REAL`);
    if (!columns.includes("escalated")) this.db.exec(`ALTER TABLE usage ADD COLUMN escalated INTEGER`);
    // Billing columns (databases created by the first release also have unused stripe_* columns).
    const accountColumns = (this.db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]).map((c) => c.name);
    if (!accountColumns.includes("billing_customer_id")) this.db.exec(`ALTER TABLE accounts ADD COLUMN billing_customer_id TEXT`);
    if (!accountColumns.includes("billing_subscription_id")) this.db.exec(`ALTER TABLE accounts ADD COLUMN billing_subscription_id TEXT`);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_billing_subscription ON accounts(billing_subscription_id);
      CREATE TABLE IF NOT EXISTS pending_checkouts (
        token TEXT PRIMARY KEY,
        plan TEXT NOT NULL,
        account_id INTEGER REFERENCES accounts(id),
        api_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** Creates an account and returns it with its API key. The key is never stored, only its hash. */
  createAccount(input: {
    email: string;
    plan: Plan;
    billingCustomerId?: string | null;
    billingSubscriptionId?: string | null;
  }): { account: Account; key: string } {
    const key = generateKey();
    const result = this.db
      .prepare(
        `INSERT INTO accounts (email, plan, key_hash, key_prefix, billing_customer_id, billing_subscription_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.email,
        input.plan,
        hashKey(key),
        key.slice(0, 12),
        input.billingCustomerId ?? null,
        input.billingSubscriptionId ?? null,
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
    return this.db.prepare(`SELECT * FROM accounts WHERE email = ? AND plan = 'free' AND billing_subscription_id IS NULL`).get(email) as
      | Account
      | undefined;
  }

  findBySubscription(subscriptionId: string): Account | undefined {
    return this.db.prepare(`SELECT * FROM accounts WHERE billing_subscription_id = ?`).get(subscriptionId) as Account | undefined;
  }

  setPlanBySubscription(subscriptionId: string, plan: Plan): boolean {
    return this.db.prepare(`UPDATE accounts SET plan = ? WHERE billing_subscription_id = ?`).run(plan, subscriptionId).changes > 0;
  }

  createPendingCheckout(token: string, plan: Plan): void {
    this.db.prepare(`INSERT INTO pending_checkouts (token, plan) VALUES (?, ?)`).run(token, plan);
  }

  getPendingCheckout(token: string): { token: string; plan: Plan; account_id: number | null; api_key: string | null } | undefined {
    return this.db.prepare(`SELECT token, plan, account_id, api_key FROM pending_checkouts WHERE token = ?`).get(token) as any;
  }

  /**
   * Called from the payment webhook: creates the paid account once per subscription and keeps
   * its key on the pending checkout until the buyer's success page shows it.
   */
  fulfillCheckout(input: {
    token: string | null;
    email: string;
    plan: Plan;
    customerId: string;
    subscriptionId: string;
  }): Account {
    return this.db.transaction(() => {
      const existing = this.findBySubscription(input.subscriptionId);
      if (existing) return existing;
      const { account, key } = this.createAccount({
        email: input.email,
        plan: input.plan,
        billingCustomerId: input.customerId,
        billingSubscriptionId: input.subscriptionId,
      });
      if (input.token) {
        this.db
          .prepare(`UPDATE pending_checkouts SET account_id = ?, api_key = ? WHERE token = ? AND account_id IS NULL`)
          .run(account.id, key, input.token);
      }
      return account;
    })();
  }

  /** Returns the key once, then forgets it. */
  revealCheckoutKey(token: string): string | null {
    return this.db.transaction(() => {
      const row = this.getPendingCheckout(token);
      if (!row?.api_key) return null;
      this.db.prepare(`UPDATE pending_checkouts SET api_key = NULL WHERE token = ?`).run(token);
      return row.api_key;
    })();
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

  completeUsage(id: number, r: { model: string; inputTokens: number; outputTokens: number; costUsd: number; escalated: boolean }): void {
    this.db
      .prepare(`UPDATE usage SET status = 'ok', model = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, escalated = ? WHERE id = ?`)
      .run(r.model, r.inputTokens, r.outputTokens, r.costUsd, r.escalated ? 1 : 0, id);
  }

  /** Cost and volume figures for the owner. */
  stats(month = currentMonth()) {
    const byType = this.db
      .prepare(
        `SELECT doc_type, COUNT(*) AS documents, ROUND(AVG(cost_usd), 6) AS avg_cost_usd, ROUND(SUM(cost_usd), 6) AS total_cost_usd,
                SUM(escalated) AS escalated, ROUND(AVG(input_tokens)) AS avg_input_tokens, ROUND(AVG(output_tokens)) AS avg_output_tokens
         FROM usage WHERE status = 'ok' AND month = ? GROUP BY doc_type`,
      )
      .all(month);
    const failed = (this.db.prepare(`SELECT COUNT(*) AS n FROM usage WHERE status = 'failed' AND month = ?`).get(month) as { n: number }).n;
    const accounts = this.db.prepare(`SELECT plan, COUNT(*) AS accounts FROM accounts GROUP BY plan`).all();
    return { month, documents_by_type: byType, failed_documents: failed, accounts_by_plan: accounts };
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
