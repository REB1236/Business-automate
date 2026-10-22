import type { Config } from "./config.js";
import { layout } from "./pages.js";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function codeSamples(baseUrl: string, type: string, file: string): string {
  return `<h3>cURL</h3>
<pre><code>curl ${esc(baseUrl)}/v1/extract \\
  -H "Authorization: Bearer $DOCEXTRACT_KEY" \\
  -F type=${type} \\
  -F file=@${file}</code></pre>
<h3>Python</h3>
<pre><code>import os, requests

with open("${file}", "rb") as f:
    r = requests.post(
        "${esc(baseUrl)}/v1/extract",
        headers={"Authorization": f"Bearer {os.environ['DOCEXTRACT_KEY']}"},
        data={"type": "${type}"},
        files={"file": f},
        timeout=120,
    )
r.raise_for_status()
result = r.json()
print(result["data"], result["checks"])</code></pre>
<h3>JavaScript (Node 18+)</h3>
<pre><code>import { readFile } from "node:fs/promises";

const form = new FormData();
form.append("type", "${type}");
form.append("file", new Blob([await readFile("${file}")]), "${file}");

const res = await fetch("${esc(baseUrl)}/v1/extract", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.DOCEXTRACT_KEY}\` },
  body: form,
});
const { data, checks } = await res.json();</code></pre>`;
}

export function docsPage(config: Config): string {
  const b = config.baseUrl;
  const { free, starter, pro } = config.monthlyLimits;
  return layout(
    `${config.brandName} API documentation`,
    `<h1>API documentation</h1>
<p class="lead">One endpoint. Send a document, get JSON back with every amount checked.</p>

<h2>1. Get an API key</h2>
<p>Create a free key on the <a href="/#pricing">home page</a> (${free} documents per month, no card). Send it on every request as <code>Authorization: Bearer &lt;key&gt;</code> (or <code>x-api-key: &lt;key&gt;</code>).</p>

<h2>2. Extract a document</h2>
<p><code>POST /v1/extract</code> with <code>multipart/form-data</code>:</p>
<table>
<tr><th>Field</th><th>Required</th><th>Description</th></tr>
<tr><td><code>file</code></td><td>yes</td><td>PDF, PNG, JPEG, WEBP or GIF, up to ${config.maxFileBytes / 1024 / 1024} MB</td></tr>
<tr><td><code>type</code></td><td>no</td><td><code>invoice</code>, <code>purchase_order</code>, <code>bank_statement</code> or <code>auto</code> (default: <code>auto</code>, detects the type)</td></tr>
</table>
${codeSamples(b, "invoice", "invoice.pdf")}

<h2>3. Read the response</h2>
<pre><code>{
  "type": "invoice",
  "data": { "invoice_number": "INV-2041", "issue_date": "2026-09-30", "currency": "USD",
            "seller": { ... }, "buyer": { ... }, "line_items": [ ... ],
            "subtotal": 45, "tax_total": 9, "total": 54, ... },
  "checks": [
    { "name": "lines_sum_to_subtotal", "status": "pass" },
    { "name": "subtotal_plus_tax_equals_total", "status": "pass" }
  ],
  "usage": { "used": 12, "limit": ${starter} }
}</code></pre>
<ul>
<li>Fields that are not on the document are <code>null</code>. Values are never invented.</li>
<li>Dates are <code>YYYY-MM-DD</code>, amounts are plain numbers, currencies are ISO 4217 codes.</li>
<li><code>checks</code> lists arithmetic checks (line amounts, subtotal + tax = total, statement balance). A <code>fail</code> means the document itself does not add up, or something could not be read: review it before booking.</li>
<li>Bank statements return only the last 4 digits of account numbers.</li>
</ul>

<h2>Fields by document type</h2>
<table>
<tr><th>Type</th><th>Fields</th></tr>
<tr><td><code>invoice</code></td><td>invoice_number, issue_date, due_date, currency, seller, buyer (name, address, tax_id, email, phone), line_items (description, quantity, unit_price, tax_rate, amount), subtotal, tax_total, total, amount_paid, amount_due, payment_terms, notes</td></tr>
<tr><td><code>purchase_order</code></td><td>po_number, order_date, delivery_date, currency, buyer, supplier, ship_to, items (sku, description, quantity, unit, unit_price, amount), subtotal, tax_total, total, payment_terms</td></tr>
<tr><td><code>bank_statement</code></td><td>bank_name, account_holder, account_number_last4, currency, period_start, period_end, opening_balance, closing_balance, total_credits, total_debits, transactions (date, description, amount, balance)</td></tr>
<tr><td><code>auto</code></td><td>document_type plus one of the objects above</td></tr>
</table>

<h2>Other endpoints</h2>
<table>
<tr><th>Endpoint</th><th>Description</th></tr>
<tr><td><code>GET /v1/usage</code></td><td>Your plan, documents used this month and your limit</td></tr>
<tr><td><code>POST /v1/billing/portal</code></td><td>Link to manage or cancel your subscription</td></tr>
<tr><td><code>GET /openapi.json</code></td><td>OpenAPI 3.1 description of this API</td></tr>
</table>

<h2>Errors</h2>
<table>
<tr><th>Status</th><th>Meaning</th></tr>
<tr><td>400</td><td>Missing file or invalid <code>type</code></td></tr>
<tr><td>401</td><td>Missing or invalid API key</td></tr>
<tr><td>413</td><td>File too large</td></tr>
<tr><td>415</td><td>Unsupported file type</td></tr>
<tr><td>422</td><td>Nothing could be extracted (not counted)</td></tr>
<tr><td>429</td><td>Monthly limit reached (Free ${free}, Starter ${starter}, Pro ${pro})</td></tr>
<tr><td>502</td><td>Temporary failure, retry (not counted)</td></tr>
</table>
<p>Failed requests never count against your quota. Documents are processed in memory and not stored.</p>`,
    config.contactEmail,
    "",
    {
      baseUrl: b,
      path: "/docs",
      description: "API documentation: extract invoices, purchase orders and bank statements to JSON with one POST request. cURL, Python and JavaScript examples.",
    },
  );
}

