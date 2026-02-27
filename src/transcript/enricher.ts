/**
 * Industry enrichment: adds sector context, typical RDTI activities, and ATO guidance
 * to the extracted client profile. Uses Claude's training knowledge.
 *
 * Extension point: swap the Anthropic call for a real-time web search (e.g. Brave Search API,
 * ATO website scraping) once BEN-13 (secrets/config management) is in place.
 *
 * Linear: BEN-25.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedProfile } from "./extractor.js";
import type { IndustryEnrichment } from "./types.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const ENRICHMENT_SYSTEM_PROMPT = `\
You are an Australian R&D tax specialist with deep knowledge of the RDTI scheme and \
industry-specific R&D patterns.

Given a client's industry and R&D activities, return structured enrichment covering:
1. A standardised industry sector label
2. Typical activities in this sector that qualify as core RDTI activities
3. Relevant ATO guidance or published decisions for this sector
4. Practical notes on categorising R&D expenditure in this sector

Base your response on your knowledge of the ATO's published guidance and Tax Ruling TR 2019/1. \
Be specific and actionable.`;

/**
 * Enrich an extracted R&D profile with industry-specific context and ATO guidance.
 * Requires ANTHROPIC_API_KEY in the environment or via options.apiKey.
 */
export async function enrichWithIndustryContext(
  profile: ExtractedProfile,
  options: { apiKey?: string; model?: string } = {}
): Promise<IndustryEnrichment> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic API key required. Set ANTHROPIC_API_KEY or pass options.apiKey."
    );
  }

  const client = new Anthropic({ apiKey });

  const activityList = profile.rdActivities
    .map((a) => `- ${a.title}: ${a.description}`)
    .join("\n");

  const userMessage = [
    `Industry: ${profile.industry}`,
    profile.clientName ? `Company: ${profile.clientName}` : null,
    `Technologies: ${profile.technologies.join(", ") || "not specified"}`,
    profile.rdActivities.length > 0
      ? `R&D Activities:\n${activityList}`
      : "R&D Activities: none identified yet",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: 1024,
    system: ENRICHMENT_SYSTEM_PROMPT,
    tools: [ENRICHMENT_TOOL],
    tool_choice: { type: "tool", name: "provide_industry_enrichment" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      "Enrichment model did not return a tool_use block. Cannot parse structured output."
    );
  }

  return parseEnrichmentInput(
    toolUse.input as Record<string, unknown>,
    profile.industry
  );
}

// ---------------------------------------------------------------------------
// Anthropic tool definition for structured enrichment
// ---------------------------------------------------------------------------

const ENRICHMENT_TOOL: Anthropic.Tool = {
  name: "provide_industry_enrichment",
  description:
    "Return industry-specific R&D context and ATO guidance for the client profile",
  input_schema: {
    type: "object" as const,
    properties: {
      sector: {
        type: "string",
        description:
          "Standardised industry sector (e.g. 'Information Technology', 'Pharmaceutical Research', 'Agricultural Technology')",
      },
      typicalRDActivities: {
        type: "array",
        items: { type: "string" },
        description:
          "3–6 common R&D activities in this sector that typically qualify as RDTI core activities",
      },
      atoGuidance: {
        type: "string",
        description:
          "Summary of ATO guidance, Tax Rulings, or decisions relevant to R&D claims in this sector (2–4 sentences)",
      },
      categorisationNotes: {
        type: "string",
        description:
          "Practical tips for categorising R&D expenditure in this sector: what to watch for, common split scenarios, etc. (2–4 sentences)",
      },
    },
    required: [
      "sector",
      "typicalRDActivities",
      "atoGuidance",
      "categorisationNotes",
    ],
  },
};

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseEnrichmentInput(
  input: Record<string, unknown>,
  fallbackSector: string
): IndustryEnrichment {
  return {
    sector:
      typeof input.sector === "string" && input.sector
        ? input.sector
        : fallbackSector,
    typicalRDActivities: Array.isArray(input.typicalRDActivities)
      ? (input.typicalRDActivities as string[]).filter(
          (v) => typeof v === "string"
        )
      : [],
    atoGuidance:
      typeof input.atoGuidance === "string" ? input.atoGuidance : "",
    categorisationNotes:
      typeof input.categorisationNotes === "string"
        ? input.categorisationNotes
        : "",
  };
}
