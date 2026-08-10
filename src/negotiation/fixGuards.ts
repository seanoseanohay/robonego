import type { Finding, FindingBucket, PartitionedFinding } from "../types/models.js";

/** Hard-blocked: never auto-fixed even if listed in --fix-buckets */
export const NEVER_FIX_BUCKETS: ReadonlySet<FindingBucket> = new Set(["not_this_pr"]);

export const DEFAULT_FIX_BUCKETS: FindingBucket[] = ["before_merge"];

export interface FixGuardOptions {
  /** Buckets allowed for auto-fix (default: before_merge only) */
  buckets?: FindingBucket[];
  /** Minimum critic confidence (default 0.6) */
  minConfidence?: number;
  /** Cap fixes per implementer pass (default 8) */
  maxFixes?: number;
  /** Skip severity=nit even if bucket allowed (default true) */
  skipNits?: boolean;
}

export interface FixSelection {
  selected: Finding[];
  skipped: Array<{ finding: Finding; reason: string }>;
}

/**
 * Select accepted findings that are safe to auto-fix under guard rails.
 *
 * Hard rules:
 * - verdict must be accept (caller passes accepted partition only)
 * - never not_this_pr
 * - bucket must be in allowlist
 * - proposed_fix must be non-empty
 * - confidence >= minConfidence
 * - nits skipped by default
 */
export function selectFixableFindings(
  accepted: PartitionedFinding[],
  options: FixGuardOptions = {}
): FixSelection {
  const allow = new Set(options.buckets ?? DEFAULT_FIX_BUCKETS);
  const minConfidence = options.minConfidence ?? 0.6;
  const maxFixes = options.maxFixes ?? 8;
  const skipNits = options.skipNits ?? true;

  const selected: Finding[] = [];
  const skipped: Array<{ finding: Finding; reason: string }> = [];

  for (const item of accepted) {
    const finding = item.finding;
    if (!("id" in finding) || !finding.id) {
      continue;
    }
    const f = finding as Finding;

    if (NEVER_FIX_BUCKETS.has(f.bucket)) {
      skipped.push({ finding: f, reason: `bucket ${f.bucket} is never auto-fixed` });
      continue;
    }
    if (!allow.has(f.bucket)) {
      skipped.push({ finding: f, reason: `bucket ${f.bucket} not in fix allowlist` });
      continue;
    }
    if (skipNits && f.severity === "nit") {
      skipped.push({ finding: f, reason: "severity nit skipped by default" });
      continue;
    }
    if (!f.proposed_fix?.trim()) {
      skipped.push({ finding: f, reason: "empty proposed_fix" });
      continue;
    }
    if (typeof f.confidence === "number" && f.confidence < minConfidence) {
      skipped.push({
        finding: f,
        reason: `confidence ${f.confidence} < min ${minConfidence}`
      });
      continue;
    }
    if (selected.length >= maxFixes) {
      skipped.push({ finding: f, reason: `exceeded maxFixes (${maxFixes})` });
      continue;
    }
    selected.push(f);
  }

  // Prefer higher severity first if we somehow over-selected (cap is during loop)
  const rank: Record<Finding["severity"], number> = {
    blocker: 0,
    major: 1,
    minor: 2,
    nit: 3
  };
  selected.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return { selected, skipped };
}

export function parseFixBuckets(raw: string): FindingBucket[] {
  const valid: FindingBucket[] = ["before_merge", "worth_fixing", "optional", "not_this_pr"];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as FindingBucket[];
  if (parts.length === 0) {
    throw new Error("--fix-buckets requires a comma-separated list");
  }
  for (const p of parts) {
    if (!valid.includes(p)) {
      throw new Error(`Unknown fix bucket "${p}". Valid: ${valid.join(", ")}`);
    }
    if (NEVER_FIX_BUCKETS.has(p)) {
      throw new Error(
        `Bucket "${p}" cannot be auto-fixed (hard guard). File those findings separately.`
      );
    }
  }
  return parts;
}
