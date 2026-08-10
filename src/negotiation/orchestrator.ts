import { runCodexJson } from "../agents/codexRunner.js";
import { REVIEW_LENSES, type LensId, type ReviewLens } from "../agents/lenses.js";
import { mergeLensCriticOutputs, type LensCriticResult } from "../agents/mergeFindings.js";
import {
  criticMemoryUpdatePrompt,
  criticPrompt,
  implementerPrompt,
  judgeMemoryUpdatePrompt,
  judgePrompt,
  refineCriticPrompt
} from "../agents/prompts.js";
import {
  criticJsonSchema,
  criticOutputSchema,
  implementerJsonSchema,
  implementerOutputSchema,
  judgeJsonSchema,
  judgeOutputSchema,
  memoryJsonSchema,
  memoryOutputSchema
} from "../agents/schemas.js";
import {
  ensureStateDir,
  loadRoleMemory,
  saveRoleMemory,
  saveRoundArtifact
} from "../agents/roleState.js";
import { refreshContextAfterFix } from "../context/collect.js";
import type {
  CriticOutput,
  Finding,
  ImplementerOutput,
  JudgeOutput,
  NegotiationResult,
  NegotiationRound,
  NegotiateOptions,
  PartitionedFinding,
  ReviewContext,
  ReviewMode
} from "../types/models.js";
import { synthesizeDecisionSummary } from "../report/markdown.js";
import { selectFixableFindings } from "./fixGuards.js";

const DEFAULT_TIMEOUT_MS = 600_000;

