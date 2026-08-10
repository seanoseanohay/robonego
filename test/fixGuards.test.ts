import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFixBuckets,
  selectFixableFindings
} from "../src/negotiation/fixGuards.js";
import type { PartitionedFinding } from "../src/types/models.js";

function accepted(
  id: string,
  bucket: PartitionedFinding["finding"] extends never ? never : string,
  extras: Record<string, unknown> = {}
): PartitionedFinding {
  return {
    finding: {
      id,
      severity: "major",
      bucket,
      claim: `claim ${id}`,
      evidence: ["a.ts:1"],
      proposed_fix: "do the thing",
      confidence: 0.9,
      file: "a.ts",
      line: 1,
      category: null,
      ...extras
    } as PartitionedFinding["finding"],
    judgment: {
      finding_id: id,
      verdict: "accept",
      rationale: "ok",
      required_action: "fix"
    }
  };
}

test("selects before_merge by default and never not_this_pr", () => {
  const result = selectFixableFindings([
    accepted("A", "before_merge"),
    accepted("B", "not_this_pr"),
    accepted("C", "worth_fixing"),
    accepted("D", "optional")
  ]);

  assert.deepEqual(
    result.selected.map((f) => f.id),
    ["A"]
  );
  assert.ok(result.skipped.some((s) => s.finding.id === "B" && /never/.test(s.reason)));
  assert.ok(result.skipped.some((s) => s.finding.id === "C"));
});

test("honors fix bucket allowlist for worth_fixing", () => {
  const result = selectFixableFindings(
    [accepted("A", "before_merge"), accepted("B", "worth_fixing")],
    { buckets: ["before_merge", "worth_fixing"] }
  );
  assert.deepEqual(
    result.selected.map((f) => f.id).sort(),
    ["A", "B"]
  );
});

test("skips empty proposed_fix, low confidence, nits, maxFixes", () => {
  const result = selectFixableFindings(
    [
      accepted("empty", "before_merge", { proposed_fix: "  " }),
      accepted("low", "before_merge", { confidence: 0.2 }),
      accepted("nit", "before_merge", { severity: "nit" }),
      accepted("ok1", "before_merge"),
      accepted("ok2", "before_merge")
    ],
    { maxFixes: 1, minConfidence: 0.6 }
  );
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0]?.id, "ok1");
  assert.ok(result.skipped.some((s) => s.finding.id === "empty"));
  assert.ok(result.skipped.some((s) => s.finding.id === "low"));
  assert.ok(result.skipped.some((s) => s.finding.id === "nit"));
  assert.ok(result.skipped.some((s) => s.finding.id === "ok2" && /maxFixes/.test(s.reason)));
});

test("parseFixBuckets rejects not_this_pr hard guard", () => {
  assert.throws(() => parseFixBuckets("before_merge,not_this_pr"), /cannot be auto-fixed/);
  assert.deepEqual(parseFixBuckets("before_merge,worth_fixing"), [
    "before_merge",
    "worth_fixing"
  ]);
});
