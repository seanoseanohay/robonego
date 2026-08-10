#!/usr/bin/env node

import path from "node:path";
import { REVIEW_LENSES } from "../agents/lenses.js";
import { collectContext } from "../context/collect.js";
import { DEFAULT_FIX_BUCKETS, parseFixBuckets } from "../negotiation/fixGuards.js";
import { negotiate } from "../negotiation/orchestrator.js";
import { writeReport } from "../report/markdown.js";
import type { FindingBucket, ReviewMode } from "../types/models.js";

interface Args {
  target?: string;
  repo: string;
  base: string;
  rounds: number;
  model?: string;
  out: string;
  stateDir?: string;
  noMemory: boolean;
  timeoutMs: number;
  mode: ReviewMode;
  lenses?: string[];
  fix: boolean;
  fixBuckets: FindingBucket[];
  fixMax: number;
  fixMinConfidence: number;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.rounds < 1) {
    throw new Error("--rounds must be at least 1");
  }
  if (args.fix && args.rounds < 2) {
    console.error("robonego: --fix usually needs --rounds >= 2 (fix then re-review); bumping to 2");
    args.rounds = 2;
  }

  const ctx = await collectContext(args.repo, args.target, args.base);
  console.error(`robonego: reviewing ${ctx.target}`);
  console.error(`robonego: repo ${ctx.repo}`);
  if (ctx.changedFiles) {
    const n = ctx.changedFiles.split("\n").filter(Boolean).length;
    console.error(`robonego: ${n} changed file(s)`);
  }
  if (args.mode === "thermo") {
    console.error("robonego: thorough multi-angle review (thermo — always default)");
  } else {
    console.error("robonego: mode single/quick (shallow one-pass; not recommended)");
  }
  if (args.fix) {
    console.error(
      `robonego: fix stage ON — buckets=[${args.fixBuckets.join(",")}] max=${args.fixMax} minConfidence=${args.fixMinConfidence}`
    );
    console.error(
      "robonego: WARNING: --fix mutates the local worktree (workspace-write). Use a clean branch/worktree."
    );
  }
  console.error(`robonego: max rounds ${args.rounds}`);

  const stateDir =
    args.stateDir ??
    path.join(args.out, "state", sanitize(ctx.target).slice(0, 60) || "review");

  const result = await negotiate(ctx, {
    maxRounds: args.rounds,
    model: args.model,
    stateDir: args.noMemory ? undefined : stateDir,
    noMemory: args.noMemory,
    timeoutMs: args.timeoutMs,
    mode: args.mode,
    lenses: args.lenses,
    fix: args.fix
      ? {
          enabled: true,
          buckets: args.fixBuckets,
          maxFixes: args.fixMax,
          minConfidence: args.fixMinConfidence
        }
      : { enabled: false }
  });

  const reportPath = await writeReport(ctx, result, args.out);
  console.error(`robonego: outcome ${result.outcome}`);
  console.error(
    `robonego: accepted=${result.accepted.length} rejected=${result.rejected.length} unresolved=${result.unresolved.length}`
  );
  console.log(reportPath);
  return result.outcome === "good_to_merge" ? 0 : 2;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    repo: ".",
    base: "main",
    rounds: 2,
    out: "robotneg-reports",
    noMemory: false,
    timeoutMs: 600_000,
    mode: "thermo",
    fix: false,
    fixBuckets: [...DEFAULT_FIX_BUCKETS],
    fixMax: 8,
    fixMinConfidence: 0.6
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "-h" || value === "--help") {
      printHelp();
      process.exit(0);
    }
    if (value === "--repo") {
      args.repo = requireValue(argv, ++index, value);
    } else if (value === "--base") {
      args.base = requireValue(argv, ++index, value);
    } else if (value === "--rounds") {
      args.rounds = Number.parseInt(requireValue(argv, ++index, value), 10);
      if (Number.isNaN(args.rounds)) {
        throw new Error("--rounds must be a number");
      }
    } else if (value === "--model") {
      args.model = requireValue(argv, ++index, value);
    } else if (value === "--out") {
      args.out = requireValue(argv, ++index, value);
    } else if (value === "--state-dir") {
      args.stateDir = requireValue(argv, ++index, value);
    } else if (value === "--no-memory") {
      args.noMemory = true;
    } else if (value === "--timeout-ms") {
      args.timeoutMs = Number.parseInt(requireValue(argv, ++index, value), 10);
      if (Number.isNaN(args.timeoutMs) || args.timeoutMs < 1) {
        throw new Error("--timeout-ms must be a positive number");
      }
    } else if (value === "--mode") {
      const mode = requireValue(argv, ++index, value);
      if (mode !== "thermo" && mode !== "single") {
        throw new Error('--mode must be "thermo" or "single" (default is always thermo/thorough)');
      }
      args.mode = mode;
    } else if (value === "--quick") {
      // Explicit opt-out of thorough multi-angle. Prefer leaving this unset.
      args.mode = "single";
    } else if (value === "--lenses") {
      const raw = requireValue(argv, ++index, value);
      args.lenses = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (args.lenses.length === 0) {
        throw new Error("--lenses requires a comma-separated list of lens ids");
      }
    } else if (value === "--fix") {
      args.fix = true;
    } else if (value === "--fix-buckets") {
      args.fixBuckets = parseFixBuckets(requireValue(argv, ++index, value));
    } else if (value === "--fix-max") {
      args.fixMax = Number.parseInt(requireValue(argv, ++index, value), 10);
      if (Number.isNaN(args.fixMax) || args.fixMax < 1) {
        throw new Error("--fix-max must be a positive number");
      }
    } else if (value === "--fix-min-confidence") {
      args.fixMinConfidence = Number.parseFloat(requireValue(argv, ++index, value));
      if (
        Number.isNaN(args.fixMinConfidence) ||
        args.fixMinConfidence < 0 ||
        args.fixMinConfidence > 1
      ) {
        throw new Error("--fix-min-confidence must be between 0 and 1");
      }
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else if (!args.target) {
      args.target = value;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
  }
  return args;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function sanitize(target: string): string {
  return target.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function printHelp(): void {
  const lensList = REVIEW_LENSES.map((l) => `    ${l.id.padEnd(12)} ${l.oneLiner}`).join("\n");
  console.log(`Usage: robonego [target] [options]

  (alias: robotneg)

Thermonuclear Codex-backed PR negotiation: multi-angle Critic lenses + Judge,
optional guarded Implementer (--fix), sticky memory, multi-round.

Thorough multi-angle review (thermo) is ALWAYS the default. You do not need
--mode thermo. Use --quick only if you intentionally want a shallow skim.

Default is review-only (no code mutation). Add --fix to apply accepted
before_merge findings between rounds, then re-review.

Arguments:
  target               GitHub PR URL, PR number, or omit for local diff

Options:
  --repo PATH          Repository to review (default: .)
  --base BRANCH        Base branch for local diff mode (default: main)
  --rounds N           Maximum negotiation rounds (default: 2; --fix bumps to 2 min)
  --mode thermo|single Review depth (default: thermo = thorough; always omit this)
  --quick              Shallow single-pass critic (opt out of thorough multi-angle)
  --lenses LIST        Comma-separated lens ids (default: all thorough lenses)
${lensList}
  --fix                Enable guarded Implementer between rounds (MUTATES worktree)
  --fix-buckets LIST  Buckets to auto-fix (default: before_merge)
                         allowed: before_merge,worth_fixing,optional
                         never: not_this_pr (hard guard)
  --fix-max N          Max findings per implementer pass (default: 8)
  --fix-min-confidence Confidence floor 0..1 (default: 0.6)
  --model MODEL        Optional Codex model override
  --out DIR            Output directory (default: robotneg-reports)
  --state-dir DIR      Sticky role memory + round artifacts
                       (default: <out>/state/<target>)
  --no-memory          Disable sticky role memory
  --timeout-ms N       Per Codex call timeout (default: 600000)
  -h, --help           Show help

Exit codes:
  0  GOOD TO MERGE
  2  CHANGES NEEDED or HUMAN REVIEW REQUIRED
  1  tool failure

Safety:
  Critic/Judge always use Codex --sandbox read-only.
  Implementer (--fix) uses workspace-write only on allowlisted accepted findings.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
