/**
 * Tests for transcript/extractor.ts (BEN-24, BEN-27).
 *
 * Unit tests: scoreConfidence (pure, no API).
 * Integration tests: extractRDProfile with real Claude API.
 *   — skipped automatically when ANTHROPIC_API_KEY is not set.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreConfidence, extractRDProfile } from "../../transcript/extractor.js";
import type { ExtractedProfile } from "../../transcript/extractor.js";

// ---------------------------------------------------------------------------
// scoreConfidence — pure unit tests
// ---------------------------------------------------------------------------

describe("scoreConfidence", () => {
  it("returns confidence 0.9 for a complete profile", () => {
    const profile: ExtractedProfile = {
      industry: "Software & Technology",
      rdActivities: [
        {
          title: "ML anomaly detection",
          description: "Building a neural network for fraud detection",
          technicalChallenge: "No existing algorithm meets required latency",
        },
      ],
      technologies: ["Python", "TensorFlow"],
      keyPersonnel: [{ name: "Alice", role: "Lead ML Engineer" }],
      spendingDiscussions: [{ category: "salaries", estimatedAmount: 200000 }],
    };

    const result = scoreConfidence(profile);
    assert.equal(result.confidence, 0.9);
    assert.equal(result.flagForReview, false);
    assert.equal(result.flagReason, undefined);
  });

  it("deducts for missing industry", () => {
    const profile: ExtractedProfile = {
      industry: "Unknown",
      rdActivities: [
        {
          title: "New algorithm",
          description: "Developing new search",
          technicalChallenge: "Cannot use existing approaches",
        },
      ],
      technologies: ["Rust"],
      keyPersonnel: [],
      spendingDiscussions: [],
    };

    const result = scoreConfidence(profile);
    assert.equal(result.confidence, 0.7);
    assert.ok(result.flagReason?.includes("industry"));
  });

  it("deducts for no R&D activities", () => {
    const profile: ExtractedProfile = {
      industry: "Biotech",
      rdActivities: [],
      technologies: ["CRISPR"],
      keyPersonnel: [],
      spendingDiscussions: [],
    };

    const result = scoreConfidence(profile);
    assert.ok(result.confidence <= 0.7);
    assert.ok(result.flagReason?.includes("R&D activities"));
  });

  it("flags for review when confidence below 0.6", () => {
    const profile: ExtractedProfile = {
      industry: "Unknown",
      rdActivities: [],
      technologies: [],
      keyPersonnel: [],
      spendingDiscussions: [],
    };

    const result = scoreConfidence(profile);
    assert.ok(result.confidence <= 0.5);
    assert.equal(result.flagForReview, true);
  });

  it("flags when activities exist but no technical challenges identified", () => {
    const profile: ExtractedProfile = {
      industry: "Manufacturing",
      rdActivities: [
        { title: "Process improvement", description: "Improving the process" },
      ],
      technologies: ["PLC controllers"],
      keyPersonnel: [],
      spendingDiscussions: [],
    };

    const result = scoreConfidence(profile);
    assert.ok(result.confidence <= 0.7);
    assert.ok(result.flagReason?.includes("technical challenges"));
  });
});

// ---------------------------------------------------------------------------
// Integration tests — require ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------

const SOFTWARE_TRANSCRIPT = `
Meeting with TechVenture Pty Ltd — FY2024 R&D Review

Attendees: Sarah Chen (CTO), Mark Wilson (Lead Engineer), Jane Doe (R&D Tax Adviser)

Sarah: We've been working on our AI-powered fraud detection system for about 18 months now.
The core challenge is that traditional rule-based systems have about a 40% false positive rate,
and we needed to get that below 5% without increasing latency.

Mark: We're using a transformer-based architecture with custom attention mechanisms.
The technical uncertainty was whether we could achieve real-time inference under 50ms
while maintaining accuracy above 95%. We went through about 12 different model architectures
before finding an approach that worked.

Sarah: From a spending perspective, we have 3 full-time engineers dedicated to this
project — roughly $450,000 in salaries for FY2024. We also spent about $60,000 on
AWS GPU compute for training runs.

Mark: We also developed a custom data augmentation pipeline in Python to deal with
the class imbalance problem in fraud datasets. That was genuinely novel — nothing
we found in the literature addressed our specific distribution shift problem.

Jane: Great. And this work was ongoing throughout FY2024, July 2023 through June 2024?

Sarah: Correct. TechVenture is the company name — we're incorporated in NSW.
`;

const BIOTECH_TRANSCRIPT = `
R&D Consultation — MediCure Biologics — FY2024

Dr. Amanda Ross (Chief Scientific Officer), Dr. Peter Kim (Principal Researcher)

Dr. Ross: Our main R&D focus this year has been on developing a new monoclonal antibody
therapy targeting CD47 "don't eat me" signals on cancer cells. This is a genuinely
novel approach because existing anti-CD47 therapies cause significant anaemia due to
red blood cell binding.

Dr. Kim: The technical challenge is engineering the antibody Fc region to selectively
bind tumour-associated CD47 while avoiding normal red blood cells. We've been using
computational protein design tools — Rosetta and AlphaFold2 — along with wet lab
validation in our BSL-2 facility.

Dr. Ross: We're in experimental development stage. We've tested 47 antibody variants
and identified 3 lead candidates. Total R&D spend for FY2024 was approximately
$1.2 million — mostly researcher salaries (4 PhDs), $180k in lab consumables,
and $75k for CRO validation work.

Dr. Kim: Key uncertainty is whether the Fc engineering changes affect therapeutic
efficacy. We won't know until we complete our in vitro cytotoxicity assays next quarter.
`;

const MANUFACTURING_TRANSCRIPT = `
R&D Meeting — Precision Parts Australia — FY2024

James Kowalski (Operations Manager), Dr. Li Wei (Process Engineer)

James: We've been developing an adaptive machining process for titanium aerospace
components. The problem is that titanium work-hardening during CNC machining causes
tool wear rates that are 3-4x higher than our cost models allow.

Dr. Wei: We're combining real-time acoustic emission sensing with an ML-based
cutting parameter optimisation system. The technical challenge is that the acoustic
signatures for different wear states overlap significantly, making classification difficult.

James: We've been working with RMIT University on this. We built our own data
collection rig using NI DAQ hardware and developed the signal processing pipeline
in Python. Total FY2024 R&D spend: about $280k — $150k internal engineering time,
$80k subcontracted to RMIT, and $50k in tooling and equipment.

Dr. Wei: We're at the testing stage now. We've demonstrated 60% reduction in tool
wear in controlled trials but haven't validated it on production runs yet.

James: Company name is Precision Parts Australia Pty Ltd, based in Melbourne.
`;

describe("extractRDProfile — integration", () => {
  it(
    "extracts profile from a software/AI transcript",
    { skip: !process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY not set" : false },
    async () => {
      const profile = await extractRDProfile(SOFTWARE_TRANSCRIPT);

      assert.ok(
        profile.industry.toLowerCase().includes("tech") ||
          profile.industry.toLowerCase().includes("software") ||
          profile.industry.toLowerCase().includes("ai"),
        `Expected tech industry, got: ${profile.industry}`
      );
      assert.ok(
        profile.rdActivities.length >= 1,
        "Expected at least one R&D activity"
      );
      assert.ok(
        profile.technologies.length >= 1,
        "Expected at least one technology"
      );
      assert.ok(
        profile.spendingDiscussions.length >= 1,
        "Expected spending to be extracted"
      );
      assert.ok(
        profile.claimYear?.includes("2024"),
        `Expected FY2024, got: ${profile.claimYear}`
      );

      const scoring = scoreConfidence(profile);
      assert.ok(
        scoring.confidence >= 0.7,
        `Expected high confidence for complete transcript, got: ${scoring.confidence}`
      );
    }
  );

  it(
    "extracts profile from a biotech transcript",
    { skip: !process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY not set" : false },
    async () => {
      const profile = await extractRDProfile(BIOTECH_TRANSCRIPT);

      assert.ok(
        profile.industry.toLowerCase().includes("bio") ||
          profile.industry.toLowerCase().includes("pharma") ||
          profile.industry.toLowerCase().includes("medical"),
        `Expected biotech/pharma industry, got: ${profile.industry}`
      );
      assert.ok(profile.rdActivities.length >= 1);
      const hasTechnicalChallenge = profile.rdActivities.some(
        (a) => a.technicalChallenge
      );
      assert.ok(hasTechnicalChallenge, "Expected at least one technical challenge");
    }
  );

  it(
    "extracts profile from an advanced manufacturing transcript",
    { skip: !process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY not set" : false },
    async () => {
      const profile = await extractRDProfile(MANUFACTURING_TRANSCRIPT);

      assert.ok(
        profile.industry.toLowerCase().includes("manufactur") ||
          profile.industry.toLowerCase().includes("engineering") ||
          profile.industry.toLowerCase().includes("aerospace"),
        `Expected manufacturing industry, got: ${profile.industry}`
      );
      assert.ok(profile.rdActivities.length >= 1);
      assert.ok(
        profile.clientName?.toLowerCase().includes("precision") ||
          profile.clientName?.toLowerCase().includes("parts"),
        `Expected client name to include 'Precision Parts', got: ${profile.clientName}`
      );
    }
  );

  it(
    "throws when API key is invalid",
    { skip: !process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY not set" : false },
    async () => {
      await assert.rejects(
        () =>
          extractRDProfile("Some transcript text.", {
            apiKey: "sk-ant-invalid-key",
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          return true;
        }
      );
    }
  );

  it("throws when no API key is provided", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await assert.rejects(
        () => extractRDProfile("Some transcript."),
        /api key required/i
      );
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});
