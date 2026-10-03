import { createReporter } from "./lib/assert.ts";
import { createLeadFakeDb } from "./lib/lead-fake-db.ts";
import { buildLead } from "../src/leads/build-lead.ts";
import { ensureSalesBrief, generateOutreach } from "../src/leads/ai.ts";
import { loadLeadView } from "../src/leads/repository.ts";
import type { LLMProvider, JsonRequest, JsonResponse } from "../src/llm/provider.ts";

const r = createReporter();

function fakeLLM(responder: (req: JsonRequest) => any): LLMProvider {
  let calls = 0;
  const llm: LLMProvider & { calls: () => number } = {
    name: "fake",
    model: "fake-model",
    async generateJson<T>(req: JsonRequest): Promise<JsonResponse<T>> {
      calls++;
      return { data: responder(req) as T, usage: { inputTokens: 500, outputTokens: 150 }, model: "fake-model" };
    },
    calls: () => calls,
  };
  return llm;
}

async function testBuildLeadNullWithoutDetails() {
  const db = createLeadFakeDb();
  db._seedBusiness({ id: "b1", name: "No Details Yet", detailsFetchedAt: null, category: "Friseur" });
  const result = await buildLead("b1", db as any);
  r.assert(result === null, "buildLead returns null when Details not fetched yet (avoids false NO_WEBSITE)");
}

async function testBuildLeadNoWebsiteAndSalesBrief() {
  const db = createLeadFakeDb();
  db._seedBusiness({ id: "b2", name: "Barber Shop X", detailsFetchedAt: new Date(), website: null, rating: 4.7, reviewCount: 90, phone: "+4912345", category: "Barber", openingHours: { weekdayDescriptions: ["Mo-Fr 9-18"] } });
  const built = await buildLead("b2", db as any);
  r.assert(built !== null && built.result.score > 50, `lead built with high score, got ${built?.result.score}`);

  const llm = fakeLLM((req) => {
    r.assert(JSON.stringify(req.user).includes("Barber Shop X"), "prompt includes business name");
    r.assert(JSON.stringify(req.user).includes("NO_WEBSITE"), "prompt includes NO_WEBSITE opportunity code");
    return { what_they_do: "Barbershop", main_problem: "Нет сайта", opportunity: "Новый сайт", what_to_sell: "Landing page", why: "В Google сайт не указан", next_step: "Написать и предложить превью" };
  });

  const brief = await ensureSalesBrief({ db: db as any, llm }, built!.leadId);
  r.assert(!!brief && brief.includes("Barbershop"), "sales brief generated and formatted");
  r.assert((llm as any).calls() === 1, "LLM called once");

  const briefAgain = await ensureSalesBrief({ db: db as any, llm }, built!.leadId);
  r.assert(briefAgain === brief, "second call returns cached brief");
  r.assert((llm as any).calls() === 1, "LLM NOT called again — cached");
}

async function testOutreachIsGermanAndUsesOnlyVerifiedFindings() {
  const db = createLeadFakeDb();
  db._seedBusiness({ id: "b3", name: "Salon Y", detailsFetchedAt: new Date(), website: null, rating: 4.5, reviewCount: 40, category: "Beauty" });
  const built = await buildLead("b3", db as any);

  let capturedUser = "";
  const llm = fakeLLM((req) => {
    capturedUser = req.user;
    return { message: "Guten Tag,\n\nich habe mir Ihren Auftritt angeschaut...\n\nViele Grüße\nMax" };
  });

  const msg = await generateOutreach({ db: db as any, llm }, built!.leadId, "Max Mustermann");
  r.assert(msg.startsWith("Guten Tag"), "message starts with German greeting");
  r.assert(!capturedUser.includes("не удалось проверить"), "unverified-type notes not leaked into verifiedFindings for prompt");

  const view = await loadLeadView(built!.leadId, db as any);
  r.assert(view?.latestOutreach === msg, "outreach saved and retrievable via loadLeadView");
}

await testBuildLeadNullWithoutDetails();
await testBuildLeadNoWebsiteAndSalesBrief();
await testOutreachIsGermanAndUsesOnlyVerifiedFindings();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
