import type { CriticOutput, Finding } from "../types/models.js";
import type { LensId } from "./lenses.js";

export interface LensCriticResult {
  lens: LensId;
  output: CriticOutput;
}

/**
 * Merge multi-lens critic outputs into one CriticOutput for the Judge.
 * - Prefixes finding ids with lens id to avoid collisions
 * - Tags category with lens when missing
 * - Light dedupe of near-identical claims within the same file
 */
export function mergeLensCriticOutputs(parts: LensCriticResult[]): CriticOutput {
  if (parts.length === 0) {
    return {
      summary: "No lens critics ran.",
      narrative: "",
      findings: []
    };
  }

  const findings: Finding[] = [];
  const seenKeys = new Set<string>();
  const narrativeParts: string[] = [];
  const summaryParts: string[] = [];

  for (const { lens, output } of parts) {
    summaryParts.push(`[${lens}] ${output.summary.trim() || "(no summary)"}`);
    if (output.narrative?.trim()) {
      narrativeParts.push(`### ${lens}\n\n${output.narrative.trim()}`);
    }

    for (const finding of output.findings) {
      const prefixedId = prefixFindingId(lens, finding.id);
      const category = finding.category?.trim() ? finding.category : lens;
      const key = dedupeKey({ ...finding, id: prefixedId, category });
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      findings.push({
        ...finding,
        id: prefixedId,
        category
      });
    }
  }

  // Severity order for readability; judge still decides
  const severityRank: Record<Finding["severity"], number> = {
    blocker: 0,
    major: 1,
    minor: 2,
    nit: 3
  };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const lensList = parts.map((p) => p.lens).join(", ");
  return {
    summary: `Thermo multi-angle critic (${parts.length} lenses: ${lensList}). ${findings.length} findings after merge.\n${summaryParts.join("\n")}`,
    narrative: narrativeParts.join("\n\n"),
    findings
  };
}

export function prefixFindingId(lens: string, id: string): string {
  const cleaned = id.trim() || "F";
  const prefix = `${lens}-`;
  if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
    return cleaned;
  }
  // Also handle "correctness:F1" style
  if (cleaned.toLowerCase().startsWith(`${lens}:`)) {
    return `${lens}-${cleaned.slice(lens.length + 1)}`;
  }
  return `${lens}-${cleaned}`;
}

function dedupeKey(finding: Finding): string {
  const claim = normalize(finding.claim);
  const file = (finding.file ?? "").toLowerCase();
  const line = finding.line ?? 0;
  // Same file+line+similar claim → drop duplicate across lenses
  return `${file}|${line}|${claim.slice(0, 120)}`;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
