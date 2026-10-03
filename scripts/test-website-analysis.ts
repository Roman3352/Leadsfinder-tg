import { createReporter } from "./lib/assert.ts";
import { detectAndQuickCheck } from "../src/website-analysis/detect-and-quick-check.ts";
import { normalizeDomain } from "../src/website-analysis/normalize-domain.ts";
import { isSocialOnly } from "../src/website-analysis/social.ts";

const r = createReporter();

function createFakeDb() {
  const businesses = new Map<string, any>();
  const analyses = new Map<string, any>();
  return {
    business: { async findUniqueOrThrow({ where }: any) { const b = businesses.get(where.id); if (!b) throw new Error("not found"); return b; } },
    websiteAnalysis: {
      async findFirst({ where }: any) {
        const rows = [...analyses.values()].filter((a) => a.normalizedDomain === where.normalizedDomain && a.quickCheckedAt >= where.quickCheckedAt.gte);
        rows.sort((a, b) => b.quickCheckedAt.getTime() - a.quickCheckedAt.getTime());
        return rows[0] ?? null;
      },
      async upsert({ where, update, create }: any) {
        const existing = analyses.get(where.businessId);
        const row = existing ? { ...existing, ...update } : { businessId: where.businessId, ...create };
        analyses.set(where.businessId, row);
        return row;
      },
    },
    _seed(b: any) { businesses.set(b.id, b); },
    _analyses: analyses,
  };
}

function testNormalizeAndSocial() {
  const variants = ["https://www.example.de", "http://example.de/", "www.example.de", "example.de"];
  r.assert(new Set(variants.map(normalizeDomain)).size === 1, "domain variants normalize identically");
  r.assert(isSocialOnly("https://www.instagram.com/somebiz/") === true, "instagram detected as social-only");
  r.assert(isSocialOnly("https://mybusiness.de") === false, "own domain is not social-only");
}

async function testNoWebsite() {
  const db = createFakeDb();
  (db as any)._seed({ id: "b1", website: null });
  const outcome = await detectAndQuickCheck("b1", db as any);
  r.assert(outcome.status === "no_website", "no_website without any fetch");
}

async function testSocialOnlyCountsAsNoWebsite() {
  const db = createFakeDb();
  (db as any)._seed({ id: "b1b", website: "https://www.facebook.com/somebiz" });
  const outcome = await detectAndQuickCheck("b1b", db as any);
  r.assert(outcome.status === "no_website", "Facebook-only page treated as no_website");
}

async function testQuickCheckParsing() {
  const html = `<html><head><title>AutoCare</title><meta name="viewport" content="w"><meta name="description" content="d"></head>
    <body><h1>Willkommen</h1><a href="tel:+4912345">call</a><a href="mailto:info@ac.de">mail</a>
    <a href="https://instagram.com/autocare_wetzlar">insta</a><form><input/></form></body></html>`;
  (globalThis as any).fetch = async (url: string) => ({ ok: true, status: 200, url, text: async () => html });
  const db = createFakeDb();
  (db as any)._seed({ id: "b2", website: "https://www.autocare-wetzlar.de/" });
  const outcome = await detectAndQuickCheck("b2", db as any);
  r.assert(outcome.status === "quick_checked" && !outcome.fromCache, "first check not from cache");
  if (outcome.status === "quick_checked") {
    r.assert(outcome.result.title === "AutoCare", "title parsed");
    r.assert(outcome.result.hasClearCta === true, "hasClearCta true");
    r.assert(outcome.result.email === "info@ac.de", `email parsed, got ${outcome.result.email}`);
    r.assert(outcome.result.instagramUrl === "https://instagram.com/autocare_wetzlar", `instagram parsed, got ${outcome.result.instagramUrl}`);
  }
}

async function testDomainCacheReuse() {
  let calls = 0;
  (globalThis as any).fetch = async (url: string) => { calls++; return { ok: true, status: 200, url, text: async () => `<html><head><title>Shared</title></head></html>` }; };
  const db = createFakeDb();
  (db as any)._seed({ id: "b3", website: "https://shared-agency.de" });
  (db as any)._seed({ id: "b4", website: "https://www.shared-agency.de/" });
  await detectAndQuickCheck("b3", db as any);
  const second = await detectAndQuickCheck("b4", db as any);
  r.assert(calls === 1, `only 1 real fetch for 2 businesses on same domain, got ${calls}`);
  r.assert(second.status === "quick_checked" && (second as any).fromCache === true, "second served from cache");
}

testNormalizeAndSocial();
await testNoWebsite();
await testSocialOnlyCountsAsNoWebsite();
await testQuickCheckParsing();
await testDomainCacheReuse();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
