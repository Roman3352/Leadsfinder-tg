import { createReporter } from "./lib/assert.ts";
import { createFullFakeDb } from "./lib/full-fake-db.ts";
import { runSearchJob } from "../src/jobs/run-search-job.ts";
import type { LLMProvider, JsonRequest, JsonResponse } from "../src/llm/provider.ts";

const r = createReporter();

function fakeLLM(): LLMProvider & { calls: number } {
  const obj = {
    name: "fake",
    model: "fake-model",
    calls: 0,
    async generateJson<T>(req: JsonRequest): Promise<JsonResponse<T>> {
      obj.calls++;
      const data =
        req.schemaName === "sales_brief"
          ? {
              what_they_do: "Autoaufbereitung",
              main_problem: "Слабый сайт / нет сайта",
              opportunity: "Новый сайт с записью",
              what_to_sell: "Landing page + WhatsApp",
              why: "По собранным данным",
              next_step: "Отправить сообщение и предложить превью",
            }
          : { message: "Guten Tag,\n\nich habe mir Ihren Auftritt angeschaut...\n\nViele Grüße" };
      return { data: data as T, usage: { inputTokens: 400, outputTokens: 120 }, model: "fake-model" };
    },
  };
  return obj;
}

async function testFullPipeline() {
  const HTML_GOOD = `<html><head><title>Top Salon</title><meta name="viewport" content="w"><meta name="description" content="d"></head>
    <body><h1>Welcome</h1><a href="tel:+491111">call</a><a href="https://wa.me/491111">wa</a><form></form>
    <p>termin buchen</p><p>galerie</p><p>bewertung</p></body></html>`;
  const HTML_BAD = `<html><head></head><body>kein Inhalt</body></html>`;

  const places = [
    { id: "place_none", name: "No Website Barber", website: null, rating: 4.7, reviews: 90, phone: "+49111" },
    { id: "place_good", name: "Top Salon", website: "https://top-salon.de", rating: 4.9, reviews: 300, phone: "+49222" },
    { id: "place_bad", name: "Old Werkstatt", website: "https://old-werkstatt.de", rating: 4.4, reviews: 60, phone: "+49333" },
  ];

  let mapCalls = 0;
  let scrapeCalls = 0;
  let pagespeedCalls = 0;

  (globalThis as any).fetch = async (url: string) => {
    if (url.includes("places.googleapis.com/v1/places:searchText")) {
      const body = { places: places.map((p) => ({ id: p.id, displayName: { text: p.name }, formattedAddress: `Str 1, 35578 Wetzlar` })) };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (url.includes("places.googleapis.com/v1/places/")) {
      const placeId = url.split("/").pop()!;
      const p = places.find((x) => x.id === placeId)!;
      const body = { id: p.id, website: p.website, rating: p.rating, userRatingCount: p.reviews, internationalPhoneNumber: p.phone };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (url.endsWith("/map")) {
      mapCalls++;
      return { ok: true, status: 200, json: async () => ({ links: ["https://old-werkstatt.de/"] }) };
    }
    if (url.endsWith("/scrape")) {
      scrapeCalls++;
      return { ok: true, status: 200, json: async () => ({ data: { markdown: "md", html: HTML_BAD, metadata: { title: "Old" } } }) };
    }
    if (url.includes("pagespeedonline")) {
      pagespeedCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.3 }, seo: { score: 0.5 }, accessibility: { score: 0.6 } }, audits: {} } }),
      };
    }
    const html = url.includes("top-salon") ? HTML_GOOD : HTML_BAD;
    return { ok: true, status: 200, url, text: async () => html };
  };

  const db = createFullFakeDb();
  (db as any).user.upsert({ where: { telegramId: "42" }, create: { telegramId: "42" } });
  (db.searchJob as any)._seed({
    id: "job_e2e",
    userId: "u1",
    niche: "Autowerkstatt",
    location: "Wetzlar",
    requestedCount: 3,
    status: "QUEUED",
    foundCount: 0,
    withWebsiteCount: 0,
    analyzedCount: 0,
    promisingCount: 0,
    usedGoogleRequests: 0,
    maxGoogleRequests: 100,
    usedFirecrawlCredits: 0,
    maxFirecrawlCredits: 100,
    usedPagespeedRequests: 0,
    maxPagespeedRequests: 100,
    usedAiCalls: 0,
    maxAiCalls: 100,
  });

  const llm = fakeLLM();
  const progressPhases: string[] = [];

  const summary = await runSearchJob({
    jobId: "job_e2e",
    keys: { google: "k", firecrawl: "k", pagespeed: "k" },
    llm,
    db: db as any,
    onProgress: (p) => {
      progressPhases.push(p.phase);
    },
  });

  r.assert(summary.status === "DONE", `job status DONE, got ${summary.status}`);
  r.assert(summary.found === 3, `found=3, got ${summary.found}`);
  r.assert(summary.withWebsite === 2, `withWebsite=2, got ${summary.withWebsite}`);
  r.assert(summary.withoutWebsite === 1, `withoutWebsite=1, got ${summary.withoutWebsite}`);
  r.assert(summary.promising === 1, `promising=1 (only old-werkstatt), got ${summary.promising}`);
  r.assert(summary.leadsCreated === 3, `leadsCreated=3, got ${summary.leadsCreated}`);
  r.assert(mapCalls === 1 && scrapeCalls === 1, `Firecrawl called exactly for the 1 promising site (map=${mapCalls}, scrape=${scrapeCalls})`);
  r.assert(pagespeedCalls === 1, `PageSpeed called exactly once, got ${pagespeedCalls}`);
  r.assert(
    ["search", "analysis", "scoring", "ai"].every((ph) => progressPhases.includes(ph)),
    `all phases reported, got ${JSON.stringify([...new Set(progressPhases)])}`
  );

  const leads = [...(db as any)._state.leads.values()] as any[];
  const noWebsiteLead = leads.find((l) => (db as any)._state.businesses.get(l.businessId).name === "No Website Barber");
  const goodLead = leads.find((l) => (db as any)._state.businesses.get(l.businessId).name === "Top Salon");
  const badLead = leads.find((l) => (db as any)._state.businesses.get(l.businessId).name === "Old Werkstatt");

  r.assert(noWebsiteLead.score > goodLead.score, `no-website lead scores higher than a great site (${noWebsiteLead.score} vs ${goodLead.score})`);
  r.assert(badLead.score > goodLead.score, `bad site scores higher than a great site (${badLead.score} vs ${goodLead.score})`);
  r.assert(llm.calls >= 1, `AI brief generated for at least the promising leads, calls=${llm.calls}`);
  r.assert(!!noWebsiteLead.salesBrief || !!badLead.salesBrief, "at least one high-score lead got a sales brief");

  r.assert(summary.costMax > 0, `cost estimate recorded (>0), got ${summary.costMax}`);
  const finalJob = (db as any)._state.searchJobs.get("job_e2e");
  r.assert(finalJob.status === "DONE", "SearchJob row updated to DONE in DB");
  r.assert(finalJob.promisingCount === 1, `SearchJob.promisingCount persisted, got ${finalJob.promisingCount}`);
}

