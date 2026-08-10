import test from "node:test";
import assert from "node:assert/strict";
import { partition } from "../src/negotiation/orchestrator.js";
import type { CriticOutput, JudgeOutput } from "../src/types/models.js";

test("missing judgment becomes unresolved", () => {
  const critic: CriticOutput = {
    summary: "",
    narrative: "",
    findings: [
      {
        id: "F1",
        severity: "major",
        bucket: "before_merge",
        claim: "real issue",
        evidence: ["file.go:10"],
        proposed_fix: "",
        confidence: 0.9,
        file: null,
        line: null,
        category: null
      }
    ]
  };
  const judge: JudgeOutput = { summary: "", judgments: [] };

  const result = partition(critic, judge);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.unresolved[0]?.judgment.verdict, "needs_human");
});

test("revise judgment becomes unresolved", () => {
  const critic: CriticOutput = {
    summary: "",
    narrative: "",
    findings: [
      {
        id: "F1",
        severity: "major",
        bucket: "worth_fixing",
        claim: "partly wrong issue",
        evidence: [],
        proposed_fix: "",
        confidence: 0.7,
        file: null,
        line: null,
        category: null
      }
    ]
  };
  const judge: JudgeOutput = {
    summary: "",
    judgments: [
      {
        finding_id: "F1",
        verdict: "revise",
        rationale: "The issue is real but the claim is wrong.",
        required_action: "Run another round."
      }
    ]
  };

  const result = partition(critic, judge);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.unresolved[0]?.judgment.verdict, "revise");
});

test("accept and reject partition correctly", () => {
  const critic: CriticOutput = {
    summary: "s",
    narrative: "",
    findings: [
      {
        id: "F1",
        severity: "blocker",
        bucket: "before_merge",
        claim: "race",
        evidence: ["a.go:1"],
        proposed_fix: "lock",
        confidence: 0.95,
        file: "a.go",
        line: 1,
        category: null
      },
      {
        id: "F2",
        severity: "nit",
        bucket: "optional",
        claim: "rename",
        evidence: [],
        proposed_fix: "",
        confidence: 0.4,
        file: null,
        line: null,
        category: null
      }
    ]
  };
  const judge: JudgeOutput = {
    summary: "j",
    judgments: [
      {
        finding_id: "F1",
        verdict: "accept",
        rationale: "real race",
        required_action: "fix"
      },
      {
        finding_id: "F2",
        verdict: "reject",
        rationale: "style",
        required_action: "none"
      }
    ]
  };

  const result = partition(critic, judge);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]?.finding.id, "F1");
  assert.equal(result.rejected.length, 1);
  assert.equal(result.unresolved.length, 0);
});
