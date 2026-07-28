import { runCodexJson } from "../agents/codexRunner.js";
import { criticPrompt, judgePrompt } from "../agents/prompts.js";
import {
  criticJsonSchema,
  criticOutputSchema,
  judgeJsonSchema,
  judgeOutputSchema
} from "../agents/schemas.js";
import type {
  CriticOutput,
  JudgeOutput,
  Judgment,
  NegotiationResult,
  NegotiationRound,
  PartitionedFinding,
  ReviewContext
} from "../types/models.js";

export async function negotiate(ctx: ReviewContext, maxRounds = 2, model?: string): Promise<NegotiationResult> {
  if (maxRounds < 1) {
    throw new Error("maxRounds must be at least 1");
  }

  const rounds: NegotiationRound[] = [];
  let priorJudgeSummary = "";

  for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber += 1) {
    const critic = await runCodexJson(ctx.repo, criticPrompt(ctx, priorJudgeSummary), criticJsonSchema, criticOutputSchema, model);
    const judge = await runCodexJson(
      ctx.repo,
      judgePrompt(ctx, critic, rounds.map(roundSummary)),
      judgeJsonSchema,
      judgeOutputSchema,
      model
    );
    rounds.push({ round_number: roundNumber, critic, judge });
    priorJudgeSummary = judge.summary;
    break;
  }

  const finalRound = rounds.at(-1);
  if (!finalRound) {
    throw new Error("Negotiation produced no rounds");
  }

  const { accepted, rejected, unresolved } = partition(finalRound.critic, finalRound.judge);
  const outcome = unresolved.length > 0 ? "needs_human" : accepted.length > 0 ? "changes_needed" : "good_to_merge";

  return {
    outcome,
    summary: finalRound.judge.summary,
    rounds,
    accepted,
    rejected,
    unresolved
  };
}

export function partition(
  critic: CriticOutput,
  judge: JudgeOutput
): { accepted: PartitionedFinding[]; rejected: PartitionedFinding[]; unresolved: PartitionedFinding[] } {
  const findings = new Map(critic.findings.map((finding) => [finding.id, finding]));
  const seen = new Set<string>();
  const accepted: PartitionedFinding[] = [];
  const rejected: PartitionedFinding[] = [];
  const unresolved: PartitionedFinding[] = [];

  for (const judgment of judge.judgments) {
    const finding = findings.get(judgment.finding_id);
    if (!finding || seen.has(judgment.finding_id)) {
      unresolved.push({ finding: {}, judgment });
      continue;
    }
    seen.add(judgment.finding_id);
    const merged = { finding, judgment };
    if (judgment.verdict === "accept") {
      accepted.push(merged);
    } else if (judgment.verdict === "reject") {
      rejected.push(merged);
    } else {
      unresolved.push(merged);
    }
  }

  for (const finding of critic.findings) {
    if (!seen.has(finding.id)) {
      unresolved.push({
        finding,
        judgment: {
          finding_id: finding.id,
          verdict: "needs_human",
          rationale: "The judge did not return a judgment for this finding.",
          required_action: "Rerun negotiation or inspect manually."
        }
      });
    }
  }

  return { accepted, rejected, unresolved };
}

function roundSummary(round: NegotiationRound): object {
  return {
    round_number: round.round_number,
    critic_summary: round.critic.summary,
    judge_summary: round.judge.summary
  };
}
