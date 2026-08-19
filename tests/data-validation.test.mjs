import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deriveDefaultSelection } from "../scripts/apply-default-policy.mjs";
import { validateData, validateSemantics } from "../scripts/validate-data.mjs";

const schema = JSON.parse(fs.readFileSync("schema/cost-data.schema.json", "utf8"));
const validData = JSON.parse(fs.readFileSync("data/costs.v1.json", "utf8"));
const clone = () => structuredClone(validData);

test("checked-in data satisfies schema and semantic rules", () => {
  assert.deepEqual(validateData(validData, schema), []);
});

test("rejects missing citations and unknown items", () => {
  const missingCitation = clone();
  missingCitation.cities[0].items[0].evidence = [];
  const missingErrors = validateData(missingCitation, schema);
  assert(missingErrors.some((error) => error.includes("must NOT have fewer than 1 items")));

  const unknownItem = clone();
  unknownItem.cities[0].items[1].id = "mystery-cost";
  const unknownErrors = validateData(unknownItem, schema);
  assert(unknownErrors.some((error) => error.includes("supported item set")));
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
  assert(
    errors.filter((error) => error.includes("must be equal to one of the allowed values")).length >=
      2
  );
});

test("returns schema errors instead of crashing on malformed normalization", () => {
  const candidate = clone();
  candidate.cities[0].items[0].evidence[0].monthlyNormalized = 5;
  assert.doesNotThrow(() => validateData(candidate, schema));
  assert(validateData(candidate, schema).some((error) => error.includes("must be object")));
});

test("rejects implausible week-over-week changes", () => {
  const candidate = clone();
  candidate.cities[0].items[0].defaultMonthly *= 1.5;
  candidate.cities[2].items[0].evidence[0].monthlyNormalized.value *= 1.5;
  const errors = validateData(candidate, schema, validData);
  assert(errors.some((error) => error.includes("weekly limit is 15%")));
  assert(errors.some((error) => error.includes("weekly limit is 25%")));
});

test("rejects comparable university allowances that overlap household categories", () => {
  const candidate = clone();
  candidate.cities[2].items[0].evidence[0].overlaps = ["housing"];
  const errors = validateData(candidate, schema);
  assert(errors.some((error) => error.includes("overlapping allowance")));
});

test("rejects a default below the highest comparable upper bound", () => {
  const candidate = clone();
  candidate.cities[1].items[0].defaultMonthly = 920;
  const errors = validateData(candidate, schema);
  assert(
    errors.some((error) =>
      error.includes("adopted default must equal the highest comparable monthly upper bound")
    )
  );
});

test("rejects unexplained comparison or exclusion provenance", () => {
  const candidate = clone();
  candidate.cities[0].items[0].defaultSelection.excludedEvidence = [];
  const errors = validateData(candidate, schema);
  assert(errors.some((error) => error.includes("default selection provenance does not match")));
});

test("requires single-source and singleton-outlier review flags", () => {
  const candidate = clone();
  const singleSourceItem = candidate.cities[0].items[1];
  const outlierItem = candidate.cities[2].items[0];
  singleSourceItem.defaultSelection.reviewFlags = [];
  outlierItem.defaultSelection.reviewFlags = [];
  const errors = validateData(candidate, schema);
  assert.equal(
    errors.filter((error) => error.includes("required review flag")).length,
    2
  );
});

test("keeps singleton outliers as defaults instead of discarding them", () => {
  const housing = validData.cities[2].items[0];
  assert.equal(housing.defaultSelection.reviewFlags[0].code, "singleton-outlier");
  assert.equal(
    housing.defaultMonthly,
    Math.max(
      ...housing.defaultSelection.comparableCandidates.map(
        (candidate) => candidate.monthlyUpperBound
      )
    )
  );
});

test("rejects qualitative evidence as a comparable numeric candidate", () => {
  const candidate = clone();
  const qualitative = candidate.cities[0].items[5].evidence[1];
  qualitative.comparison = { status: "comparable" };
  qualitative.monthlyNormalized = { value: 999 };
  const errors = validateData(candidate, schema);
  assert(errors.some((error) => error.includes("qualitative evidence must be excluded")));
});

test("flags an unrounded gap just above 25 percent", () => {
  const selection = deriveDefaultSelection({
    id: "boundary",
    evidence: [
      {
        sourceId: "high",
        monthlyNormalized: { value: 125.004 },
        comparison: { status: "comparable" }
      },
      {
        sourceId: "next",
        monthlyNormalized: { value: 100 },
        comparison: { status: "comparable" }
      }
    ]
  });
  assert.equal(selection.reviewFlags[0].code, "singleton-outlier");
  assert(selection.reviewFlags[0].gapPercent > 25);
});
