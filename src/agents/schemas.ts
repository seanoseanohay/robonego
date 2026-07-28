import { z } from "zod";

export const criticOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["blocker", "major", "minor", "nit"]),
      claim: z.string(),
      evidence: z.array(z.string()),
      proposed_fix: z.string(),
      confidence: z.number().min(0).max(1)
    })
  )
});

export const judgeOutputSchema = z.object({
  summary: z.string(),
  judgments: z.array(
    z.object({
      finding_id: z.string(),
      verdict: z.enum(["accept", "reject", "revise", "needs_human"]),
      rationale: z.string(),
      required_action: z.string()
    })
  )
});

export const criticJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "severity", "claim", "evidence", "proposed_fix", "confidence"],
        properties: {
          id: { type: "string" },
          severity: { type: "string", enum: ["blocker", "major", "minor", "nit"] },
          claim: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          proposed_fix: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  }
} as const;

export const judgeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "judgments"],
  properties: {
    summary: { type: "string" },
    judgments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["finding_id", "verdict", "rationale", "required_action"],
        properties: {
          finding_id: { type: "string" },
          verdict: { type: "string", enum: ["accept", "reject", "revise", "needs_human"] },
          rationale: { type: "string" },
          required_action: { type: "string" }
        }
      }
    }
  }
} as const;
