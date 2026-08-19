import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateExchangeRate } from "./validate-exchange-rate.mjs";

const ENDPOINT = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "data", "exchange-rates.v1.json");
const schemaPath = path.join(root, "schema", "exchange-rate.schema.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function candidateFromResponse(response, previous, retrievedAt = new Date().toISOString()) {
  if (
    response?.amount !== 1 ||
    response?.base !== "EUR" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(response?.date ?? "") ||
    !Number.isFinite(response?.rates?.USD) ||
    response.rates.USD <= 0
  ) {
    throw new Error("Frankfurter returned an invalid EUR/USD response");
  }
  return {
    ...previous,
    rate: response.rates.USD,
    observationDate: response.date,
    retrievedAt
  };
}

export async function refreshExchangeRate({
  fetchImpl = fetch,
  previous = readJson(dataPath),
  schema = readJson(schemaPath),
  write = true
} = {}) {
  const response = await fetchImpl(ENDPOINT, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Frankfurter request failed with HTTP ${response.status}`);

  const candidate = candidateFromResponse(await response.json(), previous);
  const errors = validateExchangeRate(candidate, schema, previous);
  if (errors.length) {
    throw new Error(`Fetched exchange rate was rejected:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  if (
    candidate.rate === previous.rate &&
    candidate.observationDate === previous.observationDate
  ) {
    console.log(`EUR/USD fallback is already current for ${candidate.observationDate}`);
    return { changed: false, candidate };
  }

  if (write) {
    fs.writeFileSync(dataPath, `${JSON.stringify(candidate, null, 2)}\n`);
  }
  console.log(`Updated EUR/USD fallback to ${candidate.rate} for ${candidate.observationDate}`);
  return { changed: true, candidate };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshExchangeRate().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
