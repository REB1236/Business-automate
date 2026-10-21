// Small fixes applied after extraction, so cheap-model answers match the documented format.

const CURRENCY_ALIASES: Record<string, string> = {
  "$": "USD",
  "US$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "CHF": "CHF",
  "DH": "MAD",
  "DHS": "MAD",
  "د.م.": "MAD",
  "C$": "CAD",
  "A$": "AUD",
};

function normalizeCurrency(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  return CURRENCY_ALIASES[trimmed.toUpperCase()] ?? CURRENCY_ALIASES[trimmed] ?? trimmed;
}

/** Normalizes `currency` fields at any depth (also inside an `auto` result). */
export function normalize(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(normalize);
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = key === "currency" ? normalizeCurrency(value) : normalize(value);
  }
  return out;
}
