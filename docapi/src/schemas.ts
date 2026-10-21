import { z } from "zod";

// Every field is nullable: the model returns null instead of guessing when a
// value is not printed on the document.
const str = z.string().nullable();
const num = z.number().nullable();

const Party = z.object({
  name: str,
  address: str,
  tax_id: str.describe("VAT number, tax ID, EIN, ICE or similar, as printed"),
  email: str,
  phone: str,
});

export const InvoiceSchema = z.object({
  invoice_number: str,
  issue_date: str.describe("YYYY-MM-DD"),
  due_date: str.describe("YYYY-MM-DD"),
  currency: str.describe("ISO 4217 code, e.g. USD, EUR, GBP, MAD"),
  seller: Party,
  buyer: Party,
  line_items: z.array(
    z.object({
      description: str,
      quantity: num,
      unit_price: num,
      tax_rate: num.describe("Percentage, e.g. 20 for 20%"),
      amount: num,
    }),
  ),
  subtotal: num,
  tax_total: num,
  total: num,
  amount_paid: num,
  amount_due: num,
  payment_terms: str,
  notes: str,
});

export const PurchaseOrderSchema = z.object({
  po_number: str,
  order_date: str.describe("YYYY-MM-DD"),
  delivery_date: str.describe("YYYY-MM-DD"),
  currency: str.describe("ISO 4217 code"),
  buyer: Party,
  supplier: Party,
  ship_to: str,
  items: z.array(
    z.object({
      sku: str,
      description: str,
      quantity: num,
      unit: str,
      unit_price: num,
      amount: num,
    }),
  ),
  subtotal: num,
  tax_total: num,
  total: num,
  payment_terms: str,
});

export const BankStatementSchema = z.object({
  bank_name: str,
  account_holder: str,
  account_number_last4: str.describe("Only the last 4 digits of the account number or IBAN"),
  currency: str.describe("ISO 4217 code"),
  period_start: str.describe("YYYY-MM-DD"),
  period_end: str.describe("YYYY-MM-DD"),
  opening_balance: num,
  closing_balance: num,
  total_credits: num,
  total_debits: num,
  transactions: z.array(
    z.object({
      date: str.describe("YYYY-MM-DD"),
      description: str,
      amount: num.describe("Positive for money in, negative for money out"),
      balance: num,
    }),
  ),
});

export const AutoSchema = z.object({
  document_type: z.enum(["invoice", "purchase_order", "bank_statement", "other"]),
  invoice: InvoiceSchema.nullable(),
  purchase_order: PurchaseOrderSchema.nullable(),
  bank_statement: BankStatementSchema.nullable(),
});

export const DOC_TYPES = ["invoice", "purchase_order", "bank_statement", "auto"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const SCHEMAS = {
  invoice: InvoiceSchema,
  purchase_order: PurchaseOrderSchema,
  bank_statement: BankStatementSchema,
  auto: AutoSchema,
} as const;
