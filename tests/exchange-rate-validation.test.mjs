import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  displayCurrency,
  DISPLAY_MODES,
  exchangeRateIsStale,
  isPlausibleLiveRate,
  isValidExchangeRate,
  toCanonicalAmount,
  toDisplayAmount
} from "../fx.js";
import { candidateFromResponse } from "../scripts/refresh-exchange-rate.mjs";
import { validateExchangeRate } from "../scripts/validate-exchange-rate.mjs";

const schema = JSON.parse(fs.readFileSync("schema/exchange-rate.schema.json", "utf8"));
const validRate = JSON.parse(fs.readFileSync("data/exchange-rates.v1.json", "utf8"));
const clone = () => structuredClone(validRate);

test("checked-in exchange rate satisfies schema and semantic rules", () => {
  assert.deepEqual(validateExchangeRate(validRate, schema), []);
  assert.equal(isValidExchangeRate(validRate), true);
});

test("rejects invalid pairs, rates, dates, and source URLs", () => {
  const candidate = clone();
  candidate.baseCurrency = "GBP";
  candidate.rate = Number.POSITIVE_INFINITY;
  candidate.observationDate = "tomorrow";
  candidate.sourceUrl = "http://example.com/rates";
  const errors = validateExchangeRate(candidate, schema);
  assert(errors.some((error) => error.includes("must be equal to constant")));
  assert(errors.some((error) => error.includes("finite, positive")));
  assert(errors.some((error) => error.includes("must match format")));
  assert(errors.some((error) => error.includes("api.frankfurter.dev")));
});

test("rejects implausible week-over-week movement", () => {
  const candidate = clone();
  candidate.rate = validRate.rate * 1.11;
  const errors = validateExchangeRate(candidate, schema, validRate);
  assert(errors.some((error) => error.includes("weekly limit is 10%")));
});

test("converts EUR presentation values reversibly and leaves USD unchanged", () => {
  const displayed = toDisplayAmount(100, "EUR", DISPLAY_MODES.USD, validRate);
  assert.equal(displayed, 100 * validRate.rate);
  assert.equal(toCanonicalAmount(displayed, "EUR", DISPLAY_MODES.USD, validRate), 100);
  assert.equal(toDisplayAmount(100, "USD", DISPLAY_MODES.USD, validRate), 100);
  assert.equal(displayCurrency("EUR", DISPLAY_MODES.LOCAL), "EUR");
  assert.equal(displayCurrency("EUR", DISPLAY_MODES.USD), "USD");
});

test("labels stale rates and validates provider responses", () => {
  assert.equal(exchangeRateIsStale(validRate, new Date("2026-08-20T00:00:00Z")), false);
  assert.equal(exchangeRateIsStale(validRate, new Date("2026-09-01T00:00:00Z")), true);
  assert.throws(
    () => candidateFromResponse({ amount: 1, base: "EUR", date: "2026-08-18", rates: { GBP: 1 } }, validRate),
    /invalid EUR\/USD response/
  );
});

test("rejects implausible or future-dated live rates", () => {
  const excessive = { ...validRate, rate: validRate.rate * 1.11 };
  const future = { ...validRate, observationDate: "2099-01-01" };
  assert.equal(isPlausibleLiveRate(excessive, validRate), false);
  assert.equal(isPlausibleLiveRate(future, validRate), false);
  assert.equal(isPlausibleLiveRate(validRate, validRate), true);
});
