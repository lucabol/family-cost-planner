import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { deriveDefaultSelection } from "./apply-default-policy.mjs";

const CITY_ITEMS = {
  javea: [
    "housing",
    "utilities-internet",
    "food",
    "transport",
    "healthcare",
    "university-tuition",
    "university-books",
    "secondary-school",
    "other-household"
  ],
  savona: [
    "housing",
    "utilities-internet",
    "food",
    "transport",
    "healthcare",
    "university-tuition",
    "university-books",
    "secondary-school",
    "other-household"
  ],
  seattle: [
    "housing",
    "food",
    "healthcare",
    "transport",
    "civic-participation",
    "internet-mobile",
    "other-household",
    "university-tuition",
    "university-books",
    "secondary-school"
  ]
};

const DEFAULT_WEEKLY_LIMIT = 0.15;
const EVIDENCE_WEEKLY_LIMIT = 0.25;

function collectNumbers(value, pointer = "$", output = []) {
  if (typeof value === "number") {
    output.push({ pointer, value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectNumbers(item, `${pointer}[${index}]`, output));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => collectNumbers(item, `${pointer}.${key}`, output));
  }
  return output;
}

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function evidenceNumber(evidence, key) {
  return evidence?.monthlyNormalized?.[key];
}

function relativeChange(previous, next) {
  if (previous === next) return 0;
  if (previous === 0) return Number.POSITIVE_INFINITY;
  return Math.abs(next - previous) / previous;
}

export function validateSemantics(data, baseline) {
  const errors = [];

  for (const { pointer, value } of collectNumbers(data)) {
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${pointer} must be a finite, non-negative number`);
    }
  }

  const cityIds = data.cities?.map((city) => city.id) ?? [];
  if (duplicates(cityIds).length) errors.push("City IDs must be unique");

  for (const city of data.cities ?? []) {
    const allowedItems = CITY_ITEMS[city.id] ?? [];
    const itemIds = city.items?.map((item) => item.id) ?? [];
    if (
      itemIds.length !== allowedItems.length ||
      allowedItems.some((itemId) => !itemIds.includes(itemId))
    ) {
      errors.push(`${city.id}: items must exactly match the supported item set`);
    }
    if (duplicates(itemIds).length) errors.push(`${city.id}: item IDs must be unique`);

    const sourceIds = city.sources?.map((source) => source.id) ?? [];
    if (duplicates(sourceIds).length) errors.push(`${city.id}: source IDs must be unique`);
    const sourceSet = new Set(sourceIds);

    for (const item of city.items ?? []) {
      if (!item.evidence?.length) {
        errors.push(`${city.id}/${item.id}: at least one citation is required`);
      }
      const itemSourceIds = item.evidence?.map((evidence) => evidence.sourceId) ?? [];
      if (duplicates(itemSourceIds).length) {
        errors.push(`${city.id}/${item.id}: evidence source IDs must be unique`);
      }
      for (const evidence of item.evidence ?? []) {
        if (!sourceSet.has(evidence.sourceId)) {
          errors.push(`${city.id}/${item.id}: unknown source ${evidence.sourceId}`);
        }
        const normalized = evidence.monthlyNormalized ?? {};
        if ("min" in normalized && "max" in normalized && normalized.min > normalized.max) {
          errors.push(`${city.id}/${item.id}: normalized range is inverted`);
        }
        if (
          evidence.original?.unit === "qualitative" &&
          (evidence.comparison?.status !== "excluded" || evidence.monthlyNormalized !== null)
        ) {
          errors.push(
            `${city.id}/${item.id}/${evidence.sourceId}: qualitative evidence must be ` +
              "excluded and must not claim a numeric monthly normalization"
          );
        }
        if (
          evidence.comparison?.status === "comparable" &&
          evidence.monthlyNormalized === null
        ) {
          errors.push(
            `${city.id}/${item.id}/${evidence.sourceId}: comparable evidence requires ` +
              "a valid monthly normalization"
          );
        }
        if (evidence.comparison?.status === "comparable" && evidence.overlaps?.length) {
          errors.push(
            `${city.id}/${item.id}: overlapping allowance cannot be a comparable default candidate`
          );
        }
      }

      try {
        const expectedSelection = deriveDefaultSelection(item);
        if (item.defaultMonthly !== expectedSelection.selectedMonthlyValue) {
          errors.push(
            `${city.id}/${item.id}: adopted default must equal the highest comparable ` +
              `monthly upper bound (${expectedSelection.selectedMonthlyValue})`
          );
        }
        if (!isDeepStrictEqual(item.defaultSelection, expectedSelection)) {
          errors.push(
            `${city.id}/${item.id}: default selection provenance does not match the ` +
              "comparable evidence, exclusions, or required review flag"
          );
        }
      } catch (error) {
        errors.push(`${city.id}/${item.id}: ${error.message}`);
      }
    }
  }

  if (baseline) {
    const previousCities = new Map(baseline.cities.map((city) => [city.id, city]));
    for (const city of data.cities ?? []) {
      const previousCity = previousCities.get(city.id);
      if (!previousCity) continue;
      const previousItems = new Map(previousCity.items.map((item) => [item.id, item]));

      for (const item of city.items ?? []) {
        const previousItem = previousItems.get(item.id);
        if (!previousItem) continue;
        const defaultChange = relativeChange(previousItem.defaultMonthly, item.defaultMonthly);
        if (defaultChange > DEFAULT_WEEKLY_LIMIT) {
          errors.push(
            `${city.id}/${item.id}: adopted default changed ${(defaultChange * 100).toFixed(1)}%; ` +
              `weekly limit is ${DEFAULT_WEEKLY_LIMIT * 100}%`
          );
        }

        const previousEvidence = new Map(
          previousItem.evidence.map((entry) => [entry.sourceId, entry])
        );
        for (const evidence of item.evidence) {
          const oldEvidence = previousEvidence.get(evidence.sourceId);
          if (!oldEvidence) continue;
          for (const key of ["value", "min", "max"]) {
            const before = evidenceNumber(oldEvidence, key);
            const after = evidenceNumber(evidence, key);
            if (before === undefined || after === undefined) continue;
            const change = relativeChange(before, after);
            if (change > EVIDENCE_WEEKLY_LIMIT) {
              errors.push(
                `${city.id}/${item.id}/${evidence.sourceId}/${key}: evidence changed ` +
                  `${Number.isFinite(change) ? `${(change * 100).toFixed(1)}%` : "from zero"}; ` +
                  `weekly limit is ${EVIDENCE_WEEKLY_LIMIT * 100}%`
              );
            }
          }
        }
      }
    }
  }

  return errors;
}

export function validateData(data, schema, baseline) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    return validate.errors.map((error) => `${error.instancePath || "$"} ${error.message}`);
  }
  return validateSemantics(data, baseline);
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
      "Usage: node scripts/validate-data.mjs <data.json> [--baseline <previous.json>]"
    );
    return 2;
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const schema = readJson(path.join(root, "schema", "cost-data.schema.json"));
  const data = readJson(path.resolve(dataFile));
  const baseline = baselineFile ? readJson(path.resolve(baselineFile)) : undefined;
  const errors = validateData(data, schema, baseline);
  if (errors.length) {
    console.error(`Data validation failed with ${errors.length} error(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    return 1;
  }
  console.log(`${dataFile} is valid`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli();
}