interface UseCase {
  slug: string;
  type: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  who: string[];
  extracted: string;
  checks: string;
  file: string;
}

export const USE_CASES: UseCase[] = [
  {
    slug: "invoice-to-json",
    type: "invoice",
    title: "Invoice to JSON API: extract invoice data from PDF and images",
    description:
      "Invoice OCR API that returns structured JSON: invoice number, dates, seller and buyer, VAT numbers, line items and totals, with automatic arithmetic checks. Free plan available.",
    h1: "Invoice to JSON API",
    lead: "Turn supplier invoices (PDF, scans, photos) into clean JSON, ready for your accounting software, ERP or spreadsheet.",
    who: [
      "Accounting and bookkeeping tools that import supplier invoices",
      "Accounts payable automation and expense workflows",
      "Freelancers and agencies building invoice processing for clients",
      "No-code automations (Zapier, Make, n8n) through a simple HTTP request",
    ],
    extracted:
      "Invoice number, issue and due dates, currency, seller and buyer (name, address, tax ID such as VAT or EIN, email, phone), every line item with quantity, unit price, tax rate and amount, subtotal, tax, total, amount paid and amount due, payment terms.",
    checks:
      "Each line's quantity × unit price is compared with its amount, the lines are summed against the subtotal, and subtotal + tax is compared with the total. You get a pass or fail for each check, so you know which invoices to review by hand.",
    file: "invoice.pdf",
  },
  {
    slug: "bank-statement-to-json",
    type: "bank_statement",
    title: "Bank statement to JSON API: extract transactions from PDF statements",
    description:
      "Bank statement parser API: extract every transaction, opening and closing balance from PDF or scanned statements into JSON, with automatic balance reconciliation. Free plan available.",
    h1: "Bank statement to JSON API",
    lead: "Extract every transaction from PDF or scanned bank statements, with the balance reconciled automatically.",
    who: [
      "Bookkeeping and reconciliation tools",
      "Lending, underwriting and cash-flow analysis",
      "Personal finance and budgeting apps",
      "Accountants who receive statements as PDFs instead of bank feeds",
    ],
    extracted:
      "Bank name, account holder, last 4 digits of the account number, currency, statement period, opening and closing balances, total credits and debits, and every transaction with date, description, signed amount and running balance.",
    checks:
      "Opening balance plus all transactions must equal the closing balance, and credits and debits are summed against the printed totals. A failed check flags a missing or misread transaction before it reaches your books.",
    file: "statement.pdf",
  },
  {
    slug: "purchase-order-to-json",
    type: "purchase_order",
    title: "Purchase order to JSON API: extract PO data from PDF and images",
    description:
      "Purchase order extraction API: PO number, dates, buyer, supplier, shipping address, items with SKU, quantity and price, and totals as JSON, with arithmetic checks. Free plan available.",
    h1: "Purchase order to JSON API",
    lead: "Read incoming purchase orders automatically and push them into your order management system.",
    who: [
      "Suppliers and distributors receiving POs by email",
      "Order management, ERP and e-commerce back offices",
      "Sales operations automating order entry",
      "Procurement teams matching POs with invoices",
    ],
    extracted:
      "PO number, order and delivery dates, currency, buyer and supplier details, ship-to address, every item with SKU, description, quantity, unit, unit price and amount, subtotal, tax, total and payment terms.",
    checks:
      "Each item's quantity × unit price is compared with its amount, items are summed against the subtotal, and subtotal + tax is compared with the total, so wrong quantities are caught before you ship.",
    file: "purchase-order.pdf",
  },
];

