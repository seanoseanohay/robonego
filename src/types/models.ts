export type Verdict = "accept" | "reject" | "revise" | "needs_human";
export type Outcome = "good_to_merge" | "changes_needed" | "needs_human";

/** Where the finding belongs in a senior-style PR writeup */
export type FindingBucket = "before_merge" | "worth_fixing" | "optional" | "not_this_pr";

export interface Finding {
  id: string;
  severity: "blocker" | "major" | "minor" | "nit";
  /** Senior review section this finding belongs in */
  bucket: FindingBucket;
  claim: string;
  evidence: string[];
  proposed_fix: string;
  confidence: number;
  file?: string | null;
  line?: number | null;
  category?: string | null;
}

export interface Judgment {
  finding_id: string;
  verdict: Verdict;
  rationale: string;
  required_action: string;
}

export interface CriticOutput {
  summary: string;
  /** Short narrative: what improved, what load-bearing pieces you verified */
  narrative: string;
  findings: Finding[];
}

export interface JudgeOutput {
  summary: string;
  judgments: Judgment[];
}

export interface ImplementerApplied {
  finding_id: string;
  status: "applied" | "skipped" | "failed";
  files_touched: string[];
  notes: string;
}

export interface ImplementerOutput {
  summary: string;
  applied: ImplementerApplied[];
}

export interface NegotiationRound {
  round_number: number;
  critic: CriticOutput;
  judge: JudgeOutput;
  implementer?: ImplementerOutput;
  /** Findings selected by guards for the implementer this round */
  fix_candidates?: Finding[];
  /** Guard skip reasons for accepted findings not sent to implementer */
  fix_skipped?: Array<{ finding_id: string; reason: string }>;
  critic_memory_after?: string;
  judge_memory_after?: string;
}

export interface PartitionedFinding {
  finding: Finding | Record<string, never>;
  judgment: Judgment;
}

export type ReviewMode = "thermo" | "single";

export interface NegotiationResult {
  outcome: Outcome;
  summary: string;
  rounds: NegotiationRound[];
  accepted: PartitionedFinding[];
  rejected: PartitionedFinding[];
  unresolved: PartitionedFinding[];
  /** thermo = multi-angle parallel lenses; single = one full critic */
  mode?: ReviewMode;
  /** Which specialist lenses ran (thermo mode) */
  lenses?: string[];
  /** Whether --fix implementer stage was enabled */
  fix_enabled?: boolean;
  role_memories?: {
    critic: string;
    judge: string;
  };
}

/** Process / PR-hygiene signals (GitHub merge state, sibling PRs, story links) */
export interface ProcessHints {
  mergeable?: string | null;
  mergeable_state?: string | null;
  review_decision?: string | null;
  is_draft?: boolean;
  /** PR/issue numbers referenced in title+body (e.g. #10294) */
  referenced_prs: Array<{
    number: number;
    state?: string;
    title?: string;
    url?: string;
    is_open?: boolean;
  }>;
  notes: string[];
}

export interface ReviewContext {
  repo: string;
  target: string;
  metadata: string;
  diff: string;
  changedFiles?: string;
  /** Base branch used for local re-diff after --fix */
  base?: string;
  /** Structured process signals for report + process lens */
  process?: ProcessHints;
}

export interface FixOptions {
  enabled: boolean;
  buckets?: FindingBucket[];
  minConfidence?: number;
  maxFixes?: number;
  skipNits?: boolean;
}

export interface NegotiateOptions {
  maxRounds?: number;
  model?: string;
  stateDir?: string;
  noMemory?: boolean;
  timeoutMs?: number;
  /**
   * Always defaults to thermo (thorough multi-angle).
   * single / --quick is an explicit opt-out for a shallow one-pass skim.
   */
  mode?: ReviewMode;
  /** Subset of lens ids for thermo mode; default all */
  lenses?: string[];
  /**
   * Opt-in Implementer stage between rounds.
   * Applies only accepted findings that pass fix guards, then re-reviews.
   */
  fix?: FixOptions;
}
