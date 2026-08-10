import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FindingBucket,
  NegotiationResult,
  PartitionedFinding,
  ReviewContext
} from "../types/models.js";

const BUCKET_ORDER: FindingBucket[] = ["before_merge", "worth_fixing", "optional", "not_this_pr"];

const BUCKET_TITLE: Record<FindingBucket, string> = {
  before_merge: "Before merge — blocks this PR",
  worth_fixing: "Worth fixing here (recommended, not thermo-blocking alone)",
  optional: "Optional polish",
  not_this_pr: "Not this PR — file separately (do not block merge)"
};

export async function writeReport(ctx: ReviewContext, result: NegotiationResult, outDirInput: string): Promise<string> {
  const outDir = path.resolve(outDirInput);
  await mkdir(outDir, { recursive: true });
  const stamp = timestamp();
  const safeTarget = sanitizeTarget(ctx.target).slice(0, 80) || "review";
  const reportPath = path.join(outDir, `${stamp}-${safeTarget}.md`);
  const artifactPath = path.join(outDir, `${stamp}-${safeTarget}.json`);

  await writeFile(reportPath, renderReport(ctx, result), { encoding: "utf8", flag: "wx" });
  await writeFile(artifactPath, JSON.stringify(result, null, 2), { encoding: "utf8", flag: "wx" });
  return reportPath;
}

