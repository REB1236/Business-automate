# docapi

Document extraction API: invoices, purchase orders and bank statements (PDF or image) to JSON, using Claude structured outputs. Each document is read by Claude Haiku 5.5 first; if the extracted amounts don't add up, Claude Opus 5.5 reads it again. The arithmetic checks are returned to the customer. Free, Starter and Pro plans with monthly quotas; paid plans through Lemon Squeezy (Merchant of Record).

Deployment guide (French): [DEPLOIEMENT.md](DEPLOIEMENT.md).

## Run locally

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
set -a; . ./.env; set +a
npm run dev
```

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | – | Landing page with pricing |
| POST | `/v1/keys/free` | – | `{ "email": "..." }` → free API key (one per email) |
| POST | `/v1/extract` | API key | multipart: `file` (PDF/PNG/JPEG/WEBP/GIF, ≤ 10 MB), `type` (`invoice`, `purchase_order`, `bank_statement`, `auto`) |
| GET | `/v1/usage` | API key | Plan, documents used this month, limit |
| POST | `/v1/billing/portal` | API key | Lemon Squeezy customer portal URL |
| POST | `/billing/checkout` | – | Form: `plan`, `email` → Lemon Squeezy checkout |
| GET | `/billing/success` | – | Shows the new API key once after payment (`?token=`) |
| GET | `/terms`, `/privacy`, `/refunds` | – | Legal pages |
| POST | `/billing/webhook` | `X-Signature` (HMAC-SHA256) | Lemon Squeezy subscription events |
| GET | `/admin/stats` | `ADMIN_TOKEN` (header or `?token=`) | Documents, Claude cost and accounts for the month |

Send the key as `Authorization: Bearer <key>` or `x-api-key: <key>`. Keys are stored hashed. Documents are not stored. Failed extractions don't count against the quota.

## Tests

```bash
npm test
```
