import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  renderReport,
  synthesizeDecisionSummary,
  writeReport
} from "../src/report/markdown.js";
import type { NegotiationResult, PartitionedFinding, ReviewContext } from "../src/types/models.js";

test("writeReport uses unique paths for rapid runs", async () => {
  const ctx: ReviewContext = { repo: ".", target: "same target", metadata: "", diff: "" };
  const result = baseResult("good_to_merge");
  const outDir = await mkdtemp(path.join(tmpdir(), "robotneg-report-test-"));

  try {
    const first = await writeReport(ctx, result, outDir);
    const second = await writeReport(ctx, result, outDir);

    assert.notEqual(first, second);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("human review required is a valid first line", () => {
  const ctx: ReviewContext = { repo: ".", target: "same target", metadata: "", diff: "" };

  const report = renderReport(ctx, baseResult("needs_human"));

  assert.equal(report.startsWith("# HUMAN REVIEW REQUIRED\n"), true);
});

test("go/no-go board and checklists separate blockers from backlog", () => {
  const ctx: ReviewContext = { repo: ".", target: "pr", metadata: "", diff: "" };
  const accepted: PartitionedFinding[] = [
    finding("correctness-F1", "before_merge", "major", "false empty state"),
    finding("product-F2", "worth_fixing", "minor", "gray-400 contrast"),
    finding("thermo-F2", "optional", "minor", "extract ContentTab preview"),
    finding("contracts-F2", "not_this_pr", "major", "customer_id query override")
  ];
  const result: NegotiationResult = {
    outcome: "changes_needed",
    summary: "Last judge only talked about one item",
    rounds: [],
    accepted,
    rejected: [],
    unresolved: []
  };

  const report = renderReport(ctx, result);

  assert.match(report, /## Go \/ no-go/);
  assert.match(report, /\*\*Before merge \(blocks PR\)\*\* \| \*\*1\*\*/);
  assert.match(report, /Not this PR \(file separately\) \| 1/);
  assert.match(report, /### Required before push/);
  assert.match(report, /correctness-F1/);
  assert.match(report, /### File separately — do not block this PR/);
  assert.match(report, /contracts-F2/);
  assert.match(report, /Before merge — blocks this PR/);
  assert.match(report, /Appendix: role memory|Findings that stand/);
  // Must not bury the only signal as a single not_this_pr accept
  assert.match(report, /false empty state/);
});

test("synthesizeDecisionSummary counts all buckets not just last judge", () => {
  const summary = synthesizeDecisionSummary(
    "Accepted the single narrowed contracts finding",
    [
      finding("correctness-F1", "before_merge", "major", "empty"),
      finding("contracts-F2", "not_this_pr", "major", "cid")
    ],
    0
  );
  assert.match(summary, /before_merge=1/);
  assert.match(summary, /not_this_pr=1/);
  assert.match(summary, /Before merge: correctness-F1/);
  assert.match(summary, /Last judge note/);
});

function finding(
  id: string,
  bucket: PartitionedFinding["finding"] extends never ? never : string,
  severity: string,
  claim: string
): PartitionedFinding {
  return {
    finding: {
      id,
      severity,
      bucket,
      claim,
      evidence: ["f:1"],
      proposed_fix: "fix",
      confidence: 0.9,
      file: "f.ts",
      line: 1,
      category: null
    } as PartitionedFinding["finding"],
    judgment: {
      finding_id: id,
      verdict: "accept",
      rationale: "ok",
      required_action: "fix"
    }
  };
}

function baseResult(outcome: NegotiationResult["outcome"]): NegotiationResult {
  return {
    outcome,
    summary: "ok",
    rounds: [],
    accepted: [],
    rejected: [],
    unresolved: []
  };
}
