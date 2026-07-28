# Architecture

`robotneg` is intentionally split into replaceable parts.

## Current Flow

1. `context.collect_context` gathers PR metadata and diff text.
2. `orchestrator.negotiate` runs bounded critic/judge rounds.
3. `codex_runner.run_codex_json` invokes the local Codex CLI in read-only mode.
4. `report.write_report` writes Markdown plus raw JSON artifacts.

## Extension Points

- **Context providers**: GitHub PR, local branch, patch file, issue, pasted diff.
- **Agent runtimes**: Codex CLI today; direct API, Pi, or another local harness later.
- **Roles**: critic and judge today; security, maintainer, architect, test reviewer later.
- **Decision policy**: bounded rounds today; confidence thresholds and quorum later.
- **Action sinks**: Markdown today; patch application, GitHub review comments, PR labels later.

## Non-Mutation Boundary

The MVP does not mutate the reviewed repository. Future mutation should happen
after the report has been rendered and accepted by a separate action layer, for
example:

```text
result -> plan_patch -> apply_patch -> run_tests -> render_followup
result -> github_review -> post_comments
```

That keeps negotiation separate from side effects.
