import {
  displayCurrency,
  DISPLAY_MODES,
  exchangeRateIsStale,
  isPlausibleLiveRate,
  isValidExchangeRate,
  toCanonicalAmount,
  toDisplayAmount
} from "./fx.js";

const DATA_URL = "data/costs.v1.json";
const EXCHANGE_RATE_URL = "data/exchange-rates.v1.json";
const LIVE_RATE_URL = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";
const STORAGE_KEY = "family-cost-planner-v2";
const DISPLAY_CURRENCY_KEY = "family-cost-planner-display-currency";
const DEFAULT_CONTINGENCY = 10;
const LIVE_RATE_TEMPLATE = Object.freeze({
  schemaVersion: 1,
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  sourceName: "Frankfurter — ECB reference rates",
  sourceUrl: LIVE_RATE_URL,
  staleAfterDays: 10
});

const state = {
  data: null,
  activeCityId: "javea",
  saved: loadSaved(),
  showAllEvidence: false,
  displayMode: loadDisplayMode(),
  exchangeRate: null,
  exchangeRateOrigin: "fallback",
  liveRateUnavailable: false
};

const elements = {
  app: document.querySelector("#app"),
  loading: document.querySelector("#loadingState"),
  error: document.querySelector("#errorState"),
  cityTabs: document.querySelector("#cityTabs"),
  cityCountry: document.querySelector("#cityCountry"),
  cityHeading: document.querySelector("#cityHeading"),
  budgetRows: document.querySelector("#budgetRows"),
  sourceList: document.querySelector("#sourceList"),
  refreshDate: document.querySelector("#refreshDate"),
  datasetStatus: document.querySelector("#datasetStatus"),
  bufferInput: document.querySelector("#bufferInput"),
  baseTotal: document.querySelector("#baseTotal"),
  bufferAmount: document.querySelector("#bufferAmount"),
  recommendedTotal: document.querySelector("#recommendedTotal"),
  annualTotal: document.querySelector("#annualTotal"),
  saveStatus: document.querySelector("#saveStatus"),
  resetButton: document.querySelector("#resetButton"),
  exportButton: document.querySelector("#exportButton"),
  expandAllButton: document.querySelector("#expandAllButton"),
  eurCurrencyButton: document.querySelector("#eurCurrencyButton"),
  usdCurrencyButton: document.querySelector("#usdCurrencyButton"),
  exchangeRateStatus: document.querySelector("#exchangeRateStatus")
};

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

function loadDisplayMode() {
  return localStorage.getItem(DISPLAY_CURRENCY_KEY) === DISPLAY_MODES.USD
    ? DISPLAY_MODES.USD
    : DISPLAY_MODES.EUR;
}

function city() {
  return state.data.cities.find((item) => item.id === state.activeCityId);
}

function scenario() {
  const currentCity = city();
  const savedCity = state.saved[currentCity.id];
  const validSavedValues =
    savedCity?.values &&
    currentCity.items.every((item) => Number.isFinite(savedCity.values[item.id]));
  return {
    values: validSavedValues
      ? { ...savedCity.values }
      : Object.fromEntries(currentCity.items.map((item) => [item.id, item.defaultMonthly])),
    contingency: Number.isFinite(savedCity?.contingency)
      ? savedCity.contingency
      : DEFAULT_CONTINGENCY
  };
}

function currentDisplayCurrency(currentCity = city()) {
  return displayCurrency(state.displayMode);
}

function amountForDisplay(value, currentCity = city()) {
  return toDisplayAmount(
    value,
    currentCity.currency,
    state.displayMode,
    state.exchangeRate
  );
}

function amountForStorage(value, currentCity = city()) {
  return toCanonicalAmount(
    value,
    currentCity.currency,
    state.displayMode,
    state.exchangeRate
  );
}

