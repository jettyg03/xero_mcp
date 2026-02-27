/**
 * LLM-based extraction of a structured R&D profile from a plain-text transcript.
 * Uses Anthropic Claude with tool_use to produce reliable structured output.
 * Linear: BEN-24.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ClientRDProfile,
  RDActivity,
  PersonnelMember,
  SpendingItem,
} from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const EXTRACTION_SYSTEM_PROMPT = `\
You are an R&D tax specialist analyst helping to identify activities eligible for the Australian \
Research and Development Tax Incentive (RDTI).

Your task is to extract structured information from client meeting transcripts. Focus on:
- Genuine R&D activities involving technical uncertainty and systematic investigation
- Technologies, methodologies, and tools being developed or improved
- Key personnel involved in the R&D work (researchers, engineers, leads)
- Any R&D expenditure, budget, or staffing cost discussions
- The financial year the work relates to

Australian RDTI core activities must satisfy:
1. New knowledge or improvements through systematic investigation
2. A genuine technical uncertainty at the outset
3. A hypothesis and experimental approach

Extract only what is clearly stated or strongly implied. Do not invent details.`;

/** Subset of ClientRDProfile before enrichment and timestamp are added. */
export type ExtractedProfile = Omit<
  ClientRDProfile,
  "industryEnrichment" | "extractedAt"
>;

/** Calculate extraction confidence based on profile completeness. */
export function scoreConfidence(profile: ExtractedProfile): {
  confidence: number;
  flagForReview: boolean;
  flagReason?: string;
} {
  const issues: string[] = [];

  if (!profile.industry || profile.industry === "Unknown") {
    issues.push("industry not identified");
  }
  if (profile.rdActivities.length === 0) {
    issues.push("no R&D activities identified");
  }
  if (profile.technologies.length === 0) {
    issues.push("no technologies or methodologies mentioned");
  }
  const hasTechnicalChallenge = profile.rdActivities.some(
    (a) => a.technicalChallenge
  );
  if (profile.rdActivities.length > 0 && !hasTechnicalChallenge) {
    issues.push("no technical challenges identified in any activity");
  }

  const confidence =
    issues.length === 0
      ? 0.9
      : issues.length === 1
        ? 0.7
        : issues.length === 2
          ? 0.5
          : 0.3;

  return {
    confidence,
    flagForReview: confidence < 0.6,
    flagReason: issues.length > 0 ? issues.join("; ") : undefined,
  };
}

/**
 * Extract a structured R&D client profile from a normalised transcript.
 * Requires ANTHROPIC_API_KEY in the environment or via options.apiKey.
 */
export async function extractRDProfile(
  transcript: string,
  options: { apiKey?: string; model?: string } = {}
): Promise<ExtractedProfile> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic API key required. Set ANTHROPIC_API_KEY or pass options.apiKey."
    );
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: 2048,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extract_rd_profile" },
    messages: [
      {
        role: "user",
        content: `Extract the R&D profile from this client meeting transcript:\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      "Extraction model did not return a tool_use block. Cannot parse structured output."
    );
  }

  return parseToolInput(toolUse.input as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Anthropic tool definition for structured extraction
// ---------------------------------------------------------------------------

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_rd_profile",
  description:
    "Extract and return the structured R&D client profile from the transcript",
  input_schema: {
    type: "object" as const,
    properties: {
      clientName: {
        type: "string",
        description: "Client or company name if mentioned in the transcript",
      },
      industry: {
        type: "string",
        description:
          "Primary industry or sector (e.g. 'Software & Technology', 'Biotechnology', 'Advanced Manufacturing'). Use 'Unknown' if unclear.",
      },
      rdActivities: {
        type: "array",
        description: "R&D activities described in the transcript",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the activity",
            },
            description: {
              type: "string",
              description: "What is being developed, researched, or improved",
            },
            technicalChallenge: {
              type: "string",
              description:
                "The technical uncertainty or problem that must be overcome",
            },
            stage: {
              type: "string",
              enum: [
                "research",
                "experimental_development",
                "testing",
                "production",
              ],
              description: "Development stage at the time of the meeting",
            },
          },
          required: ["title", "description"],
        },
      },
      technologies: {
        type: "array",
        items: { type: "string" },
        description:
          "Technologies, frameworks, languages, tools, and methodologies mentioned",
      },
      keyPersonnel: {
        type: "array",
        description: "Key people mentioned (researchers, engineers, leads)",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
          },
        },
      },
      spendingDiscussions: {
        type: "array",
        description: "R&D spending, budgets, or cost discussions",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description:
                "Expense category (e.g. 'salaries', 'contractors', 'cloud infrastructure')",
            },
            estimatedAmount: { type: "number" },
            currency: {
              type: "string",
              description: "ISO 4217 currency code, e.g. 'AUD'",
            },
            notes: { type: "string" },
          },
          required: ["category"],
        },
      },
      claimYear: {
        type: "string",
        description:
          "Financial year the claim relates to (e.g. 'FY2024', '2023-24'). Omit if not mentioned.",
      },
    },
    required: [
      "industry",
      "rdActivities",
      "technologies",
      "keyPersonnel",
      "spendingDiscussions",
    ],
  },
};

// ---------------------------------------------------------------------------
// Response parsing helpers
// ---------------------------------------------------------------------------

function parseToolInput(input: Record<string, unknown>): ExtractedProfile {
  return {
    clientName:
      typeof input.clientName === "string" ? input.clientName : undefined,
    industry:
      typeof input.industry === "string" && input.industry
        ? input.industry
        : "Unknown",
    rdActivities: parseArray<RDActivity>(input.rdActivities),
    technologies: parseStringArray(input.technologies),
    keyPersonnel: parseArray<PersonnelMember>(input.keyPersonnel),
    spendingDiscussions: parseArray<SpendingItem>(input.spendingDiscussions),
    claimYear:
      typeof input.claimYear === "string" ? input.claimYear : undefined,
  };
}

function parseArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
