import { createReporter } from "./lib/assert.ts";
import { createFullFakeDb } from "./lib/full-fake-db.ts";
import { runWebsiteAnalysisForJob } from "../src/website-analysis/pipeline.ts";

const r = createReporter();

async function testWiring() {
  const GOOD_HTML = `<html><head><title>Good</title><meta name="viewport" content="w"><meta name="description" content="d"></head><body><a href="tel:+49123">call</a><p>bewertung</p></body></html>`;
  const BAD_HTML = `<html><head></head><body>nothing here</body></html>`;
  const businesses = [
    { id: "b_none", googlePlaceId: "p_none", website: null },
    { id: "b_good", googlePlaceId: "p_good", website: "https://goodsite.de" },
    { id: "b_bad", googlePlaceId: "p_bad", website: "https://badsite.de" },
  ];

  const db = createFullFakeDb();
  for (const b of businesses) (db.business as any)._seed(b);
  (db.searchJob as any)._seed({
    id: "job_x", usedGoogleRequests: 0, maxGoogleRequests: 100, usedFirecrawlCredits: 0, maxFirecrawlCredits: 100,
    usedPagespeedRequests: 0, maxPagespeedRequests: 100, foundCount: 0, withWebsiteCount: 0, analyzedCount: 0,
  });
  await (db.searchJobBusiness as any).upsert({ where: { searchJobId_businessId: { searchJobId: "job_x", businessId: "b_none" } } });
  await (db.searchJobBusiness as any).upsert({ where: { searchJobId_businessId: { searchJobId: "job_x", businessId: "b_good" } } });
  await (db.searchJobBusiness as any).upsert({ where: { searchJobId_businessId: { searchJobId: "job_x", businessId: "b_bad" } } });

  let mapCalls = 0, scrapeCalls = 0, pagespeedCalls = 0;
  (globalThis as any).fetch = async (url: string) => {
    if (url.includes("places.googleapis.com")) {
      const placeId = url.split("/").pop()!;
      const website = businesses.find((b) => b.googlePlaceId === placeId)?.website ?? null;
      return { ok: true, status: 200, url, json: async () => ({ id: placeId, website }) };
    }
    if (url.endsWith("/map")) { mapCalls++; return { ok: true, status: 200, json: async () => ({ links: ["https://badsite.de/"] }) }; }
    if (url.endsWith("/scrape")) { scrapeCalls++; return { ok: true, status: 200, json: async () => ({ data: { markdown: "md", html: BAD_HTML, metadata: { title: "Bad" } } }) }; }
    if (url.includes("pagespeedonline")) {
      pagespeedCalls++;
      return { ok: true, status: 200, json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.3 }, seo: { score: 0.5 }, accessibility: { score: 0.6 } }, audits: {} } }) };
    }
    const html = url.includes("goodsite") ? GOOD_HTML : BAD_HTML;
    return { ok: true, status: 200, url, text: async () => html };
  };

  const counters = await runWebsiteAnalysisForJob({ jobId: "job_x", googleApiKey: "k", firecrawlApiKey: "k", pagespeedApiKey: "k", client: db as any });

  r.assert(counters.withoutWebsite === 1, `1 no-website, got ${counters.withoutWebsite}`);
  r.assert(counters.withWebsite === 2, `2 with website, got ${counters.withWebsite}`);
  r.assert(counters.promising === 1, `only bad site promising, got ${counters.promising}`);
  r.assert(counters.deepAnalyzed === 1, `deep analysis ran once, got ${counters.deepAnalyzed}`);
  r.assert(counters.pagespeedAnalyzed === 1, `pagespeed ran once, got ${counters.pagespeedAnalyzed}`);
  r.assert(mapCalls === 1 && scrapeCalls === 1 && pagespeedCalls === 1, "each external call made exactly once");
}

async function testPerCompanyFailureIsolation() {
  const businesses = [
    { id: "ok1", googlePlaceId: "pok1", website: null },
    { id: "boom", googlePlaceId: "pboom", website: null },
    { id: "ok2", googlePlaceId: "pok2", website: null },
  ];
  const db = createFullFakeDb();
  for (const b of businesses) (db.business as any)._seed(b);
  (db.searchJob as any)._seed({ id: "job_fail", usedGoogleRequests: 0, maxGoogleRequests: 100, usedFirecrawlCredits: 0, maxFirecrawlCredits: 100, usedPagespeedRequests: 0, maxPagespeedRequests: 100, foundCount: 0, withWebsiteCount: 0, analyzedCount: 0 });
  for (const b of businesses) await (db.searchJobBusiness as any).upsert({ where: { searchJobId_businessId: { searchJobId: "job_fail", businessId: b.id } } });

  (globalThis as any).fetch = async (url: string) => {
    if (url.includes("places.googleapis.com")) {
      if (url.includes("pboom")) throw new Error("simulated network crash");
      const placeId = url.split("/").pop()!;
      return { ok: true, status: 200, url, json: async () => ({ id: placeId, website: null }) };
    }
    return { ok: true, status: 200, url, text: async () => "<html></html>" };
  };

  const counters = await runWebsiteAnalysisForJob({ jobId: "job_fail", googleApiKey: "k", client: db as any });
  r.assert(counters.failed === 1, `1 company failed in isolation, got ${counters.failed}`);
  r.assert(counters.withoutWebsite === 2, `the other 2 still processed successfully, got ${counters.withoutWebsite}`);
  r.assert(counters.processed === 3, `all 3 accounted for (processed), got ${counters.processed}`);
}

await testWiring();
await testPerCompanyFailureIsolation();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