function roundForExport(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value, currentCity = city()) {
  const currency = currentDisplayCurrency(currentCity);
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : currentCity.locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(amountForDisplay(value, currentCity));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function sourceIsStale(source, now = new Date()) {
  const observed = new Date(`${source.observationDate}T23:59:59Z`);
  const staleAt = new Date(observed);
  staleAt.setUTCDate(staleAt.getUTCDate() + source.staleAfterDays);
  return now > staleAt;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function monthlyRange(evidence, currentCity) {
  const normalized = evidence.monthlyNormalized;
  if (normalized === null) return "not numerically comparable";
  if ("value" in normalized) return formatMoney(normalized.value, currentCity);
  return `${formatMoney(normalized.min, currentCity)}–${formatMoney(normalized.max, currentCity)}`;
}

function currencySymbol(currentCity = city()) {
  return currentDisplayCurrency(currentCity) === "EUR" ? "€" : "$";
}

function inputValue(value, currentCity = city()) {
  const displayed = amountForDisplay(value, currentCity);
  return Number.isInteger(displayed) ? displayed : displayed.toFixed(2);
}

function defaultReviewBadge(item, sources, currentCity) {
  const flag = item.defaultSelection.reviewFlags[0];
  if (!flag) return "";

  const selectedSource = sources.get(flag.sourceId);
  if (flag.code === "singleton-outlier") {
    const nextCandidate = item.defaultSelection.comparableCandidates[1];
    const nextSource = sources.get(nextCandidate.sourceId);
    const selectedCandidate = item.defaultSelection.comparableCandidates[0];
    const gapLabel =
      flag.gapPercent === null ? "no non-zero comparison" : `${flag.gapPercent.toFixed(0)}% gap`;
    const explanation =
      flag.gapPercent === null
        ? `${selectedSource.name} (${formatMoney(selectedCandidate.monthlyUpperBound, currentCity)}) is the only non-zero comparable source. Its highest value remains selected and requires human review.`
        : `${selectedSource.name} (${formatMoney(selectedCandidate.monthlyUpperBound, currentCity)}) is ${flag.gapPercent.toFixed(2)}% above ${nextSource.name} (${formatMoney(nextCandidate.monthlyUpperBound, currentCity)}). Its highest value remains selected and requires human review.`;
    return `<span class="default-review-flag outlier" title="${escapeHtml(explanation)}">
      <span class="flag-mark" aria-hidden="true">!</span>
      <span>Review · ${escapeHtml(gapLabel)}</span>
      <span class="sr-only">. ${escapeHtml(explanation)}</span>
    </span>`;
  }

  const explanation =
    `Only ${selectedSource.name} provides comparable normalized evidence. ` +
    "Its highest value is used with low confidence.";
  return `<span class="default-review-flag single-source" title="${escapeHtml(explanation)}">
    <span class="flag-mark" aria-hidden="true">i</span>
    <span>1 source</span>
    <span class="sr-only">. ${escapeHtml(explanation)}</span>
  </span>`;
}

function persist(values, contingency) {
  state.saved[state.activeCityId] = { values, contingency };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.saved));
  elements.saveStatus.textContent = "Saved in this browser";
  window.clearTimeout(persist.timer);
  persist.timer = window.setTimeout(() => {
    elements.saveStatus.textContent = "";
  }, 1600);
}

function calculate(shouldPersist = true, changedInput = null) {
  const currentCity = city();
  const values = { ...scenario().values };
  if (changedInput) {
    values[changedInput.dataset.item] = Math.max(
      0,
      amountForStorage(Number(changedInput.value) || 0, currentCity)
    );
  }
  const contingency = Math.min(
    100,
    Math.max(0, Number(elements.bufferInput.value) || 0)
  );
  const base = Object.values(values).reduce((sum, value) => sum + value, 0);
  const buffer = base * contingency / 100;
  const recommended = base + buffer;

  elements.baseTotal.textContent = formatMoney(base);
  elements.bufferAmount.textContent = formatMoney(buffer);
  elements.recommendedTotal.textContent = formatMoney(recommended);
  elements.annualTotal.textContent = formatMoney(recommended * 12);
  if (shouldPersist) persist(values, contingency);
}

function renderTabs() {
  elements.cityTabs.innerHTML = state.data.cities
    .map(
      (item) =>
        `<button type="button" data-city="${escapeHtml(item.id)}" ` +
        `aria-selected="${item.id === state.activeCityId}">${escapeHtml(item.name)}</button>`
    )
    .join("");
  elements.cityTabs.querySelectorAll("[data-city]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCityId = button.dataset.city;
      renderCity();
    });
  });
}

