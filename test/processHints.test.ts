import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPrNumbers,
  extractStoryIds,
  formatProcessHintsForMetadata
} from "../src/context/processHints.js";

test("extractPrNumbers finds hash and URL refs", () => {
  const text = `
    Already handled in #10294.
    See also https://github.com/replicatedhq/vandoor/pull/10302 for UI.
    Ignore #10294 duplicate.
  `;
  assert.deepEqual(extractPrNumbers(text), [10294, 10302]);
});

test("extractStoryIds finds sc- tickets", () => {
  assert.deepEqual(extractStoryIds("sc-138981 and SC-138988 polish"), [
    "sc-138981",
    "sc-138988"
  ]);
});

test("formatProcessHintsForMetadata is JSON with notes", () => {
  const raw = formatProcessHintsForMetadata({
    mergeable: "MERGEABLE",
    mergeable_state: "BLOCKED",
    review_decision: null,
    is_draft: false,
    referenced_prs: [{ number: 10294, state: "OPEN", is_open: true, title: "empty state" }],
    notes: ["Referenced open PR #10294"]
  });
  const parsed = JSON.parse(raw) as { mergeable_state: string; process_notes: string[] };
  assert.equal(parsed.mergeable_state, "BLOCKED");
  assert.match(parsed.process_notes[0] ?? "", /10294/);
});
