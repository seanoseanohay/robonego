import { spawn } from "node:child_process";
import type { ProcessHints } from "../types/models.js";

interface GhPrView {
  number?: number;
  title?: string;
  body?: string;
  isDraft?: boolean;
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  baseRefName?: string;
  headRefName?: string;
  url?: string;
  state?: string;
}

/**
 * Build process/PR-hygiene hints: mergeability, draft, referenced sibling PRs.
 * Best-effort — never throws; empty notes if gh fails.
 */
export async function collectProcessHints(
  repo: string,
  target: string,
  prJson: string
): Promise<ProcessHints> {
  const notes: string[] = [];
  let parsed: GhPrView = {};
  try {
    parsed = JSON.parse(prJson) as GhPrView;
  } catch {
    return { referenced_prs: [], notes: ["Could not parse PR metadata JSON for process hints."] };
  }

  const mergeable = parsed.mergeable ?? null;
  // gh uses mergeStateStatus (CLEAN, DIRTY, BLOCKED, BEHIND, UNSTABLE, HAS_HOOKS, UNKNOWN)
  // and sometimes mergeable_state in other APIs — accept both via cast
  const raw = parsed as GhPrView & { mergeableState?: string; mergeStateStatus?: string };
  const mergeableState = raw.mergeStateStatus ?? raw.mergeableState ?? null;
  const reviewDecision = parsed.reviewDecision ?? null;
  const isDraft = Boolean(parsed.isDraft);

  if (isDraft) {
    notes.push("PR is a draft — not ready to merge until marked ready.");
  }
  if (mergeable === "CONFLICTING" || mergeableState === "DIRTY") {
    notes.push("PR has merge conflicts (mergeable=CONFLICTING / mergeStateStatus=DIRTY).");
  }
  if (mergeableState === "BLOCKED") {
    notes.push(
      "GitHub mergeStateStatus=BLOCKED (required checks/reviews/branch protection). Investigate before treating as ready."
    );
  }
  if (mergeableState === "BEHIND") {
    notes.push("PR branch is behind base (mergeStateStatus=BEHIND); may need update/rebase.");
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    notes.push("Review decision is CHANGES_REQUESTED.");
  } else if (reviewDecision === "APPROVED") {
    notes.push("Review decision is APPROVED.");
  } else if (!reviewDecision) {
    notes.push("No formal review decision yet (unreviewed or reviews not required).");
  }

  const selfNum = parsed.number;
  const bodyAndTitle = `${parsed.title ?? ""}\n${parsed.body ?? ""}`;
  const refs = extractPrNumbers(bodyAndTitle).filter((n) => n !== selfNum);

  const referenced_prs: ProcessHints["referenced_prs"] = [];
  for (const num of refs.slice(0, 12)) {
    const sibling = await fetchSiblingPr(repo, num);
    if (sibling) {
      referenced_prs.push(sibling);
      if (sibling.is_open) {
        notes.push(
          `Referenced open PR #${num}${sibling.title ? ` (“${sibling.title}”)` : ""} — consider drop/rebase/coordinate if this PR overlaps that work.`
        );
      } else if (sibling.state === "MERGED") {
        notes.push(
          `Referenced PR #${num} is already MERGED — ensure this PR is rebased and does not re-land the same hunks.`
        );
      }
    } else {
      referenced_prs.push({ number: num });
      notes.push(`Referenced PR/issue #${num} could not be resolved via gh.`);
    }
  }

  // Story / ticket ids like sc-138981 (informational)
  const stories = extractStoryIds(bodyAndTitle);
  if (stories.length > 0) {
    notes.push(`Story/ticket refs in PR text: ${stories.join(", ")}.`);
  }

  return {
    mergeable,
    mergeable_state: mergeableState,
    review_decision: reviewDecision,
    is_draft: isDraft,
    referenced_prs,
    notes
  };
}

export function extractPrNumbers(text: string): number[] {
  const found = new Set<number>();
  // #1234 or github.com/org/repo/pull/1234
  const hash = /#(\d{1,7})\b/g;
  const url = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d{1,7})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = hash.exec(text)) !== null) {
    found.add(Number.parseInt(m[1]!, 10));
  }
  while ((m = url.exec(text)) !== null) {
    found.add(Number.parseInt(m[1]!, 10));
  }
  return [...found].sort((a, b) => a - b);
}

export function extractStoryIds(text: string): string[] {
  const found = new Set<string>();
  const re = /\bsc-\d{4,7}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[0]!.toLowerCase());
  }
  return [...found].sort();
}

export function formatProcessHintsForMetadata(process: ProcessHints): string {
  return JSON.stringify(
    {
      mergeable: process.mergeable,
      mergeable_state: process.mergeable_state,
      review_decision: process.review_decision,
      is_draft: process.is_draft,
      referenced_prs: process.referenced_prs,
      process_notes: process.notes
    },
    null,
    2
  );
}

async function fetchSiblingPr(
  repo: string,
  number: number
): Promise<ProcessHints["referenced_prs"][0] | null> {
  try {
    const raw = await runRequired(
      "gh",
      ["pr", "view", String(number), "--json", "number,title,state,url,isDraft"],
      repo
    );
    const p = JSON.parse(raw) as {
      number: number;
      title?: string;
      state?: string;
      url?: string;
      isDraft?: boolean;
    };
    const state = p.state ?? "UNKNOWN";
    return {
      number: p.number,
      title: p.title,
      state,
      url: p.url,
      is_open: state === "OPEN" || p.isDraft === true
    };
  } catch {
    // Maybe an issue, not a PR
    try {
      const raw = await runRequired(
        "gh",
        ["issue", "view", String(number), "--json", "number,title,state,url"],
        repo
      );
      const p = JSON.parse(raw) as {
        number: number;
        title?: string;
        state?: string;
        url?: string;
      };
      return {
        number: p.number,
        title: p.title,
        state: p.state,
        url: p.url,
        is_open: p.state === "OPEN"
      };
    } catch {
      return null;
    }
  }
}

async function runRequired(command: string, args: string[], cwd: string): Promise<string> {
  const result = await run(command, args, cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr || `exit ${result.code}`);
  }
  return result.stdout.trim();
}

async function run(
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
