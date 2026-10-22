import type { Config } from "./config.js";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Seo {
  baseUrl: string;
  path: string;
  description: string;
  jsonLd?: object;
}

export function layout(title: string, body: string, contact?: string, extraHead = "", seo?: Seo): string {
  const url = seo ? `${seo.baseUrl}${seo.path}` : "";
  const seoHead = seo
    ? `
<meta name="description" content="${escape(seo.description)}">
<link rel="canonical" href="${escape(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(seo.description)}">
<meta property="og:url" content="${escape(url)}">
<meta name="twitter:card" content="summary">${
        seo.jsonLd ? `\n<script type="application/ld+json">${JSON.stringify(seo.jsonLd).replace(/</g, "\\u003c")}</script>` : ""
      }`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>${seoHead}${extraHead}
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
  footer { margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.9rem; }
  footer a { color: var(--muted); }
  nav { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 32px; font-size: 0.95rem; }
  nav a { color: var(--muted); text-decoration: none; }
  nav a:first-child { color: var(--fg); font-weight: 700; margin-right: auto; }
  a { color: var(--accent); }
  table { border-collapse: collapse; width: 100%; font-size: 0.92rem; display: block; overflow-x: auto; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .key { font-family: ui-monospace, monospace; word-break: break-all; background: var(--card); border: 1px solid var(--line); padding: 14px; border-radius: 8px; }
</style>
</head>
<body><main>
<nav><a href="/">DocExtract</a><a href="/docs">Docs</a><a href="/invoice-to-json">Invoices</a><a href="/bank-statement-to-json">Bank statements</a><a href="/purchase-order-to-json">Purchase orders</a><a href="/#pricing">Pricing</a></nav>
${body}
<footer>
  <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refunds">Refunds</a>${contact ? ` · <a href="mailto:${escape(contact)}">${escape(contact)}</a>` : ""}
</footer>
</main></body>
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

<h2 id="pricing">Pricing</h2>
<div class="plans">
  <div class="plan">
    <div><strong>Free</strong></div>
    <div class="price">$0</div>
    <div class="muted">${free} documents / month</div>
    <form id="free-form">
      <input type="email" name="email" placeholder="you@company.com" required>
      <button type="submit">Get a free API key</button>
    </form>
    <div id="free-result"></div>
  </div>
  <div class="plan">
    <div><strong>Starter</strong></div>
    <div class="price">$19 <span class="muted" style="font-size:1rem">/ month</span></div>
    <div class="muted">${starter} documents / month</div>
    ${paidForm("starter")}
  </div>
  <div class="plan">
    <div><strong>Pro</strong></div>
    <div class="price">$49 <span class="muted" style="font-size:1rem">/ month</span></div>
    <div class="muted">${pro} documents / month</div>
    ${paidForm("pro")}
  </div>
</div>
<p class="muted">Failed extractions are not counted. Cancel anytime. Payments are processed by Lemon Squeezy, our reseller and Merchant of Record, who handles sales tax and VAT.</p>

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
    config.contactEmail,
    "",
    {
      baseUrl: config.baseUrl,
      path: "/",
      description:
        "Document extraction API: send an invoice, purchase order or bank statement (PDF or image) and get structured JSON with verified totals. Free plan, then from $19/month.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: config.brandName,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web API",
        url: config.baseUrl,
        description: "API that turns invoices, purchase orders and bank statements into structured JSON with arithmetic checks.",
        offers: [
          { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
          { "@type": "Offer", name: "Starter", price: "19", priceCurrency: "USD" },
          { "@type": "Offer", name: "Pro", price: "49", priceCurrency: "USD" },
        ],
      },
    },
  );
}

export function keyPage(config: Config, key: string, plan: string): string {
  return layout(
    `${config.brandName}: your API key`,
    `<h1>Thanks for subscribing</h1>
<p class="lead">Your ${escape(plan)} plan is active. Here is your API key. It is shown only once, so save it now.</p>
<div class="key">${escape(key)}</div>
<p><a href="/">Back to the docs</a></p>`,
    config.contactEmail,
  );
}

export function messagePage(config: Config, title: string, message: string): string {
  return layout(
    `${config.brandName}: ${title}`,
    `<h1>${escape(title)}</h1><p class="lead">${escape(message)}</p><p><a href="/">Back</a></p>`,
    config.contactEmail,
  );
}

