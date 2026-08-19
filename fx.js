export const DISPLAY_MODES = Object.freeze({
  LOCAL: "LOCAL",
  USD: "USD"
});

export const MAX_LIVE_RATE_CHANGE = 0.1;

export function isValidExchangeRate(rate) {
  if (!rate || typeof rate !== "object") return false;
  if (
    rate.schemaVersion !== 1 ||
    rate.baseCurrency !== "EUR" ||
    rate.quoteCurrency !== "USD" ||
    rate.sourceName !== "Frankfurter — ECB reference rates"
  ) {
    return false;
  }
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) return false;
  if (!Number.isInteger(rate.staleAfterDays) || rate.staleAfterDays < 1) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rate.observationDate)) return false;
  if (!Number.isFinite(Date.parse(`${rate.observationDate}T00:00:00Z`))) return false;
  if (!Number.isFinite(Date.parse(rate.retrievedAt))) return false;

  try {
    const source = new URL(rate.sourceUrl);
    return source.protocol === "https:" && source.hostname === "api.frankfurter.dev";
  } catch {
    return false;
  }
}

export function exchangeRateIsStale(rate, now = new Date()) {
  if (!isValidExchangeRate(rate)) return true;
  const staleAt = new Date(`${rate.observationDate}T23:59:59Z`);
  staleAt.setUTCDate(staleAt.getUTCDate() + rate.staleAfterDays);
  return now > staleAt;
}

export function isPlausibleLiveRate(candidate, fallback, now = new Date()) {
  if (!isValidExchangeRate(candidate) || !isValidExchangeRate(fallback)) return false;
  const observedAt = Date.parse(`${candidate.observationDate}T23:59:59Z`);
  if (observedAt > now.getTime() + 24 * 60 * 60 * 1000) return false;
  const change = Math.abs(candidate.rate - fallback.rate) / fallback.rate;
  return Number.isFinite(change) && change <= MAX_LIVE_RATE_CHANGE;
}

export function displayCurrency(localCurrency, displayMode) {
  return displayMode === DISPLAY_MODES.USD ? "USD" : localCurrency;
}

export function toDisplayAmount(value, localCurrency, displayMode, rate) {
  if (displayMode !== DISPLAY_MODES.USD || localCurrency === "USD") return value;
  if (localCurrency !== "EUR" || !isValidExchangeRate(rate)) {
    throw new Error(`No supported ${localCurrency} to USD exchange rate`);
  }
  return value * rate.rate;
}

export function toCanonicalAmount(value, localCurrency, displayMode, rate) {
  if (displayMode !== DISPLAY_MODES.USD || localCurrency === "USD") return value;
  if (localCurrency !== "EUR" || !isValidExchangeRate(rate)) {
    throw new Error(`No supported USD to ${localCurrency} exchange rate`);
  }
  return value / rate.rate;
}
