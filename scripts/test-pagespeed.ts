import { createReporter } from "./lib/assert.ts";
import { createAnalysisFakeDb, QUICK_CHECK_BAD, QUICK_CHECK_GOOD } from "./lib/analysis-fake-db.ts";
import { runPageSpeedAnalysis } from "../src/website-analysis/pagespeed-analysis.ts";

const r = createReporter();
const fakeResponse = (perf: number) => ({
  lighthouseResult: { categories: { performance: { score: perf }, seo: { score: 0.8 }, accessibility: { score: 0.7 } },
  audits: { "largest-contentful-paint": { numericValue: 4200 }, "cumulative-layout-shift": { numericValue: 0.25 }, "total-blocking-time": { numericValue: 350 } } },
});

async function testSkip() {
  const job = { id: "j1", usedPagespeedRequests: 0, maxPagespeedRequests: 100 };
  const db = createAnalysisFakeDb(job, { b1: { id: "b1", website: "https://good.de" } }, { b1: { businessId: "b1", quickCheckResult: QUICK_CHECK_GOOD, normalizedDomain: "good.de" } });
  let called = false;
  (globalThis as any).fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const outcome = await runPageSpeedAnalysis({ jobId: "j1", businessId: "b1", pagespeedApiKey: "k", client: db as any });
  r.assert(outcome.status === "skipped_not_promising", "skipped for good site");
  r.assert(!called, "no PageSpeed call");
}

async function testParsing() {
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => fakeResponse(0.42) });
  const job = { id: "j2", usedPagespeedRequests: 0, maxPagespeedRequests: 100 };
  const db = createAnalysisFakeDb(job, { b2: { id: "b2", website: "https://bad.de" } }, { b2: { businessId: "b2", quickCheckResult: QUICK_CHECK_BAD, normalizedDomain: "bad.de" } });
  const outcome = await runPageSpeedAnalysis({ jobId: "j2", businessId: "b2", pagespeedApiKey: "k", client: db as any });
  r.assert(outcome.status === "done", "done status");
  if (outcome.status === "done") {
    r.assert(outcome.result.performanceScore === 42, `perf=42, got ${outcome.result.performanceScore}`);
    r.assert(outcome.result.coreWebVitals.lcpMs === 4200, "lcp parsed");
  }
}

async function testBudget() {
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => fakeResponse(0.5) });
  const job = { id: "j3", usedPagespeedRequests: 1, maxPagespeedRequests: 1 };
  const db = createAnalysisFakeDb(job, { b3: { id: "b3", website: "https://bad2.de" } }, { b3: { businessId: "b3", quickCheckResult: QUICK_CHECK_BAD, normalizedDomain: "bad2.de" } });
  const outcome = await runPageSpeedAnalysis({ jobId: "j3", businessId: "b3", pagespeedApiKey: "k", client: db as any });
  r.assert(outcome.status === "budget_exceeded", "budget_exceeded");
}

async function testCache() {
  let called = false;
  (globalThis as any).fetch = async () => { called = true; return { ok: true, status: 200, json: async () => fakeResponse(0.9) }; };
  const job = { id: "j4", usedPagespeedRequests: 0, maxPagespeedRequests: 100 };
  const db = createAnalysisFakeDb(job, { bn: { id: "bn", website: "https://shared.de" } }, {
    bo: { businessId: "bo", normalizedDomain: "shared.de", pagespeedCheckedAt: new Date(), pagespeedResult: { performanceScore: 55, seoScore: 60, accessibilityScore: 70, coreWebVitals: {} } },
    bn: { businessId: "bn", quickCheckResult: QUICK_CHECK_BAD, normalizedDomain: "shared.de" },
  });
  const outcome = await runPageSpeedAnalysis({ jobId: "j4", businessId: "bn", pagespeedApiKey: "k", client: db as any });
  r.assert(outcome.status === "cached", "cached");
  r.assert(!called, "no API call — reused cache");
}

await testSkip();
await testParsing();
await testBudget();
await testCache();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
