import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { fetchDetailsForBusiness } from "../integrations/google-places/details-service.ts";
import { detectAndQuickCheck } from "./detect-and-quick-check.ts";
import { runDeepAnalysis, isPromisingForDeepAnalysis } from "./deep-analysis.ts";
import { runPageSpeedAnalysis } from "./pagespeed-analysis.ts";
import { runWithConcurrency } from "../jobs/concurrency.ts";

const QUICK_CHECK_CONCURRENCY = Number(process.env.QUICK_CHECK_CONCURRENCY ?? 5);

export interface WebsiteAnalysisCounters {
  processed: number;
  total: number;
  withWebsite: number;
  withoutWebsite: number;
  analyzed: number; // quick check выполнен без ошибки
  errors: number; // сайт недоступен / не разобрался
  failed: number; // неожиданная ошибка на конкретной компании (job при этом продолжается)
  promising: number; // прошли фильтр -> deep analysis / PageSpeed
  deepAnalyzed: number;
  deepAnalysisSkippedBudget: number;
  deepAnalysisErrors: number;
  pagespeedAnalyzed: number;
  pagespeedSkippedBudget: number;
  pagespeedErrors: number;
  stoppedForBudget: boolean; // исчерпан Google-бюджет: без Details мы не знаем, есть ли сайт
}

export interface RunWebsiteAnalysisParams {
  jobId: string;
  googleApiKey: string;
  firecrawlApiKey?: string;
  pagespeedApiKey?: string;
  client?: PrismaClient;
  onProgress?: (counters: WebsiteAnalysisCounters) => void | Promise<void>;
  progressEveryN?: number;
}

export function emptyCounters(total = 0): WebsiteAnalysisCounters {
  return {
    processed: 0,
    total,
    withWebsite: 0,
    withoutWebsite: 0,
    analyzed: 0,
    errors: 0,
    failed: 0,
    promising: 0,
    deepAnalyzed: 0,
    deepAnalysisSkippedBudget: 0,
    deepAnalysisErrors: 0,
    pagespeedAnalyzed: 0,
    pagespeedSkippedBudget: 0,
    pagespeedErrors: 0,
    stoppedForBudget: false,
  };
}

/**
 * Details -> Quick Check -> (только для promising) Firecrawl + PageSpeed, для каждой компании job.
 * Ошибка на одной компании не валит весь job. Бюджет Google останавливает весь job,
 * бюджеты Firecrawl/PageSpeed отключают только соответствующий этап.
 */
export async function runWebsiteAnalysisForJob(params: RunWebsiteAnalysisParams): Promise<WebsiteAnalysisCounters> {
  const db = params.client ?? prisma;
  const progressEveryN = params.progressEveryN ?? 10;

  const links = (await db.searchJobBusiness.findMany({
    where: { searchJobId: params.jobId },
    include: { business: true },
  })) as any[];

  const counters = emptyCounters(links.length);
  let firecrawlExhausted = !params.firecrawlApiKey;
  let pagespeedExhausted = !params.pagespeedApiKey;

  await runWithConcurrency(links, QUICK_CHECK_CONCURRENCY, async (link) => {
    if (counters.stoppedForBudget) return;
    const businessId: string = link.businessId;

    try {
      const detailsOutcome = await fetchDetailsForBusiness({
        jobId: params.jobId,
        businessId,
        apiKey: params.googleApiKey,
        client: db,
      });

      if (detailsOutcome.status === "budget_exceeded") {
        counters.stoppedForBudget = true;
        return;
      }

      const detection = await detectAndQuickCheck(businessId, db);

      if (detection.status === "no_website") {
        counters.withoutWebsite++;
      } else {
        counters.withWebsite++;
        if (detection.result.error) {
          counters.errors++;
        } else {
          counters.analyzed++;

          if (isPromisingForDeepAnalysis(detection.result)) {
            counters.promising++;

            if (!firecrawlExhausted) {
              const deep = await runDeepAnalysis({
                jobId: params.jobId,
                businessId,
                firecrawlApiKey: params.firecrawlApiKey!,
                client: db,
              });
              if (deep.status === "done" || deep.status === "cached") counters.deepAnalyzed++;
              else if (deep.status === "budget_exceeded") {
                counters.deepAnalysisSkippedBudget++;
                firecrawlExhausted = true;
              } else if (deep.status === "error") counters.deepAnalysisErrors++;
            } else if (params.firecrawlApiKey) {
              counters.deepAnalysisSkippedBudget++;
            }

            if (!pagespeedExhausted) {
              const ps = await runPageSpeedAnalysis({
                jobId: params.jobId,
                businessId,
                pagespeedApiKey: params.pagespeedApiKey!,
                client: db,
              });
              if (ps.status === "done" || ps.status === "cached") counters.pagespeedAnalyzed++;
              else if (ps.status === "budget_exceeded") {
                counters.pagespeedSkippedBudget++;
                pagespeedExhausted = true;
              } else if (ps.status === "error") counters.pagespeedErrors++;
            } else if (params.pagespeedApiKey) {
              counters.pagespeedSkippedBudget++;
            }
          }
        }
      }
    } catch (err) {
      counters.failed++;
      console.error(`[pipeline] business ${businessId} failed:`, err instanceof Error ? err.message : err);
    }

    counters.processed++;

    await db.searchJob.update({
      where: { id: params.jobId },
      data: {
        withWebsiteCount: counters.withWebsite,
        analyzedCount: counters.analyzed,
        promisingCount: counters.promising,
      },
    });

    if (params.onProgress && counters.processed % progressEveryN === 0) {
      await params.onProgress({ ...counters });
    }
  });

  if (params.onProgress) await params.onProgress({ ...counters });
  return counters;
}
