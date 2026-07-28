#!/usr/bin/env node

import { collectContext } from "../context/collect.js";
import { negotiate } from "../negotiation/orchestrator.js";
import { writeReport } from "../report/markdown.js";

interface Args {
  target?: string;
  repo: string;
  base: string;
  rounds: number;
  model?: string;
  out: string;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.rounds < 1) {
    throw new Error("--rounds must be at least 1");
  }

  const ctx = await collectContext(args.repo, args.target, args.base);
  const result = await negotiate(ctx, args.rounds, args.model);
  const reportPath = await writeReport(ctx, result, args.out);
  console.log(reportPath);
  return 0;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repo: ".", base: "main", rounds: 2, out: "robotneg-reports" };
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

function printHelp(): void {
  console.log(`Usage: robotneg [target] [--repo PATH] [--base BRANCH] [--rounds N] [--model MODEL] [--out DIR]

Run a local Codex-backed PR negotiation.

Arguments:
  target             GitHub PR URL, PR number, or omitted for local diff

Options:
  --repo PATH        Repository to review (default: .)
  --base BRANCH      Base branch for local diff mode (default: main)
  --rounds N         Maximum negotiation rounds (default: 2)
  --model MODEL      Optional Codex model override
  --out DIR          Output directory (default: robotneg-reports)
  -h, --help         Show help`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