export function useCasePage(config: Config, useCase: UseCase): string {
  const { free } = config.monthlyLimits;
  return layout(
    useCase.title,
    `<h1>${esc(useCase.h1)}</h1>
<p class="lead">${esc(useCase.lead)}</p>
<p><a href="/#pricing">Get a free API key</a>: ${free} documents per month, no card required.</p>

<h2>What you get</h2>
<p>${esc(useCase.extracted)}</p>

<h2>Every result is checked</h2>
<p>${esc(useCase.checks)}</p>

<h2>Who it is for</h2>
<ul>${useCase.who.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>

<h2>One request</h2>
${codeSamples(config.baseUrl, useCase.type, useCase.file)}

<h2>Privacy</h2>
<p>Documents are processed in memory and never stored. Failed extractions are not counted against your plan. See the full <a href="/docs">API documentation</a>.</p>`,
    config.contactEmail,
    "",
    { baseUrl: config.baseUrl, path: `/${useCase.slug}`, description: useCase.description },
  );
}

export function sitemapXml(config: Config): string {
  const paths = ["/", "/docs", ...USE_CASES.map((u) => `/${u.slug}`), "/terms", "/privacy", "/refunds"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${esc(config.baseUrl + p)}</loc></url>`).join("\n")}
</urlset>
`;
}

export function robotsTxt(config: Config): string {
  return `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /billing/

Sitemap: ${config.baseUrl}/sitemap.xml
`;
}

/** Plain-text summary for AI assistants and agents (llms.txt convention). */
export function llmsTxt(config: Config): string {
  const { free, starter, pro } = config.monthlyLimits;
  return `# ${config.brandName}

> HTTP API that extracts structured JSON from invoices, purchase orders and bank statements (PDF or image), with arithmetic checks on every result.

## Usage
- Endpoint: POST ${config.baseUrl}/v1/extract (multipart/form-data: file, type = invoice | purchase_order | bank_statement | auto)
- Auth: Authorization: Bearer <API key>. Free keys: ${config.baseUrl}/#pricing
- Response: { type, data, checks: [{ name, status: pass|fail }], usage }
- Missing values are null; dates YYYY-MM-DD; currencies ISO 4217; documents are not stored.

## Pricing
- Free: ${free} documents/month
- Starter: $19/month, ${starter} documents
- Pro: $49/month, ${pro} documents

## Docs
- [API documentation](${config.baseUrl}/docs)
- [OpenAPI spec](${config.baseUrl}/openapi.json)
- [Invoice to JSON](${config.baseUrl}/invoice-to-json)
- [Bank statement to JSON](${config.baseUrl}/bank-statement-to-json)
- [Purchase order to JSON](${config.baseUrl}/purchase-order-to-json)
`;
}

export function openApiSpec(config: Config): object {
  const error = { type: "object", properties: { error: { type: "string" } } };
  return {
    openapi: "3.1.0",
    info: {
      title: `${config.brandName} API`,
      version: "1.0.0",
      description: "Extract structured JSON from invoices, purchase orders and bank statements, with arithmetic checks.",
    },
    servers: [{ url: config.baseUrl }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: { Error: error },
    },
    security: [{ bearer: [] }],
    paths: {
      "/v1/extract": {
        post: {
          summary: "Extract data from a document",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary", description: "PDF, PNG, JPEG, WEBP or GIF" },
                    type: { type: "string", enum: ["invoice", "purchase_order", "bank_statement", "auto"], default: "auto" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Extracted data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      type: { type: "string" },
                      data: { type: "object" },
                      checks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: { name: { type: "string" }, status: { type: "string", enum: ["pass", "fail"] }, detail: { type: "string" } },
                        },
                      },
                      usage: { type: "object", properties: { used: { type: "integer" }, limit: { type: "integer" } } },
                    },
                  },
                },
              },
            },
            "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": { description: "Invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "413": { description: "File too large" },
            "415": { description: "Unsupported file type" },
            "422": { description: "Nothing could be extracted (not counted)" },
            "429": { description: "Monthly limit reached" },
            "502": { description: "Temporary failure (not counted)" },
          },
        },
      },
      "/v1/usage": {
        get: {
          summary: "Plan and usage for the current month",
          responses: {
            "200": {
              description: "Usage",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { plan: { type: "string" }, used: { type: "integer" }, limit: { type: "integer" } } },
                },
              },
            },
          },
        },
      },
      "/v1/keys/free": {
        post: {
          summary: "Create a free API key",
          security: [],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } } },
          },
          responses: { "201": { description: "Key created" }, "409": { description: "A free key already exists for this email" } },
        },
      },
    },
  };
}
