import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { baseDiff, trackedWorktreeContext, untrackedContext } from "../src/context/collect.js";

test("untrackedContext includes text files", async () => {
  const repo = await tempRepo();
  try {
    await writeFile(path.join(repo, "new_file.ts"), "console.log('hello');\n", "utf8");

    const context = await untrackedContext(repo);

    assert.match(context, /new_file\.ts/);
    assert.match(context, /console\.log\('hello'\)/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("baseDiff raises for invalid base when HEAD exists", async () => {
  const repo = await tempRepo();
  try {
    git(repo, "config", "user.email", "robotneg@example.test");
    git(repo, "config", "user.name", "robotneg");
    await writeFile(path.join(repo, "tracked.txt"), "hello\n", "utf8");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "initial");

    await assert.rejects(() => baseDiff(repo, "missing-base"), /Could not diff against base/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("trackedWorktreeContext includes unstaged tracked changes", async () => {
  const repo = await tempRepo();
  try {
    git(repo, "config", "user.email", "robotneg@example.test");
    git(repo, "config", "user.name", "robotneg");
    const target = path.join(repo, "tracked.txt");
    await writeFile(target, "hello\n", "utf8");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "initial");
    await writeFile(target, "hello\nworld\n", "utf8");

    const context = await trackedWorktreeContext(repo);

    assert.match(context, /Unstaged tracked changes/);
    assert.match(context, /\+world/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("untrackedContext summarizes files omitted by aggregate budget", async () => {
  const repo = await tempRepo();
  try {
    for (let index = 0; index < 30; index += 1) {
      await writeFile(path.join(repo, `file-${index}.txt`), `content ${index}\n`, "utf8");
    }

    const context = await untrackedContext(repo);

    assert.match(context, /Omitted 5 untracked file\(s\)/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

async function tempRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), "robotneg-test-"));
  git(repo, "init");
  return repo;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
