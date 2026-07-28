import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { renderReport, writeReport } from "../src/report/markdown.js";
import type { NegotiationResult, ReviewContext } from "../src/types/models.js";

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
