import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const MAX_WEEKLY_RATE_CHANGE = 0.1;

function relativeChange(previous, next) {
  if (previous === next) return 0;
  if (previous === 0) return Number.POSITIVE_INFINITY;
  return Math.abs(next - previous) / previous;
}

export function validateExchangeRateSemantics(data, baseline, now = new Date()) {
  const errors = [];
  if (!Number.isFinite(data.rate) || data.rate <= 0) {
    errors.push("$.rate must be a finite, positive number");
  }

  let source;
  try {
    source = new URL(data.sourceUrl);
  } catch {
    errors.push("$.sourceUrl must be a valid URL");
  }
  if (source && (source.protocol !== "https:" || source.hostname !== "api.frankfurter.dev")) {
    errors.push("$.sourceUrl must use HTTPS on api.frankfurter.dev");
  }

  const observation = Date.parse(`${data.observationDate}T23:59:59Z`);
  const retrieved = Date.parse(data.retrievedAt);
  if (!Number.isFinite(observation)) errors.push("$.observationDate must be a valid date");
  if (!Number.isFinite(retrieved)) errors.push("$.retrievedAt must be a valid timestamp");
  if (Number.isFinite(observation) && observation > now.getTime() + 24 * 60 * 60 * 1000) {
    errors.push("$.observationDate must not be in the future");
  }
  if (Number.isFinite(observation) && Number.isFinite(retrieved) && retrieved < observation - 24 * 60 * 60 * 1000) {
    errors.push("$.retrievedAt must not predate the observation");
  }

  if (baseline?.rate !== undefined) {
    const change = relativeChange(baseline.rate, data.rate);
    if (change > MAX_WEEKLY_RATE_CHANGE) {
      errors.push(
        `$.rate changed ${Number.isFinite(change) ? `${(change * 100).toFixed(2)}%` : "from zero"}; ` +
          `weekly limit is ${MAX_WEEKLY_RATE_CHANGE * 100}%`
      );
    }
  }
  return errors;
}

export function validateExchangeRate(data, schema, baseline, now) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const errors = validate(data)
    ? []
    : validate.errors.map((error) => `${error.instancePath || "$"} ${error.message}`);
  return [...errors, ...validateExchangeRateSemantics(data, baseline, now)];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function runCli(args = process.argv.slice(2)) {
  const baselineFlag = args.indexOf("--baseline");
  const dataFile = args[0];
  const baselineFile = baselineFlag >= 0 ? args[baselineFlag + 1] : undefined;
  if (!dataFile || (baselineFlag >= 0 && !baselineFile)) {
    console.error(
      "Usage: node scripts/validate-exchange-rate.mjs <rate.json> [--baseline <previous.json>]"
    );
    return 2;
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const schema = readJson(path.join(root, "schema", "exchange-rate.schema.json"));
  const data = readJson(path.resolve(dataFile));
  const baseline = baselineFile ? readJson(path.resolve(baselineFile)) : undefined;
  const errors = validateExchangeRate(data, schema, baseline);
  if (errors.length) {
    console.error(`Exchange-rate validation failed with ${errors.length} error(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    return 1;
  }
  console.log(`${dataFile} is valid`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli();
}
