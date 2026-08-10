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

export type CodexSandbox = "read-only" | "workspace-write" | "danger-full-access";

export interface RunCodexJsonOptions {
  model?: string;
  timeoutMs?: number;
  /** Default read-only. Use workspace-write only for Implementer (--fix). */
  sandbox?: CodexSandbox;
}

export async function runCodexJson<T>(
  repo: string,
  prompt: string,
  jsonSchema: unknown,
  validator: z.ZodType<T>,
  modelOrOptions?: string | RunCodexJsonOptions,
  timeoutMsLegacy = 600_000
): Promise<T> {
  const options: RunCodexJsonOptions =
    typeof modelOrOptions === "string" || modelOrOptions === undefined
      ? { model: modelOrOptions, timeoutMs: timeoutMsLegacy, sandbox: "read-only" }
      : { sandbox: "read-only", ...modelOrOptions };

  const tempDir = await mkdtemp(path.join(tmpdir(), "robotneg-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "out.json");

  try {
    await writeFile(schemaPath, JSON.stringify(jsonSchema, null, 2), "utf8");

    const sandbox = options.sandbox ?? "read-only";
    const args = [
      "exec",
      "--cd",
      repo,
      "--sandbox",
      sandbox,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--color",
      "never"
    ];
    // Non-interactive write path: do not prompt for workspace edits.
    // Keeps sandbox (unlike --dangerously-bypass-approvals-and-sandbox).
    if (sandbox === "workspace-write") {
      args.push("-c", "approval_policy=never");
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    args.push("-");

    const result = await runProcess(
      "codex",
      args,
      repo,
      prompt,
      options.timeoutMs ?? 600_000
    );
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
