/**
 * Tests for transcript/enricher.ts (BEN-25, BEN-27).
 *
 * Integration tests — skipped automatically when ANTHROPIC_API_KEY is not set.
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { enrichWithIndustryContext } from "../../transcript/enricher.js";
import type { ExtractedProfile } from "../../transcript/extractor.js";

const SOFTWARE_PROFILE: ExtractedProfile = {
  clientName: "TechVenture Pty Ltd",
  industry: "Software & Technology",
  rdActivities: [
    {
      title: "AI fraud detection system",
      description:
        "Developing a transformer-based neural network for real-time fraud detection",
      technicalChallenge:
        "Achieving <50ms inference latency while maintaining >95% accuracy",
      stage: "experimental_development",
    },
  ],
  technologies: ["Python", "TensorFlow", "AWS", "transformer models"],
  keyPersonnel: [{ name: "Sarah Chen", role: "CTO" }],
  spendingDiscussions: [
    { category: "salaries", estimatedAmount: 450000, currency: "AUD" },
    { category: "cloud compute", estimatedAmount: 60000, currency: "AUD" },
  ],
  claimYear: "FY2024",
};

const BIOTECH_PROFILE: ExtractedProfile = {
  clientName: "MediCure Biologics",
  industry: "Biotechnology",
  rdActivities: [
    {
      title: "Monoclonal antibody therapy development",
      description:
        "Engineering anti-CD47 antibody to selectively target tumour cells",
      technicalChallenge:
        "Engineering Fc region to avoid red blood cell binding while maintaining efficacy",
      stage: "experimental_development",
    },
  ],
  technologies: ["Rosetta", "AlphaFold2", "protein engineering"],
  keyPersonnel: [
    { name: "Dr. Amanda Ross", role: "Chief Scientific Officer" },
    { name: "Dr. Peter Kim", role: "Principal Researcher" },
  ],
  spendingDiscussions: [
    {
      category: "researcher salaries",
      estimatedAmount: 1200000,
      currency: "AUD",
    },
  ],
  claimYear: "FY2024",
};

const skipIntegration = !process.env.ANTHROPIC_API_KEY;

describe("enrichWithIndustryContext — integration", () => {
  it.skipIf(skipIntegration)(
    "returns enrichment for a software/AI profile",
    async () => {
      const enrichment = await enrichWithIndustryContext(SOFTWARE_PROFILE);

      assert.ok(
        typeof enrichment.sector === "string" && enrichment.sector.length > 0,
        "Expected a sector label"
      );
      assert.ok(
        Array.isArray(enrichment.typicalRDActivities) &&
          enrichment.typicalRDActivities.length >= 2,
        "Expected at least 2 typical R&D activities"
      );
      assert.ok(
        typeof enrichment.atoGuidance === "string" &&
          enrichment.atoGuidance.length > 20,
        "Expected non-trivial ATO guidance"
      );
      assert.ok(
        typeof enrichment.categorisationNotes === "string" &&
          enrichment.categorisationNotes.length > 20,
        "Expected non-trivial categorisation notes"
      );
    }
  );

  it.skipIf(skipIntegration)(
    "returns enrichment for a biotech profile",
    async () => {
      const enrichment = await enrichWithIndustryContext(BIOTECH_PROFILE);

      assert.ok(enrichment.sector.length > 0);
      assert.ok(enrichment.typicalRDActivities.length >= 2);

      // Biotech guidance should mention something about experimental activities
      const guidanceText = enrichment.atoGuidance.toLowerCase();
      assert.ok(
        guidanceText.includes("experiment") ||
          guidanceText.includes("research") ||
          guidanceText.includes("clinical"),
        `Expected biotech-relevant ATO guidance, got: ${enrichment.atoGuidance}`
      );
    }
  );

  it.skipIf(skipIntegration)(
    "returns a sector that reflects the input industry when no match found",
    async () => {
      const profile: ExtractedProfile = {
        industry: "Aquaculture Technology",
        rdActivities: [
          {
            title: "Automated fish feeding system",
            description: "Developing AI-based feed optimisation for salmon farms",
            technicalChallenge: "Predicting feed uptake from underwater imaging",
          },
        ],
        technologies: ["computer vision", "Python"],
        keyPersonnel: [],
        spendingDiscussions: [],
      };

      const enrichment = await enrichWithIndustryContext(profile);
      assert.ok(enrichment.sector.length > 0, "Expected a non-empty sector");
      assert.ok(
        enrichment.typicalRDActivities.length >= 1,
        "Expected at least one typical activity"
      );
    }
  );

  it("throws when no API key is provided", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await assert.rejects(
        () => enrichWithIndustryContext(SOFTWARE_PROFILE),
        /api key required/i
      );
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});
