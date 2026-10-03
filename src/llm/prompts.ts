import type { JsonRequest } from "./provider.ts";

export interface LeadFacts {
  business: {
    name: string;
    niche: string | null;
    city: string | null;
    rating: number | null;
    reviewCount: number | null;
    phone: string | null;
    website: string | null;
    websiteStatus: string; // NONE | SOCIAL_ONLY | UNVERIFIED | OK
  };
  findings: { label: string; evidence: string; points: number }[];
  opportunities: { code: string; reason: string }[];
  notes: string[]; // ограничения данных, которые модель обязана учитывать
}

export interface SalesBrief {
  what_they_do: string;
  main_problem: string;
  opportunity: string;
  what_to_sell: string;
  why: string;
  next_step: string;
}

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["what_they_do", "main_problem", "opportunity", "what_to_sell", "why", "next_step"],
  properties: {
    what_they_do: { type: "string" },
    main_problem: { type: "string" },
    opportunity: { type: "string" },
    what_to_sell: { type: "string" },
    why: { type: "string" },
    next_step: { type: "string" },
  },
};

export function buildBriefRequest(facts: LeadFacts): JsonRequest {
  return {
    schemaName: "sales_brief",
    schema: BRIEF_SCHEMA,
    system: [
      "You are a sales analyst for a freelance web developer in Germany who sells websites, redesigns, local SEO and AI/automation solutions to local businesses.",
      "Use ONLY the facts in the input JSON. Never invent facts, numbers, names, prices or problems. If something is unknown, say it is unknown.",
      "Recommend only services that appear in `opportunities`. Do not add services that are not listed.",
      "Respect `notes` (data limitations): e.g. if the website could not be verified, do not claim it is broken.",
      "Be concrete and short: every field is at most 2 sentences. No generic AI phrases.",
      "Write all field values in Russian. Keep business names and URLs unchanged.",
      "Fields: what_they_do = what the business does; main_problem = the single most important verified problem; opportunity = the sales opportunity; what_to_sell = the concrete offer; why = evidence from the findings; next_step = the next action for the developer (e.g. send a personalized message and offer a short free preview).",
    ].join("\n"),
    user: JSON.stringify(facts),
    maxOutputTokens: 600,
  };
}

export function formatBrief(name: string, brief: SalesBrief): string {
  return [
    `BUSINESS:\n${name}`,
    `WHAT THEY DO:\n${brief.what_they_do}`,
    `MAIN PROBLEM:\n${brief.main_problem}`,
    `OPPORTUNITY:\n${brief.opportunity}`,
    `WHAT TO SELL:\n${brief.what_to_sell}`,
    `WHY:\n${brief.why}`,
    `NEXT STEP:\n${brief.next_step}`,
  ].join("\n\n");
}

export interface OutreachFacts {
  businessName: string;
  niche: string | null;
  city: string | null;
  senderName: string;
  verifiedFindings: string[]; // только проверенные наблюдения (без "не удалось проверить")
  ideas: string[]; // названия услуг из opportunities
}

const OUTREACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: { message: { type: "string" } },
};

export function buildOutreachRequest(facts: OutreachFacts): JsonRequest {
  return {
    schemaName: "outreach_message",
    schema: OUTREACH_SCHEMA,
    system: [
      "You write a short first outreach message in GERMAN from a freelance web developer to the owner of a local business. Use the formal 'Sie' form.",
      "Maximum 90 words. Natural, polite, no marketing buzzwords, no flattery, no fake compliments, no exclamation marks, no emojis.",
      "Mention one or two concrete observations taken ONLY from `verifiedFindings`, phrased softly (for example 'mir ist aufgefallen'). Never invent problems, numbers, prices or deadlines.",
      "If `verifiedFindings` is empty, do not claim any problem: just say you looked at their online presence and have a few ideas.",
      "Offer 2-3 concrete improvement ideas (based on `ideas`) and a short free preview ('kostenlos kurz zeigen'). Do not be pushy.",
      "Greeting: 'Guten Tag,' (the owner's name is unknown). Finish with 'Viele Grüße' and the sender name on a new line.",
      "Return the message as plain text with line breaks in the `message` field.",
    ].join("\n"),
    user: JSON.stringify(facts),
    maxOutputTokens: 400,
  };
}