export function pendingPage(config: Config): string {
  return layout(
    `${config.brandName}: confirming payment`,
    `<h1>Confirming your payment…</h1>
<p class="lead">This usually takes a few seconds. This page refreshes by itself and will show your API key.</p>`,
    config.contactEmail,
    `<meta http-equiv="refresh" content="4">`,
  );
}

export function legalPage(config: Config, page: "terms" | "privacy" | "refunds"): string {
  const name = escape(config.legalName);
  const brand = escape(config.brandName);
  const contact = config.contactEmail
    ? `<a href="mailto:${escape(config.contactEmail)}">${escape(config.contactEmail)}</a>`
    : "the contact address on our website";
  const updated = "October 22, 2026";

  const pages = {
    terms: {
      title: "Terms of Service",
      body: `
<p>These terms govern your use of ${brand} (the "Service"), operated by ${name}. By creating an API key or subscribing, you agree to them.</p>
<h2>The Service</h2>
<p>${brand} extracts structured data from documents you upload (invoices, purchase orders, bank statements) using automated AI models. Results are generated automatically and may contain errors. You are responsible for reviewing results before relying on them, especially for accounting, tax or legal purposes.</p>
<h2>Your account and API key</h2>
<p>Keep your API key secret. You are responsible for all usage made with it. Each plan includes a monthly number of documents; requests beyond it are refused until the next month or an upgrade.</p>
<h2>Acceptable use</h2>
<p>Only upload documents you have the right to process. Do not use the Service for unlawful purposes, to process data you are not authorized to process, or to attempt to disrupt, overload or reverse-engineer the Service. We may suspend keys that break these rules.</p>
<h2>Subscriptions and payment</h2>
<p>Paid plans are billed monthly in advance through our reseller Lemon Squeezy, who acts as Merchant of Record. You can cancel at any time; your plan stays active until the end of the paid period. Refunds are described in our <a href="/refunds">Refund Policy</a>.</p>
<h2>Availability and changes</h2>
<p>We aim to keep the Service available but do not guarantee uninterrupted operation. We may change features or prices; price changes apply from your next billing period and are announced in advance.</p>
<h2>Liability</h2>
<p>The Service is provided "as is". To the extent permitted by law, ${name} is not liable for indirect or consequential damages, and our total liability is limited to the amount you paid for the Service in the 3 months before the claim.</p>
<h2>Contact</h2>
<p>Questions about these terms: ${contact}.</p>`,
    },
    privacy: {
      title: "Privacy Policy",
      body: `
<p>This policy explains what data ${brand}, operated by ${name}, processes and why.</p>
<h2>Documents you upload</h2>
<p>Documents are processed in memory to produce the extraction result and are not stored by us. To perform the extraction, documents are sent to our AI provider, Anthropic, which processes them on our behalf.</p>
<h2>Account data</h2>
<p>We store your email address, your plan, a one-way hash of your API key (never the key itself), and counts of documents processed per month, including the estimated processing cost. We use this to run the Service, enforce plan limits and contact you about your account.</p>
<h2>Payments</h2>
<p>Payments are handled by Lemon Squeezy as Merchant of Record. We do not receive or store your card details. Lemon Squeezy shares with us your email, subscription status and plan.</p>
<h2>Technical logs</h2>
<p>Our servers keep short-lived technical logs (request time, path, IP address, response status) for security and troubleshooting.</p>
<h2>Sharing</h2>
<p>We do not sell your data. We share it only with the service providers above, as needed to run the Service, or when required by law.</p>
<h2>Your rights</h2>
<p>You can ask for a copy or the deletion of your account data at ${contact}.</p>`,
    },
    refunds: {
      title: "Refund Policy",
      body: `
<p>If ${brand} does not work for you, contact us at ${contact} within 14 days of a payment and we will refund that payment in full, no questions asked.</p>
<p>After 14 days, payments are not refundable, but you can cancel at any time to stop future payments. Your plan stays active until the end of the period you paid for.</p>
<p>Refunds are issued through Lemon Squeezy to your original payment method and usually appear within 5 to 10 business days.</p>`,
    },
  } as const;

  const { title, body } = pages[page];
  return layout(`${config.brandName}: ${title}`, `<h1>${title}</h1><p class="muted">Last updated: ${updated}</p>${body}`, config.contactEmail);
}
