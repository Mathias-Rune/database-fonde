export interface MoneyMatch {
  amount: number;
  currency: string;
  raw: string;
  index: number;
}

export interface DateMatch {
  date?: string;
  year?: number;
  raw: string;
  index: number;
}

const currencyMap: Record<string, string> = {
  kr: "DKK",
  "kr.": "DKK",
  kroner: "DKK",
  dkk: "DKK",
  "€": "EUR",
  eur: "EUR",
  "$": "USD",
  usd: "USD"
};

const moneyAfterRegex =
  /\b(\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?)\s*(mio\.?|millioner|million|tusind|k|m)?\s*(DKK|kr\.?|kroner|EUR|€|USD|\$)\b/gi;
const moneyBeforeRegex =
  /\b(DKK|kr\.?|kroner|EUR|€|USD|\$)[ \t]*(\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?)(?:\s*(mio\.?|millioner|million|tusind|k|m))?\b/gi;

const explicitDateRegex =
  /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b|\b(20\d{2}|19\d{2})\b/gi;
const monthNameDateRegex =
  /\b(\d{1,2})\.?\s+(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december|january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2}|19\d{2})\b/gi;
const monthMap: Record<string, number> = {
  januar: 0,
  january: 0,
  februar: 1,
  february: 1,
  marts: 2,
  march: 2,
  april: 3,
  maj: 4,
  may: 4,
  juni: 5,
  june: 5,
  juli: 6,
  july: 6,
  august: 7,
  september: 8,
  oktober: 9,
  october: 9,
  november: 10,
  december: 11
};

export function extractMoney(text: string): MoneyMatch[] {
  const matches: MoneyMatch[] = [];
  for (const match of text.matchAll(moneyAfterRegex)) {
    const raw = match[0];
    const numberRaw = match[1];
    const multiplier = match[2]?.toLowerCase();
    const currencyToken = match[3]?.toLowerCase();
    const amount = parseLocalizedNumber(numberRaw) * multiplierFor(multiplier);
    if (!isUsefulAmount(amount)) continue;
    matches.push({
      amount,
      currency: currencyMap[currencyToken],
      raw,
      index: match.index ?? 0
    });
  }
  for (const match of text.matchAll(moneyBeforeRegex)) {
    const raw = match[0];
    const currencyToken = match[1]?.toLowerCase();
    const multiplier = match[3]?.toLowerCase();
    const amount = parseLocalizedNumber(match[2]) * multiplierFor(multiplier);
    if (!isUsefulAmount(amount)) continue;
    matches.push({ amount, currency: currencyMap[currencyToken], raw, index: match.index ?? 0 });
  }
  return dedupeMoney(matches);
}

export function extractDates(text: string): DateMatch[] {
  const matches: DateMatch[] = [];
  for (const match of text.matchAll(monthNameDateRegex)) {
    const day = Number(match[1]);
    const month = monthMap[match[2].toLowerCase()];
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
      matches.push({ raw: match[0], date: date.toISOString(), year, index: match.index ?? 0 });
    }
  }
  for (const match of text.matchAll(explicitDateRegex)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (match[4]) {
      matches.push({ raw, year: Number(match[4]), index });
      continue;
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      matches.push({ raw, date: date.toISOString(), year, index });
    }
  }
  return dedupeDates(matches);
}

export function parseLocalizedNumber(value: string): number {
  const normalized = value.replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+$/.test(normalized)) {
    return Number(normalized.replace(/,/g, ""));
  }
  if (/^\d+\.\d{1,2}$/.test(normalized)) {
    return Number(normalized);
  }
  if (normalized.includes(",")) {
    return Number(normalized.replace(/\./g, "").replace(",", "."));
  }
  return Number(normalized.replace(/\./g, ""));
}

function multiplierFor(suffix?: string): number {
  if (!suffix) return 1;
  if (["mio.", "mio", "millioner", "million", "m"].includes(suffix)) return 1_000_000;
  if (["tusind", "k"].includes(suffix)) return 1_000;
  return 1;
}

function isUsefulAmount(amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  // In grant text, bare-looking values in this range are often years accidentally
  // picked up near "kr." from the previous line.
  if (amount >= 1900 && amount <= 2100) return false;
  return true;
}

function dedupeMoney(matches: MoneyMatch[]): MoneyMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.index}:${match.amount}:${match.currency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeDates(matches: DateMatch[]): DateMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.index}:${match.date ?? match.year}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
