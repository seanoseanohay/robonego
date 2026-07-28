import test from "node:test";
import assert from "node:assert/strict";
import { partition } from "../src/negotiation/orchestrator.js";
import type { CriticOutput, JudgeOutput } from "../src/types/models.js";

test("missing judgment becomes unresolved", () => {
  const critic: CriticOutput = {
    summary: "",
    findings: [
      {
        id: "F1",
        severity: "major",
        claim: "real issue",
        evidence: [],
        proposed_fix: "",
        confidence: 0.9
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
    findings: [
      {
        id: "F1",
        severity: "major",
        claim: "partly wrong issue",
        evidence: [],
        proposed_fix: "",
        confidence: 0.7
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
