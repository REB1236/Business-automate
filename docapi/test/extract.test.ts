import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runChecks } from "../src/checks.js";
import { createClaudeExtractor, estimateCost } from "../src/extract.js";

const goodInvoice = {
  invoice_number: "NW-1",
  line_items: [
    { description: "Paper", quantity: 10, unit_price: 24, tax_rate: 20, amount: 240 },
    { description: "Toner", quantity: 2, unit_price: 89.5, tax_rate: 20, amount: 179 },
  ],
  subtotal: 419,
  tax_total: 83.8,
  total: 502.8,
};

describe("runChecks", () => {
  it("passes a consistent invoice", () => {
    const checks = runChecks("invoice", goodInvoice);
    expect(checks.length).toBe(4);
    expect(checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("flags a wrong total", () => {
    const checks = runChecks("invoice", { ...goodInvoice, total: 600 });
    expect(checks.find((c) => c.name === "subtotal_plus_tax_equals_total")?.status).toBe("fail");
  });

  it("accepts line amounts printed with tax included", () => {
    const checks = runChecks("invoice", {
      line_items: [{ quantity: 1, unit_price: 100, tax_rate: 20, amount: 120 }],
      subtotal: 100,
      tax_total: 20,
      total: 120,
    });
    expect(checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("skips checks when values are missing", () => {
    expect(runChecks("invoice", { line_items: [{ quantity: null, unit_price: 1, amount: 1 }], subtotal: null, tax_total: null, total: 5 })).toEqual([]);
  });

  it("reconciles a bank statement", () => {
    const statement = {
      opening_balance: 1000,
      closing_balance: 1150,
      total_credits: 300,
      total_debits: -150,
      transactions: [{ amount: 300 }, { amount: -100 }, { amount: -50 }],
    };
    expect(runChecks("bank_statement", statement).every((c) => c.status === "pass")).toBe(true);
    expect(runChecks("bank_statement", { ...statement, closing_balance: 1200 }).find((c) => c.name === "balance_reconciles")?.status).toBe("fail");
  });

  it("checks the filled part of an auto result", () => {
    const auto = { document_type: "invoice", invoice: { ...goodInvoice, total: 1 }, purchase_order: null, bank_statement: null };
    expect(runChecks("auto", auto).some((c) => c.status === "fail")).toBe(true);
    expect(runChecks("auto", { document_type: "invoice", invoice: null })[0].status).toBe("fail");
  });
});

function fakeClient(answers: Record<string, { data: unknown; stop?: string }>, calls: { model: string; fallbacks?: unknown }[]) {
  return {
    beta: {
      messages: {
        parse: async (params: { model: string; fallbacks?: unknown }) => {
          calls.push({ model: params.model, fallbacks: params.fallbacks });
          const answer = answers[params.model];
          return {
            model: params.model,
            stop_reason: answer.stop ?? "end_turn",
            parsed_output: answer.data,
            usage: { input_tokens: 3000, output_tokens: 800 },
          };
        },
      },
    },
  } as unknown as Anthropic;
}

const input = { file: Buffer.from("%PDF"), mediaType: "application/pdf" as const, docType: "invoice" as const };

describe("cheap-first extraction", () => {
  it("keeps the cheap answer when checks pass", async () => {
    const calls: { model: string; fallbacks?: unknown }[] = [];
    const extract = createClaudeExtractor({
      model: "claude-haiku-5-5",
      effort: "low",
      escalationModel: "claude-opus-5-5",
      client: fakeClient({ "claude-haiku-5-5": { data: goodInvoice } }, calls),
    });
    const result = await extract(input);
    expect(calls.map((c) => c.model)).toEqual(["claude-haiku-5-5"]);
    expect(calls[0].fallbacks).toBeUndefined();
    expect(result.escalated).toBe(false);
    expect(result.costUsd).toBeCloseTo(estimateCost("claude-haiku-5-5", 3000, 800));
  });

  it("escalates to the strong model when a check fails", async () => {
    const calls: { model: string; fallbacks?: unknown }[] = [];
    const extract = createClaudeExtractor({
      model: "claude-haiku-5-5",
      effort: "low",
      escalationModel: "claude-opus-5-5",
      client: fakeClient(
        { "claude-haiku-5-5": { data: { ...goodInvoice, total: 999 } }, "claude-opus-5-5": { data: goodInvoice } },
        calls,
      ),
    });
    const result = await extract(input);
    expect(calls.map((c) => c.model)).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(calls[1].fallbacks).toBe("default");
    expect(result.escalated).toBe(true);
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.checks.every((c) => c.status === "pass")).toBe(true);
    expect(result.costUsd).toBeCloseTo(estimateCost("claude-haiku-5-5", 3000, 800) + estimateCost("claude-opus-5-5", 3000, 800));
  });

  it("escalates when the cheap model declines", async () => {
    const calls: { model: string }[] = [];
    const extract = createClaudeExtractor({
      model: "claude-haiku-5-5",
      effort: "low",
      escalationModel: "claude-opus-5-5",
      client: fakeClient({ "claude-haiku-5-5": { data: null, stop: "refusal" }, "claude-opus-5-5": { data: goodInvoice } }, calls),
    });
    const result = await extract(input);
    expect(result.model).toBe("claude-opus-5-5");
  });

  it("does not escalate when escalation is off", async () => {
    const calls: { model: string }[] = [];
    const extract = createClaudeExtractor({
      model: "claude-haiku-5-5",
      effort: "low",
      client: fakeClient({ "claude-haiku-5-5": { data: { ...goodInvoice, total: 999 } } }, calls),
    });
    const result = await extract(input);
    expect(calls.length).toBe(1);
    expect(result.checks.some((c) => c.status === "fail")).toBe(true);
  });
});