export async function negotiate(
  ctx: ReviewContext,
  maxRoundsOrOptions: number | NegotiateOptions = 2,
  model?: string
): Promise<NegotiationResult> {
  const options: NegotiateOptions =
    typeof maxRoundsOrOptions === "number"
      ? { maxRounds: maxRoundsOrOptions, model }
      : { model, ...maxRoundsOrOptions };

  const maxRounds = options.maxRounds ?? 2;
  if (maxRounds < 1) {
    throw new Error("maxRounds must be at least 1");
  }

  const mode: ReviewMode = options.mode ?? "thermo";
  const activeLenses = resolveLenses(options.lenses);
  const fixEnabled = Boolean(options.fix?.enabled);

  const stateDir = options.stateDir;
  if (stateDir) {
    await ensureStateDir(stateDir);
  }

  let criticMemory = stateDir && !options.noMemory ? await loadRoleMemory(stateDir, "critic") : "";
  let judgeMemory = stateDir && !options.noMemory ? await loadRoleMemory(stateDir, "judge") : "";
  let implementerMemory =
    stateDir && !options.noMemory && fixEnabled ? await loadRoleMemory(stateDir, "implementer") : "";

  let workingCtx = ctx;
  const rounds: NegotiationRound[] = [];
  let priorJudgeSummary = "";
  let priorFindingsForRefine = "";
  /** After implementer, next critic is a full re-review of the updated tree */
  let forceFullRereview = false;

  // Cumulative partitions so refine/fix rounds do not erase earlier accepts
  const acceptedById = new Map<string, PartitionedFinding>();
  const rejectedById = new Map<string, PartitionedFinding>();

  for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber += 1) {
    const useThermo =
      mode === "thermo" &&
      (roundNumber === 1 || forceFullRereview) &&
      !priorFindingsForRefine;

    const critic = useThermo
      ? await runThermoCritics(workingCtx, activeLenses, {
          roleMemory: criticMemory,
          model: options.model,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          stateDir
        })
      : await runSingleCritic(workingCtx, {
          priorJudgeSummary,
          roleMemory: criticMemory,
          priorFindingsJson: priorFindingsForRefine || undefined,
          model: options.model,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          refine: Boolean(priorFindingsForRefine) && !forceFullRereview
        });

    forceFullRereview = false;

    const judge = await runCodexJson(
      workingCtx.repo,
      judgePrompt(workingCtx, critic, rounds.map(roundSummary), judgeMemory),
      judgeJsonSchema,
      judgeOutputSchema,
      options.model,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );

    if (stateDir && !options.noMemory) {
      try {
        const criticMemOut = await runCodexJson(
          workingCtx.repo,
          criticMemoryUpdatePrompt(criticMemory, critic, judge),
          memoryJsonSchema,
          memoryOutputSchema,
          options.model,
          Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 180_000)
        );
        criticMemory = criticMemOut.memory;
        await saveRoleMemory(stateDir, "critic", criticMemory);

        const judgeMemOut = await runCodexJson(
          workingCtx.repo,
          judgeMemoryUpdatePrompt(judgeMemory, critic, judge),
          memoryJsonSchema,
          memoryOutputSchema,
          options.model,
          Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 180_000)
        );
        judgeMemory = judgeMemOut.memory;
        await saveRoleMemory(stateDir, "judge", judgeMemory);
      } catch {
        // Memory updates are best-effort; never fail the negotiation on them.
      }
    }

    const { accepted, rejected, unresolved } = partition(critic, judge);
    mergePartitionMaps(acceptedById, accepted);
    mergePartitionMaps(rejectedById, rejected);
    // Accepted wins over earlier reject if re-filed
    for (const id of acceptedById.keys()) {
      rejectedById.delete(id);
    }

    let implementer: ImplementerOutput | undefined;
    let fixCandidates: Finding[] | undefined;
    let fixSkipped: NegotiationRound["fix_skipped"];
    let appliedAny = false;

    if (fixEnabled) {
      const selection = selectFixableFindings(accepted, {
        buckets: options.fix?.buckets,
        minConfidence: options.fix?.minConfidence,
        maxFixes: options.fix?.maxFixes,
        skipNits: options.fix?.skipNits
      });
      fixCandidates = selection.selected;
      fixSkipped = selection.skipped.map((s) => ({
        finding_id: s.finding.id,
        reason: s.reason
      }));

      if (selection.selected.length > 0) {
        console.error(
          `robonego: implementer (--fix) — ${selection.selected.length} finding(s) under guards`
        );
        for (const f of selection.selected) {
          console.error(`robonego:   → fix ${f.id} [${f.bucket}/${f.severity}]`);
        }
        if (selection.skipped.length > 0) {
          console.error(
            `robonego:   (skipped ${selection.skipped.length} accepted by guards — see report)`
          );
        }

        implementer = await runCodexJson(
          workingCtx.repo,
          implementerPrompt(workingCtx, selection.selected, {
            roleMemory: implementerMemory
          }),
          implementerJsonSchema,
          implementerOutputSchema,
          {
            model: options.model,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            sandbox: "workspace-write"
          }
        );

        appliedAny = implementer.applied.some((a) => a.status === "applied");
        console.error(
          `robonego: implementer done — applied=${implementer.applied.filter((a) => a.status === "applied").length} skipped=${implementer.applied.filter((a) => a.status === "skipped").length} failed=${implementer.applied.filter((a) => a.status === "failed").length}`
        );

        if (stateDir) {
          await saveRoundArtifact(stateDir, roundNumber, "implementer", implementer);
          if (!options.noMemory) {
            implementerMemory = [
              implementerMemory,
              `## Round ${roundNumber}`,
              implementer.summary,
              ...implementer.applied.map(
                (a) => `- ${a.finding_id}: ${a.status} (${a.files_touched.join(", ") || "no files"}) — ${a.notes}`
              )
            ]
              .filter(Boolean)
              .join("\n")
              .slice(0, 2500);
            await saveRoleMemory(stateDir, "implementer", implementerMemory);
          }
        }

        if (appliedAny) {
          workingCtx = await refreshContextAfterFix(workingCtx);
          forceFullRereview = true;
          priorFindingsForRefine = "";
          priorJudgeSummary = `Implementer applied fixes. Re-review the updated tree. Prior judge: ${judge.summary}`;
        }
      }
    }

    const round: NegotiationRound = {
      round_number: roundNumber,
      critic,
      judge,
      implementer,
      fix_candidates: fixCandidates,
      fix_skipped: fixSkipped,
      critic_memory_after: criticMemory || undefined,
      judge_memory_after: judgeMemory || undefined
    };
    rounds.push(round);

    if (stateDir) {
      await saveRoundArtifact(stateDir, roundNumber, "critic", critic);
      await saveRoundArtifact(stateDir, roundNumber, "judge", judge);
    }

    // After successful fixes, always continue to re-review if rounds remain
    if (appliedAny && roundNumber < maxRounds) {
      continue;
    }

    // Stop if nothing material open and no fix re-review pending
    if (unresolved.length === 0 && !appliedAny) {
      break;
    }

    if (unresolved.length === 0) {
      break;
    }

    // Claim refine path (no fix this round, or fix mode off)
    const refineIds = new Set(
      unresolved
        .filter((u) => "id" in u.finding && u.finding.id)
        .map((u) => (u.finding as { id: string }).id)
    );
    const refineFindings = critic.findings.filter((f) => refineIds.has(f.id));
    priorFindingsForRefine = JSON.stringify(refineFindings, null, 2);
    priorJudgeSummary = judge.summary;

    const material = refineFindings.some(
      (f) => f.severity === "blocker" || f.severity === "major" || f.severity === "minor"
    );
    if (
      !material &&
      accepted.every((a) => !("severity" in a.finding) || a.finding.severity === "nit")
    ) {
      break;
    }
  }

  const finalRound = rounds.at(-1);
  if (!finalRound) {
    throw new Error("Negotiation produced no rounds");
  }

  const lastPartition = partition(finalRound.critic, finalRound.judge);
  // Prefer cumulative accepted/rejected; unresolved only from last round
  const accepted = [...acceptedById.values()];
  const rejected = [...rejectedById.values()].filter((r) => {
    const id = "id" in r.finding ? r.finding.id : "";
    return !acceptedById.has(id);
  });
  const unresolved = lastPartition.unresolved;

  const outcome = computeOutcome(unresolved, accepted, rounds, fixEnabled);
  const summary = synthesizeDecisionSummary(
    finalRound.judge.summary,
    accepted,
    unresolved.length
  );

  return {
    outcome,
    summary,
    rounds,
    accepted,
    rejected,
    unresolved,
    mode,
    lenses: mode === "thermo" ? activeLenses.map((l) => l.id) : undefined,
    fix_enabled: fixEnabled,
    role_memories: {
      critic: criticMemory,
      judge: judgeMemory
    }
  };
}

