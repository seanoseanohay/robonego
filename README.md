# robotneg

`robotneg` removes you from the middle of a picky PR review loop.

The local MVP runs two Codex-backed roles against a PR or local diff:

- **Critic**: adversarial, picky reviewer that emits concrete findings.
- **Judge**: skeptical evaluator that accepts, rejects, revises, or escalates each finding.

It writes a Markdown decision report. It does not change code or post to GitHub yet.

## Requirements

- `codex` CLI installed and logged in with your Codex subscription
- `gh` CLI for GitHub PR metadata/diffs
- Node.js 22+

## Usage

From this repo:

```bash
npm install
npm run build
node dist/cli/index.js https://github.com/OWNER/REPO/pull/123 --repo /path/to/repo
```

For a local branch diff:

```bash
node dist/cli/index.js --repo /path/to/repo --base main
```

During development:

```bash
npm run dev -- --repo /path/to/repo --base main
```

Reports are written to `robotneg-reports/` by default.

`--rounds` is kept for the future multi-round policy, but the current MVP stops
after the first judge pass and reports `revise` as `HUMAN REVIEW REQUIRED`.

## Safety

The MVP runs Codex workers with:

```bash
--sandbox read-only
```

Future patching and GitHub posting should be implemented as explicit action
sinks after the Markdown report is trustworthy.

## Output Contract

The first line of the report is one of:

- `# GOOD TO MERGE`
- `# CHANGES NEEDED`
- `# HUMAN REVIEW REQUIRED`

Each run also writes the raw negotiation JSON next to the Markdown report.
