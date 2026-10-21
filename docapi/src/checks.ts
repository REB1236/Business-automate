import type { DocType } from "./schemas.js";

export interface Check {
  name: string;
  status: "pass" | "fail";
  detail?: string;
}

type Num = number | null | undefined;

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.005);
}

const round = (n: number) => Math.round(n * 100) / 100;
const known = (...values: Num[]): boolean => values.every((v) => typeof v === "number");

interface LineLike {
  quantity?: Num;
  unit_price?: Num;
  tax_rate?: Num;
  amount?: Num;
}

interface TotalsLike {
  subtotal?: Num;
  tax_total?: Num;
  total?: Num;
}

function checkTotals(doc: TotalsLike, lines: LineLike[], checks: Check[]): void {
  lines.forEach((line, i) => {
    if (!known(line.quantity, line.unit_price, line.amount)) return;
    const net = line.quantity! * line.unit_price!;
    const gross = typeof line.tax_rate === "number" ? net * (1 + line.tax_rate / 100) : net;
    const ok = close(net, line.amount!) || close(gross, line.amount!);
    checks.push({
      name: `line_${i + 1}_amount`,
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : `quantity × unit_price = ${round(net)}, amount = ${line.amount}`,
    });
  });

  const amounts = lines.map((l) => l.amount);
  if (amounts.length > 0 && known(...amounts) && typeof doc.subtotal === "number") {
    const sum = (amounts as number[]).reduce((a, b) => a + b, 0);
    // Some documents print line amounts including tax; accept a match on the total too.
    const ok = close(sum, doc.subtotal) || (typeof doc.total === "number" && close(sum, doc.total));
    checks.push({
      name: "lines_sum_to_subtotal",
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : `sum of lines = ${round(sum)}, subtotal = ${doc.subtotal}`,
    });
  }

  if (known(doc.subtotal, doc.tax_total, doc.total)) {
    const ok = close(doc.subtotal! + doc.tax_total!, doc.total!);
    checks.push({
      name: "subtotal_plus_tax_equals_total",
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : `${doc.subtotal} + ${doc.tax_total} = ${round(doc.subtotal! + doc.tax_total!)}, total = ${doc.total}`,
    });
  }
}

interface StatementLike {
  opening_balance?: Num;
  closing_balance?: Num;
  total_credits?: Num;
  total_debits?: Num;
  transactions?: { amount?: Num }[];
}

function checkStatement(doc: StatementLike, checks: Check[]): void {
  const amounts = (doc.transactions ?? []).map((t) => t.amount);
  if (amounts.length === 0 || !known(...amounts)) return;
  const values = amounts as number[];

  if (known(doc.opening_balance, doc.closing_balance)) {
    const end = doc.opening_balance! + values.reduce((a, b) => a + b, 0);
    const ok = close(end, doc.closing_balance!);
    checks.push({
      name: "balance_reconciles",
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : `opening + transactions = ${round(end)}, closing = ${doc.closing_balance}`,
    });
  }
  if (typeof doc.total_credits === "number") {
    const credits = values.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const ok = close(credits, doc.total_credits);
    checks.push({ name: "credits_match", status: ok ? "pass" : "fail", detail: ok ? undefined : `sum = ${round(credits)}, printed = ${doc.total_credits}` });
  }
  if (typeof doc.total_debits === "number") {
    const debits = -values.filter((v) => v < 0).reduce((a, b) => a + b, 0);
    const ok = close(debits, Math.abs(doc.total_debits));
    checks.push({ name: "debits_match", status: ok ? "pass" : "fail", detail: ok ? undefined : `sum = ${round(debits)}, printed = ${doc.total_debits}` });
  }
}

/** Arithmetic consistency checks on extracted data. An empty list means nothing could be checked. */
export function runChecks(docType: DocType, data: any): Check[] {
  const checks: Check[] = [];
  if (!data || typeof data !== "object") return checks;

  if (docType === "auto") {
    const inner = data.document_type === "other" ? null : data[data.document_type];
    if (data.document_type !== "other" && !inner) {
      checks.push({ name: "document_type_matches_data", status: "fail" });
      return checks;
    }
    return inner ? runChecks(data.document_type, inner) : checks;
  }
  if (docType === "invoice") checkTotals(data, data.line_items ?? [], checks);
  if (docType === "purchase_order") checkTotals(data, data.items ?? [], checks);
  if (docType === "bank_statement") checkStatement(data, checks);
  return checks;
}
