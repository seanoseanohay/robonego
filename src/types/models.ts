export type Verdict = "accept" | "reject" | "revise" | "needs_human";
export type Outcome = "good_to_merge" | "changes_needed" | "needs_human";

export interface Finding {
  id: string;
  severity: "blocker" | "major" | "minor" | "nit";
  claim: string;
  evidence: string[];
  proposed_fix: string;
  confidence: number;
}

export interface Judgment {
  finding_id: string;
  verdict: Verdict;
  rationale: string;
  required_action: string;
}

export interface CriticOutput {
  summary: string;
  findings: Finding[];
}

export interface JudgeOutput {
  summary: string;
  judgments: Judgment[];
}

export interface NegotiationRound {
  round_number: number;
  critic: CriticOutput;
  judge: JudgeOutput;
}

export interface PartitionedFinding {
  finding: Finding | Record<string, never>;
  judgment: Judgment;
}

export interface NegotiationResult {
  outcome: Outcome;
  summary: string;
  rounds: NegotiationRound[];
  accepted: PartitionedFinding[];
  rejected: PartitionedFinding[];
  unresolved: PartitionedFinding[];
}

export interface ReviewContext {
  repo: string;
  target: string;
  metadata: string;
  diff: string;
}
