import test from "node:test";
import assert from "node:assert/strict";
import { mergeLensCriticOutputs, prefixFindingId } from "../src/agents/mergeFindings.js";
import type { CriticOutput } from "../src/types/models.js";

function finding(
  id: string,
  claim: string,
  extras: Partial<CriticOutput["findings"][0]> = {}
): CriticOutput["findings"][0] {
  return {
    id,
    severity: "major",
    bucket: "before_merge",
    claim,
    evidence: ["x.go:1"],
    proposed_fix: "fix",
    confidence: 0.9,
    file: "x.go",
    line: 1,
    category: null,
    ...extras
  };
}

test("prefixFindingId prefixes once", () => {
  assert.equal(prefixFindingId("thermo", "F1"), "thermo-F1");
  assert.equal(prefixFindingId("thermo", "thermo-F1"), "thermo-F1");
  assert.equal(prefixFindingId("correctness", "correctness:F2"), "correctness-F2");
});

test("merge prefixes ids, tags category, sorts by severity", () => {
  const merged = mergeLensCriticOutputs([
    {
      lens: "correctness",
      output: {
        summary: "found race",
        narrative: "checked concurrency",
        findings: [finding("F1", "race on cookie", { severity: "minor" })]
      }
    },
    {
      lens: "thermo",
      output: {
        summary: "spaghetti",
        narrative: "file too big",
        findings: [finding("F1", "file crosses 1k lines", { severity: "blocker", file: "big.ts", line: 10 })]
      }
    }
  ]);

  assert.equal(merged.findings.length, 2);
  assert.equal(merged.findings[0]?.id, "thermo-F1");
  assert.equal(merged.findings[0]?.severity, "blocker");
  assert.equal(merged.findings[1]?.id, "correctness-F1");
  assert.equal(merged.findings[1]?.category, "correctness");
  assert.match(merged.summary, /2 findings/);
  assert.match(merged.narrative, /### correctness/);
  assert.match(merged.narrative, /### thermo/);
});

test("merge dedupes same file line and similar claim", () => {
  const claim = "Double submit race on invite accept";
  const merged = mergeLensCriticOutputs([
    {
      lens: "correctness",
      output: {
        summary: "a",
        narrative: "",
        findings: [finding("F1", claim, { file: "a.go", line: 42 })]
      }
    },
    {
      lens: "security",
      output: {
        summary: "b",
        narrative: "",
        findings: [finding("F9", claim, { file: "a.go", line: 42 })]
      }
    }
  ]);

  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0]?.id, "correctness-F1");
});

test("empty parts yields empty critic output", () => {
  const merged = mergeLensCriticOutputs([]);
  assert.equal(merged.findings.length, 0);
  assert.match(merged.summary, /No lens/);
});
