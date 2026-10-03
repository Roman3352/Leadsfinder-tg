import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { PageSpeedClient, type PageSpeedResult } from "../integrations/pagespeed/client.ts";
import { checkAndIncrementUsage, logApiUsage, BudgetExceededError } from "../jobs/budget.ts";
import { isPromisingForDeepAnalysis } from "./deep-analysis.ts";
import type { QuickCheckResult } from "./quick-check.ts";

const PAGESPEED_TTL_DAYS = Number(process.env.PAGESPEED_TTL_DAYS ?? 30);

export type PageSpeedOutcome =
  | { status: "skipped_not_promising" }
  | { status: "cached"; result: PageSpeedResult }
  | { status: "done"; result: PageSpeedResult }
  | { status: "budget_exceeded" }
  | { status: "error"; error: string };

export interface RunPageSpeedParams {
  jobId: string;
  businessId: string;
  pagespeedApiKey: string;
  client?: PrismaClient;
  force?: boolean;
}

/**
 * PageSpeed бесплатный, но небыстрый и с дневной квотой — поэтому та же
 * дисциплина, что и с Firecrawl: только для promising-лидов, кэш по домену
 * (PAGESPEED_TTL_DAYS), явный лимит запросов на job (MAX_PAGESPEED_REQUESTS_PER_JOB
 * через тот же budget-tracker).
 */
export async function runPageSpeedAnalysis(params: RunPageSpeedParams): Promise<PageSpeedOutcome> {
  const db = params.client ?? prisma;

  const analysis = await db.websiteAnalysis.findUnique({ where: { businessId: params.businessId } });
  if (!analysis?.quickCheckResult) {
    return { status: "error", error: "quick check not done yet for this business" };
  }

  const quickCheck = analysis.quickCheckResult as unknown as QuickCheckResult;
  if (!params.force && !isPromisingForDeepAnalysis(quickCheck)) {
    return { status: "skipped_not_promising" };
  }

  if (!params.force && analysis.normalizedDomain) {
    const ttlCutoff = new Date(Date.now() - PAGESPEED_TTL_DAYS * 24 * 60 * 60 * 1000);
    const cached = await db.websiteAnalysis.findFirst({
      where: {
        normalizedDomain: analysis.normalizedDomain,
        pagespeedCheckedAt: { gte: ttlCutoff },
        pagespeedResult: { not: undefined },
      },
      orderBy: { pagespeedCheckedAt: "desc" },
    });

    if (cached?.pagespeedResult) {
      await db.websiteAnalysis.update({
        where: { businessId: params.businessId },
        data: { pagespeedResult: cached.pagespeedResult, pagespeedCheckedAt: new Date() },
      });
      return { status: "cached", result: cached.pagespeedResult as unknown as PageSpeedResult };
    }
  }

  try {
    await checkAndIncrementUsage(params.jobId, "usedPagespeedRequests", 1, db);
  } catch (err) {
    if (err instanceof BudgetExceededError) return { status: "budget_exceeded" };
    throw err;
  }

  const business = await db.business.findUniqueOrThrow({ where: { id: params.businessId } });
  if (!business.website) return { status: "error", error: "business has no website" };

  try {
    const client = new PageSpeedClient(params.pagespeedApiKey);
    const result = await client.analyze(business.website, "mobile");

    await logApiUsage({
      searchJobId: params.jobId,
      provider: "PAGESPEED",
      requestType: "run_pagespeed",
      unitsConsumed: 1,
      actualCost: 0,
      client: db,
    });

    await db.websiteAnalysis.update({
      where: { businessId: params.businessId },
      data: {
        pagespeedResult: result as any,
        pagespeedCheckedAt: new Date(),
        normalizedDomain: analysis.normalizedDomain ?? undefined,
      },
    });

    return { status: "done", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await db.websiteAnalysis.update({
      where: { businessId: params.businessId },
      data: { errorMessage: message },
    });
    return { status: "error", error: message };
  }
}
