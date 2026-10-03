import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { FirecrawlClient } from "../integrations/firecrawl/client.ts";
import { selectPagesToScrape, type SelectedPage } from "../integrations/firecrawl/select-pages.ts";
import { analyzeHtml, type HtmlSignals } from "./html-heuristics.ts";
import { checkAndIncrementUsage, logApiUsage, BudgetExceededError } from "../jobs/budget.ts";
import type { QuickCheckResult } from "./quick-check.ts";

const DEEP_ANALYSIS_TTL_DAYS = Number(process.env.DEEP_ANALYSIS_TTL_DAYS ?? 30);
const FIRECRAWL_MAX_PAGES = Number(process.env.FIRECRAWL_MAX_PAGES ?? 4);

/**
 * ВРЕМЕННЫЙ фильтр "стоит ли тратить Firecrawl-кредиты на этот сайт".
 * Это НЕ финальный Lead Score (тот — Phase 10, отдельный deterministic scoring
 * layer над этими же сигналами) — здесь только грубое да/нет, чтобы не гонять
 * deep analysis на сайты, которые и так выглядят нормально.
 */
export function isPromisingForDeepAnalysis(quickCheck: QuickCheckResult): boolean {
  if (!quickCheck.reachable) return false; // если сайт недоступен — Firecrawl тоже не поможет
  const problems = [
    !quickCheck.mobileFriendly,
    !quickCheck.hasClearCta,
    !quickCheck.title,
    !quickCheck.metaDescription,
    !quickCheck.hasReviewsKeyword,
  ].filter(Boolean).length;
  return problems >= 1;
}

export interface DeepAnalysisPageResult extends HtmlSignals {
  url: string;
  kind: SelectedPage["kind"];
  markdownExcerpt: string;
}

export type DeepAnalysisOutcome =
  | { status: "skipped_not_promising" }
  | { status: "cached"; pages: DeepAnalysisPageResult[] }
  | { status: "done"; pages: DeepAnalysisPageResult[] }
  | { status: "budget_exceeded"; pages: DeepAnalysisPageResult[] }
  | { status: "error"; error: string };

export interface RunDeepAnalysisParams {
  jobId: string;
  businessId: string;
  firecrawlApiKey: string;
  client?: PrismaClient;
  force?: boolean;
}

export async function runDeepAnalysis(params: RunDeepAnalysisParams): Promise<DeepAnalysisOutcome> {
  const db = params.client ?? prisma;

  const analysis = await db.websiteAnalysis.findUnique({ where: { businessId: params.businessId } });
  if (!analysis?.quickCheckResult) {
    return { status: "error", error: "quick check not done yet for this business" };
  }

  const quickCheck = analysis.quickCheckResult as unknown as QuickCheckResult;
  if (!params.force && !isPromisingForDeepAnalysis(quickCheck)) {
    return { status: "skipped_not_promising" };
  }

  // Кэш по домену — тот же normalizedDomain, что записал quick check
  if (!params.force && analysis.normalizedDomain) {
    const ttlCutoff = new Date(Date.now() - DEEP_ANALYSIS_TTL_DAYS * 24 * 60 * 60 * 1000);
    const cached = await db.websiteAnalysis.findFirst({
      where: {
        normalizedDomain: analysis.normalizedDomain,
        deepAnalyzedAt: { gte: ttlCutoff },
        deepAnalysisResult: { not: undefined },
      },
      orderBy: { deepAnalyzedAt: "desc" },
    });

    if (cached?.deepAnalysisResult) {
      await db.websiteAnalysis.update({
        where: { businessId: params.businessId },
        data: {
          status: "DEEP_DONE",
          deepAnalysisResult: cached.deepAnalysisResult,
          crawledPages: cached.crawledPages ?? undefined,
          deepAnalyzedAt: new Date(),
        },
      });
      return { status: "cached", pages: (cached.deepAnalysisResult as any).pages ?? [] };
    }
  }

  const business = await db.business.findUniqueOrThrow({ where: { id: params.businessId } });
  if (!business.website) return { status: "error", error: "business has no website" };

  const firecrawl = new FirecrawlClient(params.firecrawlApiKey);
  const pages: DeepAnalysisPageResult[] = [];

  try {
    // 1) map — дешёвая операция, находим реальные services/contact/about страницы
    await checkAndIncrementUsage(params.jobId, "usedFirecrawlCredits", 1, db);
    const mapResult = await firecrawl.mapSite(business.website);
    await logApiUsage({
      searchJobId: params.jobId,
      provider: "FIRECRAWL",
      requestType: "map",
      unitsConsumed: 1,
      client: db,
    });

    const selected = selectPagesToScrape(business.website, mapResult.links, FIRECRAWL_MAX_PAGES);

    // 2) scrape — максимум FIRECRAWL_MAX_PAGES страниц, не весь сайт
    for (const page of selected) {
      try {
        await checkAndIncrementUsage(params.jobId, "usedFirecrawlCredits", 1, db);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          await saveResult(db, params.businessId, analysis.normalizedDomain, pages);
          return { status: "budget_exceeded", pages };
        }
        throw err;
      }

      const scraped = await firecrawl.scrapeUrl(page.url);
      await logApiUsage({
        searchJobId: params.jobId,
        provider: "FIRECRAWL",
        requestType: "scrape",
        unitsConsumed: 1,
        client: db,
      });

      const signals = analyzeHtml(scraped.html);
      pages.push({
        url: page.url,
        kind: page.kind,
        markdownExcerpt: scraped.markdown.slice(0, 2000),
        ...signals,
      });
    }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : "unknown error" };
  }

  await saveResult(db, params.businessId, analysis.normalizedDomain, pages);
  return { status: "done", pages };
}

async function saveResult(
  db: PrismaClient,
  businessId: string,
  normalizedDomain: string | null,
  pages: DeepAnalysisPageResult[]
) {
  await db.websiteAnalysis.update({
    where: { businessId },
    data: {
      status: "DEEP_DONE",
      normalizedDomain: normalizedDomain ?? undefined,
      deepAnalysisResult: { pages } as any,
      crawledPages: pages.map((p) => ({ url: p.url, kind: p.kind })) as any,
      deepAnalyzedAt: new Date(),
    },
  });
}
