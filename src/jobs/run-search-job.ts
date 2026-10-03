import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { settings } from "../config/env.ts";
import { assertMonthlyBudget, BudgetExceededError } from "./budget.ts";
import { runWithConcurrency } from "./concurrency.ts";
import { searchBusinesses } from "../integrations/google-places/search-service.ts";
import { runWebsiteAnalysisForJob, emptyCounters, type WebsiteAnalysisCounters } from "../website-analysis/pipeline.ts";
import { buildLead } from "../leads/build-lead.ts";
import { ensureSalesBrief } from "../leads/ai.ts";
import type { LLMProvider } from "../llm/provider.ts";

export type JobProgress =
  | { phase: "search" }
  | { phase: "analysis"; counters: WebsiteAnalysisCounters; found: number }
  | { phase: "scoring" }
  | { phase: "ai"; done: number; total: number };

export interface JobSummary {
  jobId: string;
  status: "DONE" | "STOPPED_BUDGET_LIMIT" | "FAILED";
  found: number;
  withWebsite: number;
  withoutWebsite: number;
  promising: number;
  leadsCreated: number;
  hotLeads: number;
  aiBriefs: number;
  limitsHit: string[];
  error?: string;
  costMin: number;
  costMax: number;
}

export interface RunSearchJobParams {
  jobId: string;
  keys: { google: string; firecrawl?: string; pagespeed?: string };
  llm: LLMProvider | null;
  db?: PrismaClient;
  onProgress?: (progress: JobProgress) => void | Promise<void>;
}

/**
 * Весь pipeline одного поиска:
 * Search -> Details -> Quick Check -> (promising) Firecrawl + PageSpeed -> Scoring -> AI brief.
 * Любой достигнутый лимит останавливает соответствующий этап и попадает в статус/причину job.
 */
export async function runSearchJob(params: RunSearchJobParams): Promise<JobSummary> {
  const db = params.db ?? prisma;
  const report = async (p: JobProgress) => {
    try {
      await params.onProgress?.(p);
    } catch {
      /* прогресс — второстепенное, его сбой не должен ронять job */
    }
  };

  const summary: JobSummary = {
    jobId: params.jobId,
    status: "DONE",
    found: 0,
    withWebsite: 0,
    withoutWebsite: 0,
    promising: 0,
    leadsCreated: 0,
    hotLeads: 0,
    aiBriefs: 0,
    limitsHit: [],
    costMin: 0,
    costMax: 0,
  };

  try {
    const job = (await db.searchJob.findUniqueOrThrow({ where: { id: params.jobId } })) as any;
    await db.searchJob.update({ where: { id: params.jobId }, data: { status: "RUNNING", startedAt: new Date() } });

    // 0) месячный бюджет
    await assertMonthlyBudget(settings.maxMonthlyBudgetEur(), db);

    // 1) поиск
    await report({ phase: "search" });
    const search = await searchBusinesses({
      jobId: params.jobId,
      niche: job.niche,
      location: job.location,
      requestedCount: job.requestedCount,
      apiKey: params.keys.google,
      client: db,
    });
    summary.found = search.foundCount;
    if (search.stoppedForBudget) summary.limitsHit.push("Google (MAX_GOOGLE_REQUESTS_PER_JOB)");

    // 2) Details + quick check + deep + pagespeed
    let counters = emptyCounters(search.foundCount);
    if (search.foundCount > 0) {
      counters = await runWebsiteAnalysisForJob({
        jobId: params.jobId,
        googleApiKey: params.keys.google,
        firecrawlApiKey: params.keys.firecrawl,
        pagespeedApiKey: params.keys.pagespeed,
        client: db,
        onProgress: (c) => report({ phase: "analysis", counters: c, found: search.foundCount }),
      });
    }
    summary.withWebsite = counters.withWebsite;
    summary.withoutWebsite = counters.withoutWebsite;
    summary.promising = counters.promising;
    if (counters.stoppedForBudget && !summary.limitsHit.some((l) => l.startsWith("Google")))
      summary.limitsHit.push("Google (MAX_GOOGLE_REQUESTS_PER_JOB)");
    if (counters.deepAnalysisSkippedBudget > 0) summary.limitsHit.push("Firecrawl (MAX_FIRECRAWL_CREDITS_PER_JOB)");
    if (counters.pagespeedSkippedBudget > 0) summary.limitsHit.push("PageSpeed (MAX_PAGESPEED_REQUESTS_PER_JOB)");

    // 3) scoring — лиды создаются только для компаний, по которым получены Place Details
    await report({ phase: "scoring" });
    const links = (await db.searchJobBusiness.findMany({ where: { searchJobId: params.jobId } })) as any[];
    const leads: { leadId: string; score: number }[] = [];
    for (const link of links) {
      const built = await buildLead(link.businessId, db);
      if (built) leads.push({ leadId: built.leadId, score: built.result.score });
    }
    summary.leadsCreated = leads.length;
    summary.hotLeads = leads.filter((l) => l.score >= settings.hotScore()).length;

    // 4) AI sales brief — только для перспективных лидов и в пределах MAX_AI_CALLS_PER_JOB
    if (params.llm) {
      const candidates = leads.filter((l) => l.score >= settings.aiMinScore()).sort((a, b) => b.score - a.score);
      let done = 0;
      let aiExhausted = false;
      await report({ phase: "ai", done, total: candidates.length });
      await runWithConcurrency(candidates, settings.aiConcurrency(), async (candidate) => {
        if (aiExhausted) return;
        try {
          await ensureSalesBrief({ db, llm: params.llm!, jobId: params.jobId }, candidate.leadId);
          summary.aiBriefs++;
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            aiExhausted = true;
            const label = err.reason.startsWith("MAX_MONTHLY") ? "Месячный бюджет (MAX_MONTHLY_API_BUDGET)" : "OpenAI (MAX_AI_CALLS_PER_JOB)";
            if (!summary.limitsHit.includes(label)) summary.limitsHit.push(label);
          } else {
            console.error("[job] AI brief failed:", err instanceof Error ? err.message : err);
          }
        }
        done++;
        await report({ phase: "ai", done, total: candidates.length });
      });
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      summary.limitsHit.push(err.reason.startsWith("MAX_MONTHLY") ? "Месячный бюджет (MAX_MONTHLY_API_BUDGET)" : err.reason);
    } else {
      summary.status = "FAILED";
      summary.error = err instanceof Error ? err.message : String(err);
      console.error("[job] failed:", err);
    }
  }

  if (summary.status !== "FAILED" && summary.limitsHit.length > 0) summary.status = "STOPPED_BUDGET_LIMIT";

  // фактический учёт расходов job (диапазон из ApiUsageLog)
  try {
    const logs = (await db.apiUsageLog.findMany({ where: { searchJobId: params.jobId } })) as any[];
    summary.costMin = logs.reduce((s, l) => s + Number(l.estimatedCostMin ?? 0), 0);
    summary.costMax = logs.reduce((s, l) => s + Number(l.estimatedCostMax ?? 0), 0);
  } catch {
    /* не критично */
  }

  await db.searchJob.update({
    where: { id: params.jobId },
    data: {
      status: summary.status,
      stoppedReason:
        summary.status === "FAILED"
          ? (summary.error ?? "unknown error").slice(0, 500)
          : summary.limitsHit.length > 0
            ? `Достигнут лимит: ${summary.limitsHit.join(", ")}`
            : null,
      finishedAt: new Date(),
      promisingCount: summary.promising,
      costEstimateMin: summary.costMin,
      costEstimateMax: summary.costMax,
    },
  });

  return summary;
}
