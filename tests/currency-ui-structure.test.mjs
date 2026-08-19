import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const readme = fs.readFileSync("README.md", "utf8");

test("currency selector is globally labeled EUR and USD", () => {
  assert.match(html, /aria-label="Choose a global display currency"/);
  assert.match(html, /id="eurCurrencyButton"[^>]*aria-label="Display all monetary values in euros"[^>]*>EUR</);
  assert.match(html, /id="usdCurrencyButton"[^>]*aria-label="Display all monetary values in US dollars"[^>]*>USD</);
  assert.doesNotMatch(html, />Local</);
  assert.doesNotMatch(app, /DISPLAY_MODES\.LOCAL|localCurrencyButton/);
});

test("scenario export includes display values, exact canonical values, and bidirectional FX provenance", () => {
  assert.match(app, /displayCurrency: selectedCurrency/);
  assert.match(app, /canonicalCurrency: currentCity\.currency/);
  assert.match(app, /canonicalMonthlyItems: \{ \.\.\.canonicalValues \}/);
  assert.match(app, /direction: `\$\{state\.exchangeRate\.baseCurrency\}\/\$\{state\.exchangeRate\.quoteCurrency\}`/);
  assert.match(app, /eurToUsdRate: state\.exchangeRate\.rate/);
  assert.match(app, /usdToEurRate: 1 \/ state\.exchangeRate\.rate/);
  assert.match(readme, /global EUR\/USD display preference/);
});