function wasAppliedInAnyRound(rounds: NegotiationRound[], findingId: string): boolean {
  if (!findingId) return false;
  for (const round of rounds) {
    if (round.implementer?.applied.some((a) => a.finding_id === findingId && a.status === "applied")) {
      return true;
    }
  }
  return false;
}

function computeOutcome(
  unresolved: PartitionedFinding[],
  accepted: PartitionedFinding[],
  rounds: NegotiationRound[],
  fixEnabled: boolean
): NegotiationResult["outcome"] {
  if (unresolved.length > 0) {
    return "needs_human";
  }

  // Only before_merge holds the negotiation / merge decision.
  // worth_fixing, optional, and not_this_pr are future work — reported, not blocking.
  const stillBlocking = accepted.some((item) => {
    if (!("bucket" in item.finding) || !item.finding.bucket) {
      // Unknown bucket: treat as blocking so we do not silently ship ambiguity.
      return true;
    }
    if (item.finding.bucket !== "before_merge") {
      return false;
    }
    const id = "id" in item.finding ? item.finding.id : "";
    // After --fix, applied findings no longer block if re-review left them unresolved-free.
    if (fixEnabled && wasAppliedInAnyRound(rounds, id)) {
      return false;
    }
    return true;
  });

  return stillBlocking ? "changes_needed" : "good_to_merge";
}

