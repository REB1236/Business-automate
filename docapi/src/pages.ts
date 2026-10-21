import type { Config } from "./config.js";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --card: #ffffff; --line: #e7e5e4; --accent: #1d4ed8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --card: #292524; --line: #44403c; --accent: #60a5fa; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 880px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 8px; }
  h2 { margin-top: 40px; }
  p.lead { color: var(--muted); font-size: 1.1rem; margin-top: 0; }
  pre { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-x: auto; font-size: 0.85rem; }
  code { font-family: ui-monospace, monospace; }
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .plan { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px; display: flex; flex-direction: column; gap: 8px; }
  .price { font-size: 1.6rem; font-weight: 700; }
  .muted { color: var(--muted); }
  input, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); width: 100%; }
  button { background: var(--accent); color: #fff; border: 0; cursor: pointer; font-weight: 600; }
  form { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
  .key { font-family: ui-monospace, monospace; word-break: break-all; background: var(--card); border: 1px solid var(--line); padding: 14px; border-radius: 8px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function landingPage(config: Config, paidPlansEnabled: boolean): string {
  const { free, starter, pro } = config.monthlyLimits;
  const paidForm = (plan: string) =>
    paidPlansEnabled
      ? `<form method="post" action="/billing/checkout">
           <input type="hidden" name="plan" value="${plan}">
           <input type="email" name="email" placeholder="you@company.com" required>
           <button type="submit">Subscribe</button>
         </form>`
      : `<p class="muted">Coming soon</p>`;

  return layout(
    `${config.brandName}: documents to JSON`,
    `
<h1>${escape(config.brandName)}</h1>
<p class="lead">Send an invoice, purchase order or bank statement (PDF or image). Get clean JSON back: parties, dates, line items, totals and transactions.</p>

<pre><code>curl ${escape(config.baseUrl)}/v1/extract \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F type=invoice \\
  -F file=@invoice.pdf</code></pre>

<pre><code>{
  "type": "invoice",
  "data": {
    "invoice_number": "INV-2041",
    "issue_date": "2026-09-30",
    "currency": "USD",
    "seller": { "name": "Acme Supplies Ltd", "tax_id": "GB123456789", ... },
    "line_items": [ { "description": "Paper A4", "quantity": 10, "unit_price": 4.5, "amount": 45 } ],
    "subtotal": 45, "tax_total": 9, "total": 54
  },
  "checks": [
    { "name": "line_1_amount", "status": "pass" },
    { "name": "lines_sum_to_subtotal", "status": "pass" },
    { "name": "subtotal_plus_tax_equals_total", "status": "pass" }
  ],
  "usage": { "used": 1, "limit": ${starter} }
}</code></pre>

<p class="muted"><code>type</code> is <code>invoice</code>, <code>purchase_order</code>, <code>bank_statement</code> or <code>auto</code>. Missing values come back as <code>null</code>, never guessed. Every answer is checked: line amounts, subtotal, tax and total (or the statement balance) must add up, and <code>checks</code> tells you which ones did. Documents are processed in memory and not stored.</p>

<h2>Pricing</h2>
<div class="plans">
  <div class="plan">
    <div><strong>Free</strong></div>
    <div class="price">€0</div>
    <div class="muted">${free} documents / month</div>
    <form id="free-form">
      <input type="email" name="email" placeholder="you@company.com" required>
      <button type="submit">Get a free API key</button>
    </form>
    <div id="free-result"></div>
  </div>
  <div class="plan">
    <div><strong>Starter</strong></div>
    <div class="price">€19 <span class="muted" style="font-size:1rem">/ month</span></div>
    <div class="muted">${starter} documents / month</div>
    ${paidForm("starter")}
  </div>
  <div class="plan">
    <div><strong>Pro</strong></div>
    <div class="price">€49 <span class="muted" style="font-size:1rem">/ month</span></div>
    <div class="muted">${pro} documents / month</div>
    ${paidForm("pro")}
  </div>
</div>
<p class="muted">Failed extractions are not counted. Cancel anytime.</p>

<script>
document.getElementById("free-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.getElementById("free-result");
  const email = new FormData(e.target).get("email");
  const res = await fetch("/v1/keys/free", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const body = await res.json();
  out.textContent = "";
  const p = document.createElement("p");
  if (res.ok) {
    p.textContent = "Your API key (shown once, save it now):";
    const k = document.createElement("div"); k.className = "key"; k.textContent = body.api_key;
    out.append(p, k);
  } else {
    p.textContent = body.error || "Something went wrong.";
    out.append(p);
  }
});
</script>
`,
  );
}

export function keyPage(config: Config, key: string, plan: string): string {
  return layout(
    `${config.brandName}: your API key`,
    `<h1>Thanks for subscribing</h1>
<p class="lead">Your ${escape(plan)} plan is active. Here is your API key. It is shown only once, so save it now.</p>
<div class="key">${escape(key)}</div>
<p><a href="/">Back to the docs</a></p>`,
  );
}

export function messagePage(config: Config, title: string, message: string): string {
  return layout(`${config.brandName}: ${title}`, `<h1>${escape(title)}</h1><p class="lead">${escape(message)}</p><p><a href="/">Back</a></p>`);
}
