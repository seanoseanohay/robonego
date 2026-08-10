# Architecture

## Roles

| Role | Job | Context |
|------|-----|---------|
| **Lens Critic(s)** | Specialist deep pass per angle (thermo mode) | Shared diff; own prompt; parallel |
| **Critic (single)** | Full multi-checklist pass (`--mode single`) | Sticky memory + shared diff |
| **Judge** | Accept/reject/revise findings; keep real bugs | Own sticky memory + merged critic JSON |
| **Implementer** | Opt-in (`--fix`): apply guard-allowlisted accepted fixes | workspace-write + sticky memory |

## Thermo multi-angle flow (default)

One shallow “run all 10 checklists” critic still misses issues. Thermo mode mirrors Cursor-style thoroughness by **splitting angles**:

```text
diff ──┬── correctness critic ──┐
       ├── security critic ─────┤
       ├── product critic ──────┤
       ├── contracts critic ────┼── merge (prefix ids, light dedupe) ── Judge
       ├── thermo (maintain.) ──┤
       ├── tests / scope ───────┤
       └── process (siblings,  ─┘
            mergeable, draft)
```

Process hints (`mergeStateStatus`, referenced `#PRs`, story ids) are collected in
`context/processHints.ts` and injected into PR metadata + the report.

Lenses live in `src/agents/lenses.ts`. Merge in `src/agents/mergeFindings.ts`.

Round 2+ without `--fix` (if Judge returns revise/needs_human): a **refine** critic rewrites only open findings — not a full 6-lens re-run.

With `--fix`:

```text
Judge accept ──► fix guards ──► Implementer (workspace-write)
                      │                    │
                      │ skip not_this_pr   ▼
                      │ optional, …   refresh local diff
                      │                    │
                      └──────────────► full re-review (thermo or single)
```

Guards live in `src/negotiation/fixGuards.ts`.

## Flow

1. `context.collect_context` — PR metadata, changed files, diff (capped).
2. For each round up to `--rounds`:
   - Round 1 + thermo: parallel lens critics → merge → Judge.
   - Later rounds or `--mode single`: one critic (full or refine) → Judge.
   - Update sticky role memories (best-effort).
   - Stop if nothing material remains open.
3. `report.write_report` — Markdown + raw JSON (includes mode + lens list).

## Why sticky memory

Each role remembers what already happened across rounds:

- Critic avoids pure duplicate nits; digs deeper on revise.
- Judge remembers false-positive patterns and thrash.

Shared state is **artifacts** (diff, findings, judgments), not one mixed chat.

## Non-mutation boundary

MVP does not mutate the reviewed repository. Future:

```text
result -> apply accepted fixes -> re-run critic/judge
result -> github_review comments
```