function renderRows() {
  const currentCity = city();
  const currentScenario = scenario();
  const sources = new Map(currentCity.sources.map((source) => [source.id, source]));

  elements.budgetRows.innerHTML = currentCity.items
    .map((item) => {
      const primaryEvidence = item.evidence.find(
        (evidence) => evidence.sourceId === item.defaultSelection.selectedSourceId
      );
      const primarySource = sources.get(primaryEvidence.sourceId);
      const evidenceDetails = item.evidence
        .map((evidence) => {
          const source = sources.get(evidence.sourceId);
          const comparison =
            evidence.comparison.status === "excluded"
              ? ` · excluded from comparison: ${evidence.comparison.reason}`
              : evidence.sourceId === item.defaultSelection.selectedSourceId
                ? " · selected highest comparable upper bound"
                : " · included in comparison";
          return `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">` +
            `${escapeHtml(source.name)}</a> <span class="evidence-reliability">` +
            `${escapeHtml(source.reliability)}</span>: ${escapeHtml(evidence.original.value)} ` +
            `(normalized ${escapeHtml(monthlyRange(evidence, currentCity))}${escapeHtml(comparison)}). ` +
            `${escapeHtml(evidence.notes)}</li>`;
        })
        .join("");
      return `<tr class="${state.showAllEvidence ? "expanded" : ""}">
        <th scope="row">${escapeHtml(item.label)}<small>${escapeHtml(item.notes)}</small></th>
        <td class="default-value" data-label="Adopted default">
          <span class="default-amount">${escapeHtml(formatMoney(item.defaultMonthly, currentCity))}</span>
          ${defaultReviewBadge(item, sources, currentCity)}
        </td>
        <td class="basis-cell" data-label="Evidence basis">
          <div class="evidence-summary">
            <strong>${escapeHtml(monthlyRange(primaryEvidence, currentCity))}</strong>
            <span>via <a href="${escapeHtml(primarySource.url)}" target="_blank" rel="noreferrer">${escapeHtml(primarySource.name)}</a></span>
          </div>
          <ul class="evidence-detail">${evidenceDetails}</ul>
        </td>
        <td class="edit-cell" data-label="Your monthly input">
          <label class="currency-input">
            <span>${escapeHtml(currencySymbol(currentCity))}</span>
            <input data-budget-input data-item="${escapeHtml(item.id)}" type="number" min="0" step="0.01"
              value="${escapeHtml(inputValue(currentScenario.values[item.id], currentCity))}"
              aria-label="${escapeHtml(item.label)} monthly amount in ${escapeHtml(currentDisplayCurrency(currentCity))}">
          </label>
        </td>
      </tr>`;
    })
    .join("");

  elements.budgetRows.querySelectorAll("[data-budget-input]").forEach((input) => {
    input.addEventListener("input", () => calculate(true, input));
  });
}

function renderCurrencyControl() {
  const hasRate = isValidExchangeRate(state.exchangeRate);
  elements.eurCurrencyButton.setAttribute(
    "aria-pressed",
    String(state.displayMode === DISPLAY_MODES.EUR)
  );
  elements.usdCurrencyButton.setAttribute(
    "aria-pressed",
    String(state.displayMode === DISPLAY_MODES.USD)
  );
  elements.eurCurrencyButton.disabled = !hasRate;
  elements.usdCurrencyButton.disabled = !hasRate;

  if (!hasRate) {
    elements.exchangeRateStatus.innerHTML =
      '<span class="fx-state stale">Currency conversion unavailable</span> · The checked-in EUR/USD rate is invalid.';
    return;
  }

  const rate = state.exchangeRate;
  const stale = exchangeRateIsStale(rate);
  const originLabel = state.exchangeRateOrigin === "live" ? "Live" : "Fallback";
  const statusLabel = stale ? `Stale ${originLabel.toLowerCase()}` : originLabel;
  const statusClass = stale ? "stale" : state.exchangeRateOrigin;
  const unavailable = state.liveRateUnavailable ? " · live request unavailable" : "";
  elements.exchangeRateStatus.innerHTML =
    `<span class="fx-state ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span> · ` +
    `EUR/USD · 1 EUR = ${escapeHtml(rate.rate.toFixed(4))} USD · ` +
    `1 USD = ${escapeHtml((1 / rate.rate).toFixed(4))} EUR · ` +
    `observed ${escapeHtml(formatDate(rate.observationDate))} · ` +
    `<a href="${escapeHtml(rate.sourceUrl)}" target="_blank" rel="noreferrer">` +
    `${escapeHtml(rate.sourceName)}</a>${unavailable}`;
}

