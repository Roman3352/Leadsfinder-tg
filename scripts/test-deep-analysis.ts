import { createReporter } from "./lib/assert.ts";
import { createAnalysisFakeDb, QUICK_CHECK_BAD, QUICK_CHECK_GOOD } from "./lib/analysis-fake-db.ts";
import { runDeepAnalysis, isPromisingForDeepAnalysis } from "../src/website-analysis/deep-analysis.ts";
import { selectPagesToScrape } from "../src/integrations/firecrawl/select-pages.ts";

const r = createReporter();

function testPromisingFilter() {
  r.assert(isPromisingForDeepAnalysis(QUICK_CHECK_BAD as any) === true, "bad quick check -> promising");
  r.assert(isPromisingForDeepAnalysis(QUICK_CHECK_GOOD as any) === false, "good quick check -> not promising");
  r.assert(isPromisingForDeepAnalysis({ ...QUICK_CHECK_GOOD, reachable: false } as any) === false, "unreachable -> never promising");
}

function testPageSelection() {
  const links = ["https://example.de/", "https://example.de/leistungen", "https://example.de/kontakt", "https://example.de/ueber-uns", "https://example.de/blog/x"];
  const selected = selectPagesToScrape("https://example.de/", links, 4);
  r.assert(selected.length === 4, `4 pages selected, got ${selected.length}`);
  r.assert(selected.map((p) => p.kind).join(",") === "home,services,contact,about", "kinds in expected order");
}

async function testSkipNotPromising() {
  const job = { id: "j1", usedFirecrawlCredits: 0, maxFirecrawlCredits: 100 };
  const db = createAnalysisFakeDb(job, { b1: { id: "b1", website: "https://good.de" } }, { b1: { businessId: "b1", quickCheckResult: QUICK_CHECK_GOOD, normalizedDomain: "good.de" } });
  let called = false;
  (globalThis as any).fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const outcome = await runDeepAnalysis({ jobId: "j1", businessId: "b1", firecrawlApiKey: "k", client: db as any });
  r.assert(outcome.status === "skipped_not_promising", "skipped for good site");
  r.assert(!called, "no Firecrawl call made");
}

async function testFullRunAndBudgetStop() {
  const mapLinks = ["https://bad.de/", "https://bad.de/leistungen", "https://bad.de/kontakt", "https://bad.de/ueber-uns"];
  let scrapeCalls = 0;
  (globalThis as any).fetch = async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (url.endsWith("/map")) return { ok: true, status: 200, json: async () => ({ links: mapLinks }) };
    scrapeCalls++;
    return { ok: true, status: 200, json: async () => ({ data: { markdown: `# ${body.url}`, html: `<html><head><title>${body.url}</title></head></html>`, metadata: { title: body.url } } }) };
  };
  const job = { id: "j2", usedFirecrawlCredits: 0, maxFirecrawlCredits: 3 };
  const db = createAnalysisFakeDb(job, { b2: { id: "b2", website: "https://bad.de" } }, { b2: { businessId: "b2", quickCheckResult: QUICK_CHECK_BAD, normalizedDomain: "bad.de" } });
  const outcome = await runDeepAnalysis({ jobId: "j2", businessId: "b2", firecrawlApiKey: "k", client: db as any });
  r.assert(outcome.status === "budget_exceeded", "budget_exceeded status");
  if (outcome.status === "budget_exceeded") r.assert(outcome.pages.length === 2, `partial 2 pages, got ${outcome.pages.length}`);
  r.assert(scrapeCalls === 2, `2 scrape calls before stop, got ${scrapeCalls}`);
}

async function testDomainCacheReuse() {
  let called = false;
  (globalThis as any).fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({ links: [] }) }; };
  const job = { id: "j3", usedFirecrawlCredits: 0, maxFirecrawlCredits: 100 };
  const db = createAnalysisFakeDb(job, { bn: { id: "bn", website: "https://shared.de" } }, {
    bo: { businessId: "bo", normalizedDomain: "shared.de", deepAnalyzedAt: new Date(), deepAnalysisResult: { pages: [{ url: "https://shared.de", kind: "home" }] } },
    bn: { businessId: "bn", quickCheckResult: QUICK_CHECK_BAD, normalizedDomain: "shared.de" },
  });
  const outcome = await runDeepAnalysis({ jobId: "j3", businessId: "bn", firecrawlApiKey: "k", client: db as any });
  r.assert(outcome.status === "cached", "served from domain cache");
  r.assert(!called, "no Firecrawl call — reused cache");
}

testPromisingFilter();
testPageSelection();
await testSkipNotPromising();
await testFullRunAndBudgetStop();
await testDomainCacheReuse();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
