import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NegotiationResult, PartitionedFinding, ReviewContext } from "../types/models.js";

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

  const lines = [
    `# ${top}`,
    "",
    `Target: \`${ctx.target}\``,
    "",
    "## Summary",
    "",
    result.summary || "No summary provided.",
    "",
    ...section("Accepted Findings", result.accepted),
    ...section("Rejected Findings", result.rejected),
    ...section("Unresolved", result.unresolved),
    "## Negotiation Rounds",
    ""
  ];

  for (const round of result.rounds) {
    lines.push(`### Round ${round.round_number}`, "", `Critic: ${round.critic.summary}`, "", `Judge: ${round.judge.summary}`, "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function section(title: string, items: PartitionedFinding[]): string[] {
  const lines = [`## ${title}`, ""];
  if (items.length === 0) {
    return [...lines, "None.", ""];
  }

  for (const item of items) {
    const finding = item.finding;
    const judgment = item.judgment;
    lines.push(
      `### ${"id" in finding ? finding.id : "unknown"}: ${"severity" in finding ? finding.severity : "unknown"}`,
      "",
      `Claim: ${"claim" in finding ? finding.claim : ""}`,
      "",
      `Verdict: \`${judgment.verdict}\``,
      "",
      `Rationale: ${judgment.rationale}`,
      ""
    );
    if ("evidence" in finding && finding.evidence.length > 0) {
      lines.push("Evidence:");
      for (const evidence of finding.evidence) {
        lines.push(`- ${evidence}`);
      }
      lines.push("");
    }
    if (judgment.required_action) {
      lines.push(`Required action: ${judgment.required_action}`, "");
    }
  }

  return lines;
}

function sanitizeTarget(target: string): string {
  return target.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "");
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
