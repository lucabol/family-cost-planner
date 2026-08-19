import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateData, validateSemantics } from "../scripts/validate-data.mjs";

const schema = JSON.parse(fs.readFileSync("schema/cost-data.schema.json", "utf8"));
const validData = JSON.parse(fs.readFileSync("data/costs.v1.json", "utf8"));
const clone = () => structuredClone(validData);

test("checked-in data satisfies schema and semantic rules", () => {
  assert.deepEqual(validateData(validData, schema), []);
});

test("rejects missing citations and unknown items", () => {
  const candidate = clone();
  candidate.cities[0].items[0].evidence = [];
  candidate.cities[0].items[1].id = "mystery-cost";
  const errors = validateData(candidate, schema);
  assert(errors.some((error) => error.includes("must NOT have fewer than 1 items")));
  assert(errors.some((error) => error.includes("supported item set")));
});

test("rejects malformed URLs and dates", () => {
  const candidate = clone();
  candidate.cities[0].sources[0].url = "not-a-url";
  candidate.cities[0].sources[0].observationDate = "next Tuesday";
  const errors = validateData(candidate, schema);
  assert(errors.some((error) => error.includes("must match pattern")));
  assert(errors.some((error) => error.includes("must match format")));
});

test("rejects negative, non-finite, and inverted values", () => {
  const candidate = clone();
  candidate.cities[0].items[0].defaultMonthly = Number.POSITIVE_INFINITY;
  candidate.cities[0].items[0].evidence[0].monthlyNormalized = { min: 2000, max: 1000 };
  const errors = validateSemantics(candidate);
  assert(errors.some((error) => error.includes("finite, non-negative")));
  assert(errors.some((error) => error.includes("range is inverted")));
});

test("rejects unknown currencies and cities", () => {
  const candidate = clone();
  candidate.cities[0].currency = "GBP";
  candidate.cities[1].id = "paris";
  const errors = validateData(candidate, schema);
  assert(errors.some((error) => error.includes("must be equal to one of the allowed values")));
  assert(errors.some((error) => error.includes("paris: items must exactly match")));
});

test("rejects implausible week-over-week changes", () => {
  const candidate = clone();
  candidate.cities[0].items[0].defaultMonthly *= 1.5;
  candidate.cities[2].items[0].evidence[0].monthlyNormalized.value *= 1.5;
  const errors = validateData(candidate, schema, validData);
  assert(errors.some((error) => error.includes("weekly limit is 15%")));
  assert(errors.some((error) => error.includes("weekly limit is 25%")));
});

test("rejects included university allowances that overlap household categories", () => {
  const candidate = clone();
  candidate.cities[2].items[0].evidence[0].overlaps = ["housing"];
  const errors = validateData(candidate, schema);
  assert(errors.some((error) => error.includes("overlapping allowance")));
});