function renderSources() {
  elements.sourceList.innerHTML = city().sources
    .map((source) => {
      const stale = sourceIsStale(source);
      return `<article class="source-row">
        <div>
          <a class="source-name" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>
          <p class="source-meta">Observed ${escapeHtml(formatDate(source.observationDate))} · retrieved ${escapeHtml(formatDate(source.retrievedAt))}</p>
        </div>
        <p class="source-notes">${escapeHtml(source.notes)}</p>
        <div class="source-badges">
          <span class="reliability">${escapeHtml(source.reliability)}</span>
          <span class="stale-pill ${stale ? "stale" : "fresh"}">${stale ? "Stale" : "Current"}</span>
        </div>
      </article>`;
    })
    .join("");
}

function renderDatasetStatus() {
  const allSources = state.data.cities.flatMap((item) => item.sources);
  const staleCount = allSources.filter((source) => sourceIsStale(source)).length;
  elements.refreshDate.textContent = formatDate(state.data.refreshedAt);
  elements.datasetStatus.textContent = staleCount ? `${staleCount} stale source${staleCount === 1 ? "" : "s"}` : "All sources current";
  elements.datasetStatus.className = `status-pill ${staleCount ? "stale" : "fresh"}`;
}

function renderCity() {
  const currentCity = city();
  const currentScenario = scenario();
  renderTabs();
  const currencyContext = `${state.displayMode} display · canonical ${currentCity.currency}`;
  elements.cityCountry.textContent = `${currentCity.country} · ${currencyContext}`;
  elements.cityHeading.textContent = currentCity.name;
  elements.bufferInput.value = currentScenario.contingency;
  renderCurrencyControl();
  renderRows();
  renderSources();
  calculate(false);
}