async function testAiBudgetStopsGracefully() {
  const HTML_BAD = `<html><head></head><body>kein Inhalt</body></html>`;
  const places = [
    { id: "pa", name: "Biz A", website: null, rating: 4.5, reviews: 50, phone: "+491" },
    { id: "pb", name: "Biz B", website: null, rating: 4.6, reviews: 60, phone: "+492" },
  ];

  (globalThis as any).fetch = async (url: string) => {
    if (url.includes("places.googleapis.com/v1/places:searchText")) {
      const body = { places: places.map((p) => ({ id: p.id, displayName: { text: p.name }, formattedAddress: "Str, 35578 Wetzlar" })) };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (url.includes("places.googleapis.com/v1/places/")) {
      const placeId = url.split("/").pop()!;
      const p = places.find((x) => x.id === placeId)!;
      const body = { id: p.id, website: p.website, rating: p.rating, userRatingCount: p.reviews, internationalPhoneNumber: p.phone };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    return { ok: true, status: 200, url, text: async () => HTML_BAD };
  };

  const db = createFullFakeDb();
  (db.searchJob as any)._seed({
    id: "job_budget",
    userId: "u1",
    niche: "Barber",
    location: "Berlin",
    requestedCount: 2,
    status: "QUEUED",
    foundCount: 0,
    withWebsiteCount: 0,
    analyzedCount: 0,
    promisingCount: 0,
    usedGoogleRequests: 0,
    maxGoogleRequests: 100,
    usedFirecrawlCredits: 0,
    maxFirecrawlCredits: 100,
    usedPagespeedRequests: 0,
    maxPagespeedRequests: 100,
    usedAiCalls: 0,
    maxAiCalls: 1, // хватит только на 1 AI-вызов из 2 возможных лидов
  });

  const llm = fakeLLM();
  const summary = await runSearchJob({ jobId: "job_budget", keys: { google: "k" }, llm, db: db as any });

  r.assert(summary.status === "STOPPED_BUDGET_LIMIT", `status STOPPED_BUDGET_LIMIT, got ${summary.status}`);
  r.assert(summary.leadsCreated === 2, `both leads still scored (scoring is free), got ${summary.leadsCreated}`);
  r.assert(llm.calls === 1, `AI called exactly once before budget stopped it, got ${llm.calls}`);
  r.assert(
    summary.limitsHit.some((l) => l.includes("MAX_AI_CALLS_PER_JOB")),
    `limitsHit mentions MAX_AI_CALLS_PER_JOB, got ${JSON.stringify(summary.limitsHit)}`
  );
  const finalJob = (db as any)._state.searchJobs.get("job_budget");
  r.assert(finalJob.status === "STOPPED_BUDGET_LIMIT", "SearchJob row reflects the stop, not FAILED");
}

await testFullPipeline();
await testAiBudgetStopsGracefully();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