export function renderReport(ctx: ReviewContext, result: NegotiationResult): string {
  const top =
    result.outcome === "good_to_merge"
      ? "GOOD TO MERGE"
      : result.outcome === "needs_human"
        ? "HUMAN REVIEW REQUIRED"
        : "CHANGES NEEDED";

  const bucketCounts = countByBucket(result.accepted);
  const modeLine =
    result.mode === "thermo"
      ? `Mode: **thermo** multi-angle${result.lenses?.length ? ` (${result.lenses.join(", ")})` : ""}`
      : result.mode === "single"
        ? "Mode: **single** full critic"
        : null;
  const fixLine = result.fix_enabled
    ? "Fix stage: **enabled** (guarded implementer between rounds)"
    : null;

  const lines = [
    `# ${top}`,
    "",
    `Target: \`${ctx.target}\``,
    "",
    ...renderDecisionBox(result, bucketCounts),
    `Rounds: ${result.rounds.length} · Accepted: ${result.accepted.length} · Rejected: ${result.rejected.length} · Unresolved: ${result.unresolved.length}`,
    ""
  ];
  if (modeLine) {
    lines.push(modeLine, "");
  }
  if (fixLine) {
    lines.push(fixLine, "");
  }

  lines.push(...renderProcessSection(ctx));
  lines.push(...renderGoNoGoChecklist(result));

  lines.push(
    "## Judge summary",
    "",
    result.summary || "No summary provided.",
    ""
  );

  // Primary decision body: bucketed accepted findings (cumulative across rounds)
  lines.push(...renderBucketed("Findings that stand (accepted)", result.accepted));
  lines.push(...section("Unresolved (revise / human) — still open", result.unresolved));
  lines.push(...section("Rejected findings", result.rejected));

  lines.push(...renderImplementerSummary(result));

  lines.push("## Negotiation rounds (detail)", "");
  for (const round of result.rounds) {
    lines.push(
      `### Round ${round.round_number}`,
      "",
      `Critic: ${round.critic.summary}`,
      "",
      `Findings filed this round: ${round.critic.findings.length}`,
      "",
      `Judge: ${round.judge.summary}`,
      ""
    );
    if (round.implementer) {
      lines.push(`Implementer: ${round.implementer.summary}`, "");
      for (const applied of round.implementer.applied) {
        lines.push(
          `- \`${applied.finding_id}\`: **${applied.status}**` +
            (applied.files_touched.length ? ` (${applied.files_touched.join(", ")})` : "") +
            ` — ${applied.notes}`,
          ""
        );
      }
    }
    if (round.fix_skipped?.length) {
      lines.push("Guard skips (accepted but not auto-fixed):", "");
      for (const skip of round.fix_skipped) {
        lines.push(`- \`${skip.finding_id}\`: ${skip.reason}`, "");
      }
    }
  }

  if (result.role_memories?.critic || result.role_memories?.judge) {
    lines.push(
      "## Appendix: role memory snapshots",
      "",
      "_Working notes for multi-round agents — not the go/no-go source of truth. Use the bucketed findings above._",
      ""
    );
    if (result.role_memories.critic) {
      lines.push("### Critic", "", result.role_memories.critic.trim(), "");
    }
    if (result.role_memories.judge) {
      lines.push("### Judge", "", result.role_memories.judge.trim(), "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/** Exported for tests — one-line go/no-go board at top of report */
export function renderDecisionBox(
  result: NegotiationResult,
  bucketCounts?: Record<FindingBucket | "unknown", number>
): string[] {
  const counts = bucketCounts ?? countByBucket(result.accepted);
  const before = counts.before_merge ?? 0;
  const worth = counts.worth_fixing ?? 0;
  const optional = counts.optional ?? 0;
  const backlog = counts.not_this_pr ?? 0;
  const open = result.unresolved.length;

  const board = [
    "## Go / no-go",
    "",
    `| Signal | Count |`,
    `|--------|------:|`,
    `| **Before merge (blocks PR)** | **${before}** |`,
    `| Worth fixing here | ${worth} |`,
    `| Optional polish | ${optional} |`,
    `| Not this PR (file separately) | ${backlog} |`,
    `| Unresolved / human | ${open} |`,
    ""
  ];

  if (result.outcome === "good_to_merge") {
    board.push(
      "**Decision:** No accepted before-merge or worth-fixing blockers remain. Optional polish and not-this-PR items do not block merge.",
      ""
    );
  } else if (result.outcome === "needs_human") {
    board.push(
      "**Decision:** Human input needed on unresolved items before merge.",
      ""
    );
  } else {
    board.push(
      "**Decision:** Do **not** merge until before-merge items are fixed (and consider worth-fixing).",
      "Do **not** block this PR on not-this-PR backlog items — file them separately.",
      ""
    );
  }

  return board;
}

function renderProcessSection(ctx: ReviewContext): string[] {
  const process = ctx.process;
  if (!process || (process.notes.length === 0 && process.referenced_prs.length === 0)) {
    return [];
  }
  const lines = ["## Process / merge hygiene", ""];
  const flags = [
    process.is_draft != null ? `draft=${process.is_draft}` : null,
    process.mergeable ? `mergeable=${process.mergeable}` : null,
    process.mergeable_state ? `mergeStateStatus=${process.mergeable_state}` : null,
    process.review_decision ? `reviewDecision=${process.review_decision}` : null
  ].filter(Boolean);
  if (flags.length > 0) {
    lines.push(flags.join(" · "), "");
  }
  if (process.referenced_prs.length > 0) {
    lines.push("Referenced PRs/issues:", "");
    for (const ref of process.referenced_prs) {
      const state = ref.state ?? "?";
      const open = ref.is_open ? "OPEN" : state;
      const title = ref.title ? ` — ${ref.title}` : "";
      const url = ref.url ? ` (${ref.url})` : "";
      lines.push(`- #${ref.number} [${open}]${title}${url}`, "");
    }
  }
  if (process.notes.length > 0) {
    lines.push("Notes:", "");
    for (const note of process.notes) {
      lines.push(`- ${note}`, "");
    }
  }
  return lines;
}

function renderGoNoGoChecklist(result: NegotiationResult): string[] {
  const byBucket = groupByBucket(result.accepted);
  const lines: string[] = ["## Action checklist", ""];

  const before = byBucket.get("before_merge") ?? [];
  const worth = byBucket.get("worth_fixing") ?? [];
  const optional = byBucket.get("optional") ?? [];
  const backlog = byBucket.get("not_this_pr") ?? [];

  lines.push("### Required before push", "");
  if (before.length === 0 && result.unresolved.length === 0) {
    lines.push("None.", "");
  } else {
    for (const item of before) {
      lines.push(`- [ ] ${oneLiner(item)}`, "");
    }
    for (const item of result.unresolved) {
      lines.push(`- [ ] _(unresolved)_ ${oneLiner(item)}`, "");
    }
  }

  lines.push("### Recommended (same PR if cheap)", "");
  if (worth.length === 0) {
    lines.push("None.", "");
  } else {
    for (const item of worth) {
      lines.push(`- [ ] ${oneLiner(item)}`, "");
    }
  }

  lines.push("### Optional / take or leave", "");
  if (optional.length === 0) {
    lines.push("None.", "");
  } else {
    for (const item of optional) {
      lines.push(`- [ ] ${oneLiner(item)}`, "");
    }
  }

  lines.push("### File separately — do not block this PR", "");
  if (backlog.length === 0) {
    lines.push("None.", "");
  } else {
    for (const item of backlog) {
      lines.push(`- [ ] ${oneLiner(item)}`, "");
    }
  }

  return lines;
}

function oneLiner(item: PartitionedFinding): string {
  const f = item.finding;
  const id = "id" in f && f.id ? f.id : "unknown";
  const severity = "severity" in f && f.severity ? f.severity : "?";
  const claim = "claim" in f && f.claim ? f.claim.replace(/\s+/g, " ").trim() : "";
  const loc =
    "file" in f && f.file
      ? ` (\`${f.file}${f.line != null ? `:${f.line}` : ""}\`)`
      : "";
  const short = claim.length > 160 ? `${claim.slice(0, 157)}…` : claim;
  return `**${id}** (${severity})${loc}: ${short}`;
}

function countByBucket(items: PartitionedFinding[]): Record<FindingBucket | "unknown", number> {
  const counts = {
    before_merge: 0,
    worth_fixing: 0,
    optional: 0,
    not_this_pr: 0,
    unknown: 0
  };
  for (const item of items) {
    const b =
      "bucket" in item.finding && item.finding.bucket
        ? item.finding.bucket
        : ("unknown" as const);
    counts[b] += 1;
  }
  return counts;
}

function groupByBucket(items: PartitionedFinding[]): Map<FindingBucket | "unknown", PartitionedFinding[]> {
  const map = new Map<FindingBucket | "unknown", PartitionedFinding[]>();
  for (const item of items) {
    const bucket =
      "bucket" in item.finding && item.finding.bucket ? item.finding.bucket : ("unknown" as const);
    const list = map.get(bucket) ?? [];
    list.push(item);
    map.set(bucket, list);
  }
  // Severity order within bucket
  const rank: Record<string, number> = { blocker: 0, major: 1, minor: 2, nit: 3 };
  for (const [, list] of map) {
    list.sort((a, b) => {
      const sa = "severity" in a.finding && a.finding.severity ? rank[a.finding.severity] ?? 9 : 9;
      const sb = "severity" in b.finding && b.finding.severity ? rank[b.finding.severity] ?? 9 : 9;
      return sa - sb;
    });
  }
  return map;
}

function renderBucketed(title: string, items: PartitionedFinding[]): string[] {
  const lines = [`## ${title}`, ""];
  if (items.length === 0) {
    return [...lines, "None.", ""];
  }

  const byBucket = groupByBucket(items);

  for (const bucket of BUCKET_ORDER) {
    const list = byBucket.get(bucket);
    if (!list?.length) continue;
    lines.push(`### ${BUCKET_TITLE[bucket]}`, "");
    for (const item of list) {
      lines.push(...findingBlock(item));
    }
  }

  const unknown = byBucket.get("unknown");
  if (unknown?.length) {
    lines.push("### Uncategorized", "");
    for (const item of unknown) {
      lines.push(...findingBlock(item));
    }
  }

  return lines;
}

function section(title: string, items: PartitionedFinding[]): string[] {
  const lines = [`## ${title}`, ""];
  if (items.length === 0) {
    return [...lines, "None.", ""];
  }
  for (const item of items) {
    lines.push(...findingBlock(item));
  }
  return lines;
}

function findingBlock(item: PartitionedFinding): string[] {
  const finding = item.finding;
  const judgment = item.judgment;
  const id = "id" in finding ? finding.id : "unknown";
  const severity = "severity" in finding ? finding.severity : "unknown";
  const bucket = "bucket" in finding && finding.bucket ? ` · ${finding.bucket}` : "";
  const loc =
    "file" in finding && finding.file
      ? ` (\`${finding.file}${finding.line ? `:${finding.line}` : ""}\`)`
      : "";
  const lines = [
    `#### ${id}: ${severity}${bucket}${loc}`,
    "",
    `Claim: ${"claim" in finding ? finding.claim : ""}`,
    "",
    `Verdict: \`${judgment.verdict}\``,
    "",
    `Rationale: ${judgment.rationale}`,
    ""
  ];
  if ("evidence" in finding && finding.evidence.length > 0) {
    lines.push("Evidence:");
    for (const evidence of finding.evidence) {
      lines.push(`- ${evidence}`);
    }
    lines.push("");
  }
  if ("proposed_fix" in finding && finding.proposed_fix) {
    lines.push(`Proposed fix: ${finding.proposed_fix}`, "");
  }
  if (judgment.required_action) {
    lines.push(`Required action: ${judgment.required_action}`, "");
  }
  return lines;
}

function renderImplementerSummary(result: NegotiationResult): string[] {
  const roundsWithFix = result.rounds.filter((r) => r.implementer);
  if (roundsWithFix.length === 0) {
    return [];
  }
  const lines = ["## Fixes applied (implementer)", ""];
  for (const round of roundsWithFix) {
    lines.push(`### Round ${round.round_number}`, "");
    if (!round.implementer) continue;
    lines.push(round.implementer.summary, "");
    for (const a of round.implementer.applied) {
      const files = a.files_touched.length
        ? "Files: " + a.files_touched.map((f) => "`" + f + "`").join(", ")
        : "Files: (none)";
      lines.push(`#### ${a.finding_id}: ${a.status}`, "", files, "", a.notes, "");
    }
  }
  return lines;
}

function sanitizeTarget(target: string): string {
  return target.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    "-",
    pad(now.getMilliseconds(), 3),
    pad(Number(process.hrtime.bigint() % 1000n), 3)
  ].join("");
}

/** Build a go/no-go oriented summary from cumulative accepted findings (for orchestrator). */
export function synthesizeDecisionSummary(
  judgeSummary: string,
  accepted: PartitionedFinding[],
  unresolvedCount: number
): string {
  const counts = countByBucket(accepted);
  const parts = [
    `Accepted by bucket: before_merge=${counts.before_merge}, worth_fixing=${counts.worth_fixing}, optional=${counts.optional}, not_this_pr=${counts.not_this_pr}.`,
    unresolvedCount > 0 ? `Unresolved: ${unresolvedCount}.` : "Unresolved: 0."
  ];
  const before = accepted.filter(
    (a) => "bucket" in a.finding && a.finding.bucket === "before_merge"
  );
  if (before.length > 0) {
    parts.push(
      "Before merge: " +
        before
          .map((a) => ("id" in a.finding ? a.finding.id : "?"))
          .join(", ") +
        "."
    );
  }
  if (judgeSummary?.trim()) {
    parts.push(`Last judge note: ${judgeSummary.trim()}`);
  }
  return parts.join(" ");
}
