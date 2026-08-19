import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_SELECTION_POLICY = "highest-comparable-upper-bound";
export const SINGLETON_OUTLIER_GAP_PERCENT = 25;

export function monthlyUpperBound(evidence) {
  const normalized = evidence?.monthlyNormalized ?? {};
  const value = "max" in normalized ? normalized.max : normalized.value;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${evidence?.sourceId ?? "unknown source"} has no valid monthly upper bound`);
  }
  return value;
}

export function deriveDefaultSelection(item) {
  const comparableCandidates = item.evidence
    .filter((evidence) => evidence.comparison?.status === "comparable")
    .map((evidence) => ({
      sourceId: evidence.sourceId,
      monthlyUpperBound: monthlyUpperBound(evidence)
    }))
    .sort(
      (left, right) =>
        right.monthlyUpperBound - left.monthlyUpperBound ||
        left.sourceId.localeCompare(right.sourceId)
    );

  if (!comparableCandidates.length) {
    throw new Error(`${item.id}: at least one comparable evidence source is required`);
  }

  const excludedEvidence = item.evidence
    .filter((evidence) => evidence.comparison?.status === "excluded")
    .map((evidence) => ({
      sourceId: evidence.sourceId,
      reasonCode: evidence.comparison.reasonCode,
      reason: evidence.comparison.reason
    }));

  const selected = comparableCandidates[0];
  const reviewFlags = [];
  if (comparableCandidates.length === 1) {
    reviewFlags.push({
      code: "single-source-low-confidence",
      sourceId: selected.sourceId,
      explanation:
        `Only ${selected.sourceId} provides comparable normalized evidence for this item.`
    });
  } else {
    const nextHighest = comparableCandidates[1];
    const uniqueHighest =
      comparableCandidates.filter(
        (candidate) => candidate.monthlyUpperBound === selected.monthlyUpperBound
      ).length === 1;
    const gapPercent =
      nextHighest.monthlyUpperBound === 0
        ? null
        : ((selected.monthlyUpperBound - nextHighest.monthlyUpperBound) /
            nextHighest.monthlyUpperBound) *
          100;
    if (
      uniqueHighest &&
      (gapPercent === null || gapPercent > SINGLETON_OUTLIER_GAP_PERCENT)
    ) {
      reviewFlags.push({
        code: "singleton-outlier",
        sourceId: selected.sourceId,
        gapPercent,
        nextHighestMonthly: nextHighest.monthlyUpperBound,
        explanation:
          gapPercent === null
            ? `${selected.sourceId} is the only non-zero comparable source and remains selected under policy.`
            : `${selected.sourceId} is ${gapPercent.toFixed(2)}% above the next-highest comparable source and remains selected under policy.`
      });
    }
  }

  return {
    policy: DEFAULT_SELECTION_POLICY,
    selectedSourceId: selected.sourceId,
    selectedMonthlyValue: selected.monthlyUpperBound,
    comparableCandidates,
    excludedEvidence,
    reviewFlags
  };
}

export function applyDefaultPolicy(data) {
  for (const city of data.cities ?? []) {
    for (const item of city.items ?? []) {
      item.defaultSelection = deriveDefaultSelection(item);
      item.defaultMonthly = item.defaultSelection.selectedMonthlyValue;
    }
  }
  return data;
}

function runCli(args = process.argv.slice(2)) {
  const dataFile = path.resolve(args[0] ?? "data/costs.v1.json");
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  applyDefaultPolicy(data);
  fs.writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Applied highest-comparable default policy to ${dataFile}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