function exportScenario() {
  const currentCity = city();
  const canonicalValues = scenario().values;
  const contingency = Math.min(100, Math.max(0, Number(elements.bufferInput.value) || 0));
  const displayValues = Object.fromEntries(
    Object.entries(canonicalValues).map(([item, value]) => [
      item,
      roundForExport(amountForDisplay(value, currentCity))
    ])
  );
  const canonicalMonthlyEssentials =
    Object.values(canonicalValues).reduce((sum, value) => sum + value, 0);
  const canonicalRecommendedMonthly =
    canonicalMonthlyEssentials * (1 + contingency / 100);
  const monthlyEssentials =
    roundForExport(amountForDisplay(canonicalMonthlyEssentials, currentCity));
  const recommendedMonthly =
    roundForExport(amountForDisplay(canonicalRecommendedMonthly, currentCity));
  const selectedCurrency = currentDisplayCurrency(currentCity);
  const conversionApplied = selectedCurrency !== currentCity.currency;
  const conversionOperation = !conversionApplied
    ? "none"
    : currentCity.currency === "EUR"
      ? "multiply canonical EUR by EUR/USD rate"
      : "divide canonical USD by EUR/USD rate";
  const output = {
    city: currentCity.name,
    cityId: currentCity.id,
    currency: selectedCurrency,
    displayCurrency: selectedCurrency,
    displayMode: state.displayMode,
    canonicalCurrency: currentCity.currency,
    household: state.data.household,
    dataRefreshedAt: state.data.refreshedAt,
    monthlyItems: displayValues,
    monthlyEssentials,
    contingencyPercent: contingency,
    recommendedMonthlyNetIncome: recommendedMonthly,
    recommendedAnnualNetIncome:
      roundForExport(amountForDisplay(canonicalRecommendedMonthly * 12, currentCity)),
    canonicalMonthlyItems: { ...canonicalValues },
    canonicalMonthlyEssentials,
    canonicalRecommendedMonthlyNetIncome: canonicalRecommendedMonthly,
    canonicalRecommendedAnnualNetIncome: canonicalRecommendedMonthly * 12,
    conversion: {
      applied: conversionApplied,
      fromCurrency: currentCity.currency,
      toCurrency: selectedCurrency,
      operation: conversionOperation,
      direction: `${state.exchangeRate.baseCurrency}/${state.exchangeRate.quoteCurrency}`,
      baseCurrency: state.exchangeRate.baseCurrency,
      quoteCurrency: state.exchangeRate.quoteCurrency,
      eurToUsdRate: state.exchangeRate.rate,
      usdToEurRate: 1 / state.exchangeRate.rate,
      observationDate: state.exchangeRate.observationDate,
      retrievedAt: state.exchangeRate.retrievedAt,
      sourceName: state.exchangeRate.sourceName,
      sourceUrl: state.exchangeRate.sourceUrl,
      rateOrigin: state.exchangeRateOrigin,
      stale: exchangeRateIsStale(state.exchangeRate)
    },
    generatedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentCity.id}-family-budget.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function refreshLiveRate() {
  try {
    const response = await fetch(LIVE_RATE_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Live rate request failed with ${response.status}`);
    const payload = await response.json();
    const candidate = {
      ...LIVE_RATE_TEMPLATE,
      rate: payload?.rates?.USD,
      observationDate: payload?.date,
      retrievedAt: new Date().toISOString()
    };
    const fallback = state.exchangeRate;
    if (
      payload?.amount !== 1 ||
      payload?.base !== "EUR" ||
      !isValidExchangeRate(fallback) ||
      !isPlausibleLiveRate(candidate, fallback)
    ) {
      throw new Error("Live rate response failed validation");
    }
    state.exchangeRate = candidate;
    state.exchangeRateOrigin = "live";
    state.liveRateUnavailable = false;
    state.displayMode = loadDisplayMode();
    renderCurrencyControl();
    renderCity();
  } catch (error) {
    console.warn("Using checked-in exchange-rate fallback:", error.message);
    state.liveRateUnavailable = true;
    renderCurrencyControl();
  }
}

async function initialize() {
  try {
    const dataResponse = await fetch(DATA_URL, { cache: "no-cache" });
    if (!dataResponse.ok) throw new Error(`Data request failed with ${dataResponse.status}`);
    state.data = await dataResponse.json();
    const exchangeRateResponse = await fetch(EXCHANGE_RATE_URL, { cache: "no-cache" });
    if (!exchangeRateResponse.ok) {
      throw new Error(`Exchange-rate request failed with ${exchangeRateResponse.status}`);
    }
    const fallback = await exchangeRateResponse.json();
    if (!isValidExchangeRate(fallback)) {
      throw new Error("Checked-in exchange-rate fallback failed validation");
    }
    state.exchangeRate = fallback;
    renderDatasetStatus();
    renderCity();
    elements.loading.hidden = true;
    elements.app.hidden = false;
    refreshLiveRate();
  } catch (error) {
    console.error(error);
    elements.loading.hidden = true;
    elements.error.hidden = false;
  }
}

elements.bufferInput.addEventListener("input", () => calculate());
elements.resetButton.addEventListener("click", () => {
  delete state.saved[state.activeCityId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.saved));
  renderCity();
  elements.saveStatus.textContent = "Reset to checked-in defaults";
});
elements.exportButton.addEventListener("click", exportScenario);
elements.eurCurrencyButton.addEventListener("click", () => {
  if (!isValidExchangeRate(state.exchangeRate)) return;
  state.displayMode = DISPLAY_MODES.EUR;
  localStorage.setItem(DISPLAY_CURRENCY_KEY, state.displayMode);
  renderCity();
});
elements.usdCurrencyButton.addEventListener("click", () => {
  if (!isValidExchangeRate(state.exchangeRate)) return;
  state.displayMode = DISPLAY_MODES.USD;
  localStorage.setItem(DISPLAY_CURRENCY_KEY, state.displayMode);
  renderCity();
});
elements.expandAllButton.addEventListener("click", () => {
  state.showAllEvidence = !state.showAllEvidence;
  elements.expandAllButton.textContent = state.showAllEvidence ? "Hide evidence details" : "Show all evidence";
  elements.expandAllButton.setAttribute("aria-expanded", String(state.showAllEvidence));
  renderRows();
});

initialize();