function mergePartitionMaps(
  map: Map<string, PartitionedFinding>,
  items: PartitionedFinding[]
): void {
  for (const item of items) {
    const id = "id" in item.finding ? item.finding.id : undefined;
    if (id) {
      map.set(id, item);
    }
  }
}

async function runThermoCritics(
  ctx: ReviewContext,
  lenses: ReviewLens[],
  options: {
    roleMemory: string;
    model?: string;
    timeoutMs: number;
    stateDir?: string;
  }
): Promise<CriticOutput> {
  console.error(
    `robonego: thermo multi-angle critic — ${lenses.length} lenses in parallel: ${lenses.map((l) => l.id).join(", ")}`
  );

  const settled = await Promise.all(
    lenses.map(async (lens): Promise<LensCriticResult> => {
      console.error(`robonego:   → lens ${lens.id} (${lens.oneLiner})`);
      const output = await runCodexJson(
        ctx.repo,
        criticPrompt(ctx, {
          lens,
          roleMemory: options.roleMemory
        }),
        criticJsonSchema,
        criticOutputSchema,
        options.model,
        options.timeoutMs
      );
      console.error(`robonego:   ← lens ${lens.id}: ${output.findings.length} finding(s)`);
      if (options.stateDir) {
        await saveRoundArtifact(options.stateDir, 0, `critic-${lens.id}`, output);
      }
      return { lens: lens.id as LensId, output };
    })
  );

  const merged = mergeLensCriticOutputs(settled);
  console.error(`robonego: thermo merge → ${merged.findings.length} finding(s) total`);
  return merged;
}

async function runSingleCritic(
  ctx: ReviewContext,
  options: {
    priorJudgeSummary: string;
    roleMemory: string;
    priorFindingsJson?: string;
    model?: string;
    timeoutMs: number;
    refine: boolean;
  }
): Promise<CriticOutput> {
  const prompt = options.refine
    ? refineCriticPrompt(ctx, {
        priorJudgeSummary: options.priorJudgeSummary,
        roleMemory: options.roleMemory,
        priorFindingsJson: options.priorFindingsJson
      })
    : criticPrompt(ctx, {
        priorJudgeSummary: options.priorJudgeSummary,
        roleMemory: options.roleMemory,
        priorFindingsJson: options.priorFindingsJson
      });

  return runCodexJson(
    ctx.repo,
    prompt,
    criticJsonSchema,
    criticOutputSchema,
    options.model,
    options.timeoutMs
  );
}

function resolveLenses(requested?: string[]): ReviewLens[] {
  if (!requested || requested.length === 0) {
    return [...REVIEW_LENSES];
  }
  const byId = new Map(REVIEW_LENSES.map((l) => [l.id, l]));
  const resolved: ReviewLens[] = [];
  for (const id of requested) {
    const lens = byId.get(id as LensId);
    if (!lens) {
      throw new Error(
        `Unknown lens "${id}". Valid: ${REVIEW_LENSES.map((l) => l.id).join(", ")}`
      );
    }
    resolved.push(lens);
  }
  return resolved;
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
      unresolved.push({
        finding: finding ?? {},
        judgment: finding
          ? judgment
          : {
              ...judgment,
              rationale: `${judgment.rationale} (unknown finding_id)`
            }
      });
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
    judge_summary: round.judge.summary,
    critic_finding_ids: round.critic.findings.map((f) => f.id),
    judge_verdicts: round.judge.judgments.map((j) => ({ id: j.finding_id, verdict: j.verdict })),
    implementer: round.implementer
      ? {
          summary: round.implementer.summary,
          applied: round.implementer.applied.map((a) => ({
            id: a.finding_id,
            status: a.status
          }))
        }
      : undefined
  };
}
