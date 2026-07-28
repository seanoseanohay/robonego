import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { z } from "zod";

export class CodexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexError";
  }
}

export async function runCodexJson<T>(
  repo: string,
  prompt: string,
  jsonSchema: unknown,
  validator: z.ZodType<T>,
  model?: string,
  timeoutMs = 300_000
): Promise<T> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "robotneg-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "out.json");

  try {
    await writeFile(schemaPath, JSON.stringify(jsonSchema, null, 2), "utf8");

    const args = [
      "exec",
      "--cd",
      repo,
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--color",
      "never"
    ];
    if (model) {
      args.push("--model", model);
    }
    args.push("-");

    const result = await runProcess("codex", args, repo, prompt, timeoutMs);
    if (result.code !== 0) {
      throw new CodexError(
        `Codex worker failed\ncommand: codex ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }

    const raw = (await readFile(outputPath, "utf8")).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new CodexError(`Codex did not return valid JSON: ${raw}`);
    }
    return validator.parse(parsed);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  stdin: string,
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let didTimeout = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      didTimeout = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 5_000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      if (didTimeout) {
        reject(new CodexError(`Codex worker timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}
