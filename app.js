const DATA_URL = "data/costs.v1.json";
const STORAGE_KEY = "family-cost-planner-v2";
const DEFAULT_CONTINGENCY = 10;

const state = {
  data: null,
  activeCityId: "javea",
  saved: loadSaved(),
  showAllEvidence: false
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
  expandAllButton: document.querySelector("#expandAllButton")
};

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
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

function formatMoney(value, currentCity = city()) {
  return new Intl.NumberFormat(currentCity.locale, {
    style: "currency",
    currency: currentCity.currency,
    maximumFractionDigits: 0
  }).format(value);
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
  if ("value" in normalized) return formatMoney(normalized.value, currentCity);
  return `${formatMoney(normalized.min, currentCity)}–${formatMoney(normalized.max, currentCity)}`;
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

function calculate(shouldPersist = true) {
  const values = Object.fromEntries(
    [...document.querySelectorAll("[data-budget-input]")].map((input) => [
      input.dataset.item,
      Math.max(0, Number(input.value) || 0)
    ])
  );
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
      const primaryEvidence =
        item.evidence.find((evidence) => evidence.includedInDefault) ?? item.evidence[0];
      const primarySource = sources.get(primaryEvidence.sourceId);
      const evidenceDetails = item.evidence
        .map((evidence) => {
          const source = sources.get(evidence.sourceId);
          const excluded = evidence.includedInDefault ? "" : " · context only";
          return `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">` +
            `${escapeHtml(source.name)}</a>: ${escapeHtml(evidence.original.value)} ` +
            `(normalized ${escapeHtml(monthlyRange(evidence, currentCity))}${excluded}). ` +
            `${escapeHtml(evidence.notes)}</li>`;
        })
        .join("");
      return `<tr class="${state.showAllEvidence ? "expanded" : ""}">
        <th scope="row">${escapeHtml(item.label)}<small>${escapeHtml(item.notes)}</small></th>
        <td class="default-value">${escapeHtml(formatMoney(item.defaultMonthly, currentCity))}</td>
        <td class="basis-cell">
          <div class="evidence-summary">
            <strong>${escapeHtml(monthlyRange(primaryEvidence, currentCity))}</strong>
            <span>via ${escapeHtml(primarySource.name)}</span>
          </div>
          <ul class="evidence-detail">${evidenceDetails}</ul>
        </td>
        <td class="edit-cell">
          <label class="currency-input">
            <span>${escapeHtml(currentCity.currency === "EUR" ? "€" : "$")}</span>
            <input data-budget-input data-item="${escapeHtml(item.id)}" type="number" min="0" step="1"
              value="${escapeHtml(currentScenario.values[item.id])}"
              aria-label="${escapeHtml(item.label)} monthly amount">
          </label>
        </td>
      </tr>`;
    })
    .join("");

  elements.budgetRows.querySelectorAll("[data-budget-input]").forEach((input) => {
    input.addEventListener("input", () => calculate());
  });
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
  elements.cityCountry.textContent = `${currentCity.country} · ${currentCity.currency}`;
  elements.cityHeading.textContent = currentCity.name;
  elements.bufferInput.value = currentScenario.contingency;
  renderRows();
  renderSources();
  calculate(false);
}

function exportScenario() {
  const currentCity = city();
  const values = Object.fromEntries(
    [...document.querySelectorAll("[data-budget-input]")].map((input) => [
      input.dataset.item,
      Math.max(0, Number(input.value) || 0)
    ])
  );
  const contingency = Math.min(100, Math.max(0, Number(elements.bufferInput.value) || 0));
  const monthlyEssentials = Object.values(values).reduce((sum, value) => sum + value, 0);
  const output = {
    city: currentCity.name,
    cityId: currentCity.id,
    currency: currentCity.currency,
    household: state.data.household,
    dataRefreshedAt: state.data.refreshedAt,
    monthlyItems: values,
    monthlyEssentials,
    contingencyPercent: contingency,
    recommendedMonthlyNetIncome: monthlyEssentials * (1 + contingency / 100),
    recommendedAnnualNetIncome: monthlyEssentials * (1 + contingency / 100) * 12,
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

async function initialize() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
    state.data = await response.json();
    renderDatasetStatus();
    renderCity();
    elements.loading.hidden = true;
    elements.app.hidden = false;
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
elements.expandAllButton.addEventListener("click", () => {
  state.showAllEvidence = !state.showAllEvidence;
  elements.expandAllButton.textContent = state.showAllEvidence ? "Hide evidence details" : "Show all evidence";
  elements.expandAllButton.setAttribute("aria-expanded", String(state.showAllEvidence));
  renderRows();
});

initialize();
