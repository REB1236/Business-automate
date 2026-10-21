import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { buildApp, redactUrl } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { Store } from "../src/db.js";
import { ExtractionError, type Extractor } from "../src/extract.js";
import { SCHEMAS } from "../src/schemas.js";

process.env.NODE_ENV = "test";

function multipartBody(fields: Record<string, string>, file?: { name: string; type: string; content: Buffer }) {
  const boundary = "----testboundary";
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const pdf = { name: "invoice.pdf", type: "application/pdf", content: Buffer.from("%PDF-1.4 fake") };

describe("docapi", () => {
  let app: FastifyInstance;
  let store: Store;
  let config: Config;
  let extractor: Extractor;
  let calls: number;

  beforeEach(() => {
    config = { ...loadConfig(), dbPath: ":memory:", monthlyLimits: { free: 2, starter: 300, pro: 1000 } };
    store = new Store(":memory:");
    calls = 0;
    extractor = async ({ docType }) => {
      calls++;
      return {
        data: { invoice_number: "INV-1", docType },
        checks: [],
        model: "claude-haiku-5-5",
        escalated: false,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.000035,
      };
    };
    app = buildApp({ config, store, extractor: (input) => extractor(input) });
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  async function freeKey(email = "a@example.com"): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/v1/keys/free", payload: { email } });
    expect(res.statusCode).toBe(201);
    return res.json().api_key;
  }

  it("serves the landing page", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("/v1/extract");
  });

  it("creates one free key per email", async () => {
    const key = await freeKey();
    expect(key).toMatch(/^dk_live_/);
    const again = await app.inject({ method: "POST", url: "/v1/keys/free", payload: { email: "A@example.com" } });
    expect(again.statusCode).toBe(409);
    const bad = await app.inject({ method: "POST", url: "/v1/keys/free", payload: { email: "nope" } });
    expect(bad.statusCode).toBe(400);
  });

  it("rejects requests without a valid key", async () => {
    const body = multipartBody({ type: "invoice" }, pdf);
    const res = await app.inject({ method: "POST", url: "/v1/extract", ...body });
    expect(res.statusCode).toBe(401);
    const wrong = await app.inject({
      method: "POST",
      url: "/v1/extract",
      payload: body.payload,
      headers: { ...body.headers, authorization: "Bearer dk_live_wrong" },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("extracts a document and counts usage", async () => {
    const key = await freeKey();
    const body = multipartBody({ type: "invoice" }, pdf);
    const res = await app.inject({
      method: "POST",
      url: "/v1/extract",
      payload: body.payload,
      headers: { ...body.headers, authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      type: "invoice",
      data: { invoice_number: "INV-1", docType: "invoice" },
      checks: [],
      usage: { used: 1, limit: 2 },
    });

    const usage = await app.inject({ method: "GET", url: "/v1/usage", headers: { "x-api-key": key } });
    expect(usage.json()).toEqual({ plan: "free", used: 1, limit: 2 });
  });

  it("validates type and file", async () => {
    const key = await freeKey();
    const auth = { authorization: `Bearer ${key}` };

    const badType = multipartBody({ type: "receipt" }, pdf);
    let res = await app.inject({ method: "POST", url: "/v1/extract", payload: badType.payload, headers: { ...badType.headers, ...auth } });
    expect(res.statusCode).toBe(400);

    const noFile = multipartBody({ type: "invoice" });
    res = await app.inject({ method: "POST", url: "/v1/extract", payload: noFile.payload, headers: { ...noFile.headers, ...auth } });
    expect(res.statusCode).toBe(400);

    const txt = multipartBody({ type: "invoice" }, { name: "a.txt", type: "text/plain", content: Buffer.from("hi") });
    res = await app.inject({ method: "POST", url: "/v1/extract", payload: txt.payload, headers: { ...txt.headers, ...auth } });
    expect(res.statusCode).toBe(415);
    expect(calls).toBe(0);
  });

  it("enforces the monthly limit", async () => {
    const key = await freeKey();
    const send = () => {
      const body = multipartBody({ type: "auto" }, pdf);
      return app.inject({ method: "POST", url: "/v1/extract", payload: body.payload, headers: { ...body.headers, authorization: `Bearer ${key}` } });
    };
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
    expect(calls).toBe(2);
  });

  it("does not count failed extractions", async () => {
    const key = await freeKey();
    extractor = async () => {
      throw new ExtractionError("No structured data could be extracted from the document.");
    };
    const body = multipartBody({ type: "invoice" }, pdf);
    const res = await app.inject({
      method: "POST",
      url: "/v1/extract",
      payload: body.payload,
      headers: { ...body.headers, authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(422);
    const usage = await app.inject({ method: "GET", url: "/v1/usage", headers: { authorization: `Bearer ${key}` } });
    expect(usage.json().used).toBe(0);
  });

  it("returns 502 without counting when Claude fails", async () => {
    const key = await freeKey();
    extractor = async () => {
      throw new Error("network down");
    };
    const body = multipartBody({ type: "invoice" }, pdf);
    const res = await app.inject({
      method: "POST",
      url: "/v1/extract",
      payload: body.payload,
      headers: { ...body.headers, authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(502);
    expect(store.usedThisMonth(store.findByKey(key)!.id)).toBe(0);
  });

  it("keeps paid plans closed when Stripe is not configured", async () => {
    const res = await app.inject({ method: "POST", url: "/billing/checkout", payload: { plan: "starter", email: "a@b.co" } });
    expect(res.statusCode).toBe(503);
  });

  it("hides admin stats without the token and shows cost with it", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/stats" })).statusCode).toBe(404);
    await app.close();
    app = buildApp({ config: { ...config, adminToken: "secret-admin" }, store, extractor: (input) => extractor(input) });
    const key = await freeKey();
    const body = multipartBody({ type: "invoice" }, pdf);
    await app.inject({ method: "POST", url: "/v1/extract", payload: body.payload, headers: { ...body.headers, authorization: `Bearer ${key}` } });
    expect((await app.inject({ method: "GET", url: "/admin/stats", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(404);
    const res = await app.inject({ method: "GET", url: "/admin/stats", headers: { authorization: "Bearer secret-admin" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().documents_by_type[0]).toMatchObject({ doc_type: "invoice", documents: 1, avg_cost_usd: 0.000035 });
    const viaQuery = await app.inject({ method: "GET", url: "/admin/stats?token=secret-admin" });
    expect(viaQuery.statusCode).toBe(200);
  });

  it("redacts the admin token from logged URLs", () => {
    expect(redactUrl("/admin/stats?token=abc123&month=2026-10")).toBe("/admin/stats?token=REDACTED&month=2026-10");
    expect(redactUrl("/v1/usage")).toBe("/v1/usage");
  });

  it("builds a JSON schema for every document type", () => {
    for (const schema of Object.values(SCHEMAS)) {
      const format = betaZodOutputFormat(schema);
      expect(format.type).toBe("json_schema");
    }
  });
});
