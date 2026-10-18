// Adapted from schroneko/automated-hachathon-judge @ 23016a7dcfe71cf67a3d9405a84ff3b9021e203c (MIT).
// See reference/published-20261018 and THIRD_PARTY_NOTICES.md.
import { SCORE_LEVELS } from "./rubric.mjs";
export const explanationOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "publicReason", "repoAssessment", "pinnedSha", "criteria", "total", "reviewRequired"],
  properties: {
    summary: { type: "string" },
    publicReason: { type: "string" },
    repoAssessment: {
      type: "string",
      enum: ["scored", "empty_repository", "missing_or_private", "no_default_branch", "retryable_failure", "unjudgeable"]
    },
    pinnedSha: {
      anyOf: [
        { type: "string" },
        { type: "null" }
      ]
    },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "score", "reason", "evidencePaths"],
        properties: {
          key: { type: "string", enum: ["technical", "ux", "impact", "idea"] },
          label: { type: "string" },
          score: { type: "integer", enum: SCORE_LEVELS },
          reason: { type: "string" },
          evidencePaths: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    },
    total: { type: "integer" },
    reviewRequired: { type: "boolean" }
  }
};
