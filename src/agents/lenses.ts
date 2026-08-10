/**
 * Thermonuclear multi-angle review lenses.
 *
 * One shallow critic that "covers" 10 checklists still misses issues.
 * Cursor-style thermo-nuclear review works better when each pass is a
 * specialist: deep on one angle, blind to others, then merge.
 */

export type LensId =
  | "correctness"
  | "security"
  | "product"
  | "contracts"
  | "thermo"
  | "tests"
  | "process";

export interface ReviewLens {
  id: LensId;
  title: string;
  /** Short line for logs / reports */
  oneLiner: string;
  /** Full specialist instructions injected into the critic prompt */
  focus: string;
}

export const REVIEW_LENSES: readonly ReviewLens[] = [
  {
    id: "correctness",
    title: "Correctness & concurrency",
    oneLiner: "real bugs, races, error paths, invariants",
    focus: `
You are ONLY the correctness hunter. Ignore style, naming, and pure maintainability.

Hunt for real behavioral failure modes introduced or left unfixed by this PR:

- Wrong output, silent data loss, corruption, hangs
- Races, double-submit, TOCTOU, shared mutable session/cookie/token state
- Handler guards vs UI-only disabled buttons (server must enforce)
- Non-idempotent inserts; partial updates that leave half-applied state
- Error paths that skip cleanup, swallow errors, or redirect past required steps
- Off-by-one, empty/null/boundary cases, wrong branch on status codes
- Invariants the type system cannot enforce (ordering, uniqueness, tenancy)
- Logic that disagrees with nearby callers, tests, or docs

Evidence bar: file:line or clear symbol path + plausible failure mode.
If you cannot verify, lower confidence or omit — do not invent.

Do NOT file pure maintainability or "could be cleaner" items on this pass.
`.trim()
  },
  {
    id: "security",
    title: "Security & trust boundaries",
    oneLiner: "authn/authz, injection, secrets, untrusted input",
    focus: `
You are ONLY the security reviewer. Ignore UX polish and structural refactor taste.

Hunt for:

- Missing or weakened authn/authz on new or changed routes/handlers
- Trust boundary failures: client-controlled flags trusted by the server
- Injection (SQL/HTML/command/path), XSS sinks, open redirects
- Secrets, tokens, PII in logs, client bundles, or committed files
- Unauthenticated groups, fail-open filters, IDOR / cross-tenant access
- Rate-limit / abuse gaps on sensitive endpoints when the PR touches them
- Untrusted external data used without validation at the boundary

Severity: security bugs that are introduced or exposed by this PR → before_merge
or worth_fixing. Pre-existing ghosts → not_this_pr with clear path evidence.

Do NOT file theme/CSS/a11y or pure maintainability nits on this pass.
`.trim()
  },
  {
    id: "product",
    title: "Product / UX / theme / a11y",
    oneLiner: "first-run UX, theme, a11y, lying copy, empty states",
    focus: `
You are ONLY the product/UI reviewer. Ignore backend internals except as they
affect what the user sees.

Hunt for:

- First-run surfaces (login, verify, empty states): theme consistency
- Copy that lies about state ("switch team" when user has no team)
- Dark/light defaults (cookies, theme.yaml, CSS variables)
- Wrappers that set bg-* OUTSIDE themed scopes while children use theme scopes
- fixed positioning under ancestors with transform/filter/backdrop-filter
- Modals: Escape, role="dialog", aria-modal, labelled title, focus order
- Icon-only buttons without accessible names
- Consistency with sibling components in the same app

Mandatory technique for UI: open parents/wrappers that RENDER changed components;
find sibling modals and match house patterns.

Login / new modal a11y+theme issues are before_merge when users hit them, not nits.

Do NOT file pure backend concurrency or abstract architecture refactor items here.
`.trim()
  },
  {
    id: "contracts",
    title: "API contracts, backend paths, client state bleed",
    oneLiner: "response shapes, filters, storage bleed, end-to-end paths",
    focus: `
You are ONLY the contracts / multi-tenant / backend-path reviewer.

Hunt for:

- Changed response shapes of existing endpoints (even with "no new endpoint")
- Filters that fail open vs fail closed; duplicate queries; lying error messages
- Authn/authz on related routes when invites/sessions/teams are touched
- sessionStorage/localStorage keys that survive team/customer switch
- Cookie/session writers: find ALL writers of the same cookie when one changes
- List/filter changes: read full SQL/handler path and failure modes end-to-end
- Fields populated but dropped by types; dead client expectations

When PR touches invites/sessions/teams: read accept/refresh/list paths end-to-end.

Surface production ghosts the PR masks as bucket=not_this_pr with evidence.

Do NOT file pure CSS theme nits or abstract "code judo" restructures here.
`.trim()
  },
  {
    id: "thermo",
    title: "Thermo-nuclear maintainability (Cursor-style)",
    oneLiner: "structure, spaghetti growth, code judo, file size, layers",
    focus: `
You are the Cursor thermo-nuclear code quality reviewer. Extremely strict on
implementation quality, maintainability, abstraction quality, and codebase health.

Baseline:
> Deep code quality audit of this PR's changes. Rethink structure to improve
> quality without changing behavior. Be ambitious. Measure twice, cut once.

Non-negotiable standards:

0. Be ambitious about structural simplification — look for "code judo" moves
   that delete whole branches, helpers, modes, or layers while preserving behavior.
1. Do not let a PR push a file from under ~1k lines to over ~1k without strong reason.
2. Do not allow random spaghetti growth — ad-hoc conditionals bolted onto unrelated flows.
3. Bias toward cleaning design, not rubber-stamping "it works".
4. Prefer direct, boring code over hacky/magical abstractions and thin wrappers.
5. Push type/boundary cleanliness (any/unknown/casts/silent fallbacks).
6. Keep logic in the canonical layer; reuse existing helpers; no feature logic in shared paths.
7. Flag avoidable sequential orchestration and non-atomic partial updates when cleaner structure is obvious.

Primary questions for every meaningful change:
- Is there a code-judo move that makes this dramatically simpler?
- Did branching complexity grow where a better model should exist?
- Right file/layer? Healthy file size? Earning-its-keep abstraction?
- Casts/optionality obscuring the real invariant?

Flag aggressively: structural regressions, missed simplification, spaghetti growth,
wrong-layer logic, duplicate helpers, identity wrappers, temporary branches that will stick.

Bucket guidance for this lens:
- Structural regressions that will hurt the next change → worth_fixing or before_merge
  only if the PR actively makes shared paths worse or is unreviewably tangled.
- Missed code-judo that is real but not a merge blocker → optional or worth_fixing.
- Do not invent security/correctness bugs here — stay on maintainability.

Tone: direct, serious, demanding. Not rude. Prefer few high-conviction findings
over a flood of cosmetic nits.
`.trim()
  },
  {
    id: "tests",
    title: "Tests, CI honesty, scope narrative",
    oneLiner: "coverage of new branches, checklist honesty, not-this-PR ghosts",
    focus: `
You are ONLY the verification / scope honesty reviewer.

Hunt for:

- Scope & narrative: PR title/body vs what the code actually does
- Load-bearing pieces untested or tests that are vacuous
- New branches without non-vacuous coverage
- PR checklist claims vs actual API/schema/migration changes
- Missing CI for touched packages if that leaves review carrying the whole load
- "Not this PR" discoveries: real production bugs the PR masks or touches
  indirectly — file as bucket=not_this_pr with evidence; do not force fix here
  unless severity is extreme AND introduced here

Do NOT re-do deep concurrency analysis or pure CSS theme review — other lenses own those.
`.trim()
  },
  {
    id: "process",
    title: "PR process & merge hygiene",
    oneLiner: "sibling PRs, mergeable state, draft/reviews, overlapping stories",
    focus: `
You are ONLY the PR process / merge-hygiene reviewer. Use pr_metadata process hints.

Hunt for:

- Overlap with open sibling PRs referenced in title/body (e.g. "#10294 is still open —
  drop/rebase the shared empty-state hunk if that PR lands first")
- PR body claims work "already handled" in another PR that is still OPEN → coordinate
- mergeStateStatus BLOCKED / DIRTY / BEHIND — surface as process note (usually not_this_pr
  or optional process finding, not a code bug)
- Draft PRs reviewed as if ready to merge
- CHANGES_REQUESTED still open
- Story/ticket refs (sc-NNNNN) that claim completion elsewhere without evidence in this diff

Bucket guidance (important — do not inflate process into code blockers):
- Open sibling PR that shares the SAME hunks/predicate and would conflict on rebase
  → worth_fixing or optional process note: coordinate landing order. Only before_merge
  if this PR would *break* if the sibling lands first and this branch does not preserve
  the safer predicate (e.g. totalCount gate). Prefer not_this_pr "merge hygiene" when
  either landing order is fine if both keep the fix.
- mergeStateStatus=BLOCKED / review required / branch protection alone → not_this_pr
  or optional process note. Never before_merge solely for protection/review state.
- Draft PR reviewed as ready → worth_fixing process note.

Do NOT re-litigate code correctness, a11y, or backend authz — other lenses own those.
Do still flag not_this_pr auth/session contract bugs if you notice them while reading
related paths, but prefer contracts/security lenses for those.
`.trim()
  }
] as const;

export function lensById(id: string): ReviewLens | undefined {
  return REVIEW_LENSES.find((lens) => lens.id === id);
}
