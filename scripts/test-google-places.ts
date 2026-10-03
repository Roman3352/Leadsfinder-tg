import { createReporter } from "./lib/assert.ts";
import { searchBusinesses } from "../src/integrations/google-places/search-service.ts";
import { fetchDetailsForBusiness } from "../src/integrations/google-places/details-service.ts";

const r = createReporter();

function createFakeDb(job: any) {
  const businesses = new Map<string, any>();
  const byPlaceId = new Map<string, string>();
  const jobs = new Map<string, any>([[job.id, job]]);
  let n = 0;
  return {
    _state: { businesses, jobs },
    business: {
      async upsert({ where, update, create }: any) {
        const existingId = byPlaceId.get(where.googlePlaceId);
        if (existingId) {
          const b = businesses.get(existingId)!;
          Object.assign(b, update);
          return b;
        }
        const id = `biz_${++n}`;
        const b = { id, googlePlaceId: where.googlePlaceId, ...create };
        businesses.set(id, b);
        byPlaceId.set(where.googlePlaceId, id);
        return b;
      },
      async findUniqueOrThrow({ where }: any) {
        const b = businesses.get(where.id);
        if (!b) throw new Error("not found");
        return b;
      },
      async update({ where, data }: any) {
        Object.assign(businesses.get(where.id)!, data);
        return businesses.get(where.id);
      },
    },
    searchJobBusiness: { async upsert() { return {}; } },
    searchJob: {
      async findUniqueOrThrow({ where }: any) {
        return { ...jobs.get(where.id) };
      },
      async update({ where, data }: any) {
        const j = jobs.get(where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as any)) (j as any)[k] += (v as any).increment;
          else (j as any)[k] = v;
        }
        return { ...j };
      },
      async updateMany({ where, data }: any) {
        const j = jobs.get(where.id);
        if (!j) return { count: 0 };
        const cf = Object.keys(where).find((k) => k !== "id");
        if (cf && !((j as any)[cf] <= (where as any)[cf].lte)) return { count: 0 };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as any)) (j as any)[k] += (v as any).increment;
        }
        return { count: 1 };
      },
    },
    apiUsageLog: { async create() { return {}; } },
  };
}

async function testPaginationAndDedup() {
  const responses = [
    { places: [{ id: "p1", displayName: { text: "A" }, formattedAddress: "Str 1, 35578 Wetzlar" }, { id: "p2", displayName: { text: "B" }, formattedAddress: "Str 2" }], nextPageToken: "t2" },
    { places: [{ id: "p1", displayName: { text: "A" }, formattedAddress: "Str 1" }, { id: "p3", displayName: { text: "C" }, formattedAddress: "Str 3" }] },
  ];
  let i = 0;
  const calls: any[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    const body = responses[i++];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  const db = createFakeDb({ id: "job_1", foundCount: 0, usedGoogleRequests: 0, maxGoogleRequests: 100 });
  const result = await searchBusinesses({ jobId: "job_1", niche: "Barber", location: "Wetzlar", requestedCount: 50, apiKey: "k", client: db as any });

  r.assert(calls.length === 2, `2 search calls, got ${calls.length}`);
  r.assert(db._state.businesses.size === 3, `3 unique businesses, got ${db._state.businesses.size}`);
  r.assert(result.foundCount === 4, `foundCount=4, got ${result.foundCount}`);
  const city = [...db._state.businesses.values()].find((b: any) => b.googlePlaceId === "p1")?.city;
  r.assert(city === "Wetzlar", `city parsed from formattedAddress, got ${city}`);
}

async function testBudgetStopsSearch() {
  const page = { places: [{ id: "px", displayName: { text: "X" }, formattedAddress: "A" }], nextPageToken: "more" };
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => page, text: async () => JSON.stringify(page) });
  const db = createFakeDb({ id: "job_2", foundCount: 0, usedGoogleRequests: 0, maxGoogleRequests: 2 });
  const result = await searchBusinesses({ jobId: "job_2", niche: "X", location: "Y", requestedCount: 1000, apiKey: "k", client: db as any });
  r.assert(result.stoppedForBudget === true, "stopped for budget");
  r.assert((db._state.jobs.get("job_2") as any).usedGoogleRequests === 2, "usage capped at 2");
}

async function testDetailsCaching() {
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    const body = { id: "p1", website: "https://example.de", rating: 4.5, userRatingCount: 120 };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const db = createFakeDb({ id: "job_3", foundCount: 0, usedGoogleRequests: 0, maxGoogleRequests: 100 });
  const business = await (db as any).business.upsert({ where: { googlePlaceId: "p1" }, update: {}, create: { name: "T" } });
  const first = await fetchDetailsForBusiness({ jobId: "job_3", businessId: business.id, apiKey: "k", client: db as any });
  const second = await fetchDetailsForBusiness({ jobId: "job_3", businessId: business.id, apiKey: "k", client: db as any });
  r.assert(first.status === "fetched", "first fetched");
  r.assert(second.status === "cached", "second cached");
  r.assert(calls === 1, `only 1 real API call, got ${calls}`);
}

await testPaginationAndDedup();
await testBudgetStopsSearch();
await testDetailsCaching();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
