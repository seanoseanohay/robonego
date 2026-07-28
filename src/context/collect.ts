import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ReviewContext } from "../types/models.js";

const MAX_UNTRACKED_FILES = 25;
const MAX_UNTRACKED_CHARS = 80_000;
const MAX_UNTRACKED_FILE_CHARS = 20_000;

export async function collectContext(repoInput: string, target: string | undefined, base: string): Promise<ReviewContext> {
  const repo = path.resolve(repoInput);
  if (target) {
    const metadata = await runRequired(
      "gh",
      ["pr", "view", target, "--json", "title,body,author,baseRefName,headRefName,url"],
      repo
    );
    const diff = await runRequired("gh", ["pr", "diff", target], repo);
    return { repo, target, metadata, diff };
  }

  const metadata = await runRequired("git", ["status", "--short", "--branch"], repo);
  const parts = [
    await baseDiff(repo, base),
    await trackedWorktreeContext(repo),
    await untrackedContext(repo)
  ].filter((part) => part.trim().length > 0);

  return { repo, target: `local diff against ${base}`, metadata, diff: parts.join("\n\n") };
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
