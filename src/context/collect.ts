import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ReviewContext } from "../types/models.js";
import { collectProcessHints, formatProcessHintsForMetadata } from "./processHints.js";

const MAX_UNTRACKED_FILES = 25;
const MAX_UNTRACKED_CHARS = 80_000;
const MAX_UNTRACKED_FILE_CHARS = 20_000;
const MAX_DIFF_CHARS = 400_000;

const PR_VIEW_FIELDS = [
  "number",
  "title",
  "body",
  "author",
  "baseRefName",
  "headRefName",
  "url",
  "files",
  "additions",
  "deletions",
  "isDraft",
  "mergeable",
  "mergeStateStatus",
  "reviewDecision",
  "state",
  "statusCheckRollup"
].join(",");

export async function collectContext(repoInput: string, target: string | undefined, base: string): Promise<ReviewContext> {
  const repo = path.resolve(repoInput);
  if (target) {
    const metadataRaw = await runRequired(
      "gh",
      ["pr", "view", target, "--json", PR_VIEW_FIELDS],
      repo
    );
    const process = await collectProcessHints(repo, target, metadataRaw);
    const metadata = enrichMetadata(metadataRaw, process);
    const changedFiles = await runRequired("gh", ["pr", "diff", target, "--name-only"], repo);
    let diff = await runRequired("gh", ["pr", "diff", target], repo);
    diff = truncate(diff, MAX_DIFF_CHARS, "\n[diff truncated by robotneg]\n");
    let prBase = base;
    try {
      const parsed = JSON.parse(metadataRaw) as { baseRefName?: string };
      if (parsed.baseRefName) {
        prBase = parsed.baseRefName;
      }
    } catch {
      // keep requested base
    }
    return { repo, target, metadata, diff, changedFiles, base: prBase, process };
  }

  return collectLocalContext(repo, `local diff against ${base}`, base);
}

function enrichMetadata(metadataRaw: string, process: Awaited<ReturnType<typeof collectProcessHints>>): string {
  return [
    metadataRaw,
    "",
    "--- robotneg process hints ---",
    formatProcessHintsForMetadata(process)
  ].join("\n");
}

/**
 * Re-collect after --fix mutations so the next critic sees local edits.
 * Keeps original PR target/metadata when provided; rebuilds diff from the worktree.
 */
export async function refreshContextAfterFix(ctx: ReviewContext): Promise<ReviewContext> {
  const base = ctx.base ?? "main";
  const local = await collectLocalContext(ctx.repo, ctx.target, base);
  return {
    ...local,
    target: ctx.target,
    metadata: `${ctx.metadata}\n\n[robotneg] context refreshed from local worktree after implementer (--fix).`,
    base,
    process: ctx.process
  };
}

async function collectLocalContext(repo: string, target: string, base: string): Promise<ReviewContext> {
  const metadata = await runRequired("git", ["status", "--short", "--branch"], repo);
  const nameOnlyTracked = (await run("git", ["diff", "--name-only", `${base}...HEAD`], repo)).stdout.trim();
  const nameOnlyWorktree = (await run("git", ["diff", "--name-only"], repo)).stdout.trim();
  const nameOnlyStaged = (await run("git", ["diff", "--cached", "--name-only"], repo)).stdout.trim();
  const changedFiles = [...new Set(
    [...nameOnlyTracked.split("\n"), ...nameOnlyWorktree.split("\n"), ...nameOnlyStaged.split("\n")]
      .map((l) => l.trim())
      .filter(Boolean)
  )].join("\n");

  const parts = [
    await baseDiff(repo, base),
    await trackedWorktreeContext(repo),
    await untrackedContext(repo)
  ].filter((part) => part.trim().length > 0);

  let diff = parts.join("\n\n");
  diff = truncate(diff, MAX_DIFF_CHARS, "\n[diff truncated by robotneg]\n");

  return {
    repo,
    target,
    metadata,
    diff,
    changedFiles,
    base
  };
}

export async function baseDiff(repo: string, base: string): Promise<string> {
  const result = await run("git", ["diff", `${base}...HEAD`], repo);
  if (result.code === 0) {
    return result.stdout.trim();
  }
  if (!(await hasHead(repo))) {
    return "";
  }
  throw new Error(`Could not diff against base '${base}'. Check --base or pass a PR target.\n${result.stderr.trim()}`);
}

export async function trackedWorktreeContext(repo: string): Promise<string> {
  const staged = (await run("git", ["diff", "--cached"], repo)).stdout.trim();
  const unstaged = (await run("git", ["diff"], repo)).stdout.trim();
  const sections = [];
  if (staged) {
    sections.push(`Staged tracked changes:\n${staged}`);
  }
  if (unstaged) {
    sections.push(`Unstaged tracked changes:\n${unstaged}`);
  }
  return sections.join("\n\n");
}

export async function untrackedContext(repo: string): Promise<string> {
  const output = await run("git", ["ls-files", "--others", "--exclude-standard"], repo);
  const files = output.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (files.length === 0) {
    return "";
  }

  const sections = ["Untracked files included in local review context:"];
  let includedFiles = 0;
  let includedChars = 0;
  let omittedFiles = 0;
  for (const relative of files) {
    if (includedFiles >= MAX_UNTRACKED_FILES || includedChars >= MAX_UNTRACKED_CHARS) {
      omittedFiles += 1;
      continue;
    }

    const fullPath = path.join(repo, relative);
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) {
        sections.push(`\n## ${relative}\nSkipped: not a regular file.`);
        continue;
      }
      const data = await readFile(fullPath);
      if (data.includes(0)) {
        sections.push(`\n## ${relative}\nSkipped: binary file.`);
        continue;
      }
      let text = data.toString("utf8");
      const remainingChars = MAX_UNTRACKED_CHARS - includedChars;
      const fileBudget = Math.min(MAX_UNTRACKED_FILE_CHARS, remainingChars);
      if (fileBudget <= 0) {
        omittedFiles += 1;
        continue;
      }
      if (text.length > fileBudget) {
        text = `${text.slice(0, fileBudget)}\n[truncated by robotneg]`;
      }
      sections.push(`\n## ${relative}\n\`\`\`text\n${text}\n\`\`\``);
      includedFiles += 1;
      includedChars += text.length;
    } catch (error) {
      sections.push(`\n## ${relative}\nSkipped: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  if (omittedFiles > 0) {
    sections.push(`\nOmitted ${omittedFiles} untracked file(s) after context budget was reached.`);
  }
  return sections.join("\n");
}

function truncate(text: string, max: number, suffix: string): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

async function hasHead(repo: string): Promise<boolean> {
  const result = await run("git", ["rev-parse", "--verify", "HEAD"], repo);
  return result.code === 0;
}

async function runRequired(command: string, args: string[], cwd: string): Promise<string> {
  const result = await run(command, args, cwd);
  if (result.code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
