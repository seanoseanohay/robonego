# robonego

`robonego` removes you from the middle of a picky PR review loop.

**Thorough multi-angle review is always the default** (thermo). You never need
`--mode thermo`. Only pass `--quick` if you intentionally want a shallow skim.

Default path:

1. **Parallel Critic lenses** — independent specialists look at the PR from different angles, each going deep instead of skimming a giant checklist:
   - `correctness` — bugs, races, error paths, invariants
   - `security` — authn/authz, injection, secrets, trust boundaries
   - `product` — UX, theme, a11y, empty states, lying copy
   - `contracts` — API shapes, backend paths, storage bleed
   - `thermo` — maintainability / structure / spaghetti / “code judo” (Cursor thermo-nuclear bar)
   - `tests` — coverage honesty, checklist vs code, not-this-PR ghosts
   - `process` — sibling PRs, mergeable/blocked state, draft/reviews, story overlap
2. **Merge** — findings are prefixed by lens, lightly deduped, severity-sorted.
3. **Judge** — adversarial on *claims*: keeps evidenced product/UI/backend/structural findings; kills noise and hallucinations.
4. **Rounds** — open items can refine after judge feedback until clean, max rounds, or human escalation.
5. **Optional `--fix`** — guarded **Implementer** applies only allowlisted accepted findings, then re-reviews the updated tree.

Default is **review-only** (no mutation). `--fix` is opt-in.

## Why this exists

Manual “Codex + $reviewer, be brutal” often finds serious issues. A soft multi-agent loop finds nits.  
A single critic with ten lenses in one prompt still **skims**. Thermonuclear mode forces **separate deep passes** so issues get found from every angle, then the Judge keeps only what holds up.

## Requirements

- `codex` CLI installed and logged in
- `gh` CLI for GitHub PR metadata/diffs
- Node.js 22+

## Usage

```bash
npm install
npm run build

# GitHub PR
node dist/cli/index.js https://github.com/OWNER/REPO/pull/123 --repo /path/to/repo

# Local branch vs main
node dist/cli/index.js --repo /path/to/repo --base main

# Multi-round with sticky memory (default state under robotneg-reports/state/...)
node dist/cli/index.js 123 --repo /path/to/repo --rounds 3

# Intentional shallow skim only (not recommended)
node dist/cli/index.js 123 --repo /path/to/repo --quick

# Subset of lenses (still multi-angle, just fewer specialists)
node dist/cli/index.js 123 --repo /path/to/repo --lenses correctness,security,thermo

# Review + guarded fix round (mutates local worktree; be on the PR branch)
node dist/cli/index.js 123 --repo /path/to/repo --fix --rounds 3

# Also auto-fix worth_fixing (still never not_this_pr)
node dist/cli/index.js 123 --repo /path/to/repo --fix --fix-buckets before_merge,worth_fixing
```

Dev:

```bash
npm run dev -- --repo /path/to/repo --base main --rounds 2
```

Reports land in `robotneg-reports/` by default.  
Role memory: `robotneg-reports/state/<target>/critic-memory.md` and `judge-memory.md`.  
Per-lens artifacts (thermo): `.../rounds/round-0-critic-<lens>.json`.

## Options

| Flag | Meaning |
|------|---------|
| `--repo PATH` | Repo to review (default `.`) |
| `--base BRANCH` | Local diff base (default `main`) |
| `--rounds N` | Max critic/judge rounds (default `2`) |
| `--mode thermo\|single` | Default **thermo** (thorough). Usually omit this flag. |
| `--quick` | Shallow single-pass only (opt out of thorough) |
| `--lenses LIST` | Comma-separated lens ids (default: all) |
| `--fix` | Enable guarded Implementer between rounds (**mutates worktree**) |
| `--fix-buckets LIST` | Buckets to fix (default `before_merge`; never `not_this_pr`) |
| `--fix-max N` | Max findings per implementer pass (default 8) |
| `--fix-min-confidence N` | Confidence floor 0–1 (default 0.6) |
| `--model MODEL` | Codex model override |
| `--out DIR` | Report directory |
| `--state-dir DIR` | Sticky memory + round JSON |
| `--no-memory` | Disable sticky memory |
| `--timeout-ms N` | Per Codex call (default 10m) |

Exit codes: `0` good to merge · `2` changes/human needed · `1` tool failure.

## Safety

Critic and Judge always run with:

```bash
--sandbox read-only
```

`--fix` Implementer uses `--sandbox workspace-write` **only** on findings that pass guards:

| Guard | Rule |
|-------|------|
| Verdict | `accept` only |
| Bucket default | `before_merge` only |
| Hard block | never `not_this_pr` |
| Fix text | non-empty `proposed_fix` |
| Confidence | ≥ `--fix-min-confidence` (default 0.6) |
| Nits | skipped by default |
| Cap | `--fix-max` (default 8) |

After any applied fix, context is re-collected from the **local worktree** and a full re-review runs. Be on the PR branch (or a worktree of it) before using `--fix`.

Untrusted PR/diff content is wrapped so agents treat it as data, not instructions.

## Design notes

- **Separate contexts** for Critic and Judge (files under `--state-dir`).
- Shared artifacts: diff, findings, judgments, Markdown report — not one blended chat.
- Auto-fix (Implementer role) and GitHub posting are deferred until reports are trustworthy.
- Pi is optional later; orchestration here is intentional and small.

## Output contract

First line of the report is one of:

- `# GOOD TO MERGE`
- `# CHANGES NEEDED`
- `# HUMAN REVIEW REQUIRED`

Raw negotiation JSON is written next to the Markdown report.
