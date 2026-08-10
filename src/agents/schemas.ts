import { z } from "zod";

const findingBucket = z.enum(["before_merge", "worth_fixing", "optional", "not_this_pr"]);

export const criticOutputSchema = z.object({
  summary: z.string(),
  narrative: z.string(),
  findings: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["blocker", "major", "minor", "nit"]),
      bucket: findingBucket,
      claim: z.string(),
      evidence: z.array(z.string()),
      proposed_fix: z.string(),
      confidence: z.number().min(0).max(1),
      file: z.string().nullable(),
      line: z.number().nullable(),
      category: z.string().nullable()
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

export const memoryOutputSchema = z.object({
  memory: z.string()
});

export const criticJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "narrative", "findings"],
  properties: {
    summary: { type: "string" },
    narrative: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // Codex/OpenAI strict schemas require every properties key to appear in required.
        required: [
          "id",
          "severity",
          "bucket",
          "claim",
          "evidence",
          "proposed_fix",
          "confidence",
          "file",
          "line",
          "category"
        ],
        properties: {
          id: { type: "string" },
          severity: { type: "string", enum: ["blocker", "major", "minor", "nit"] },
          bucket: {
            type: "string",
            enum: ["before_merge", "worth_fixing", "optional", "not_this_pr"]
          },
          claim: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          proposed_fix: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          file: { type: ["string", "null"] },
          line: { type: ["number", "null"] },
          category: { type: ["string", "null"] }
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

export const memoryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["memory"],
  properties: {
    memory: { type: "string" }
  }
} as const;

export const implementerOutputSchema = z.object({
  summary: z.string(),
  applied: z.array(
    z.object({
      finding_id: z.string(),
      status: z.enum(["applied", "skipped", "failed"]),
      files_touched: z.array(z.string()),
      notes: z.string()
    })
  )
});

export const implementerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "applied"],
  properties: {
    summary: { type: "string" },
    applied: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["finding_id", "status", "files_touched", "notes"],
        properties: {
          finding_id: { type: "string" },
          status: { type: "string", enum: ["applied", "skipped", "failed"] },
          files_touched: { type: "array", items: { type: "string" } },
          notes: { type: "string" }
        }
      }
    }
  }
} as const;
