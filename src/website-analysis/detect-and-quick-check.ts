import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { normalizeDomain } from "./normalize-domain.ts";
import { runQuickCheck, type QuickCheckResult } from "./quick-check.ts";
import { isSocialOnly } from "./social.ts";

const QUICK_CHECK_TTL_DAYS = Number(process.env.QUICK_CHECK_TTL_DAYS ?? 30);

export type WebsiteDetectionOutcome =
  | { status: "no_website" }
  | { status: "quick_checked"; fromCache: boolean; result: QuickCheckResult };

/**
 * Website detection ("есть ли сайт") — бесплатно и мгновенно: это просто поле
 * business.website, которое уже заполнено на этапе Place Details (Phase 4).
 * Отдельного API-вызова для этого не нужно.
 *
 * Если сайт есть — запускаем ДЕШЁВЫЙ quick check (1 fetch домашней страницы).
 * Если для этого домена уже есть свежий quickCheckResult (у ЛЮБОГО business —
 * несколько компаний нередко используют один и тот же сайт/агентство) —
 * переиспользуем его и не делаем повторный запрос вообще.
 */
export async function detectAndQuickCheck(
  businessId: string,
  client: PrismaClient = prisma
): Promise<WebsiteDetectionOutcome> {
  const business = await client.business.findUniqueOrThrow({ where: { id: businessId } });

  if (!business.website || business.website.trim() === "" || isSocialOnly(business.website)) {
    // нет сайта вообще, либо в Google указана только страница соцсети
    return { status: "no_website" };
  }

  const normalizedDomain = normalizeDomain(business.website);

  // 1) пробуем переиспользовать свежий результат по домену
  if (normalizedDomain) {
    const ttlCutoff = new Date(Date.now() - QUICK_CHECK_TTL_DAYS * 24 * 60 * 60 * 1000);
    const cached = await client.websiteAnalysis.findFirst({
      where: {
        normalizedDomain,
        quickCheckedAt: { gte: ttlCutoff },
        quickCheckResult: { not: undefined },
      },
      orderBy: { quickCheckedAt: "desc" },
    });

    if (cached?.quickCheckResult) {
      await client.websiteAnalysis.upsert({
        where: { businessId },
        update: {
          status: "QUICK_DONE",
          normalizedDomain,
          quickCheckResult: cached.quickCheckResult,
          quickCheckedAt: new Date(),
        },
        create: {
          businessId,
          status: "QUICK_DONE",
          normalizedDomain,
          quickCheckResult: cached.quickCheckResult,
          quickCheckedAt: new Date(),
        },
      });
      return {
        status: "quick_checked",
        fromCache: true,
        result: cached.quickCheckResult as unknown as QuickCheckResult,
      };
    }
  }

  // 2) реальный fetch — своего сайта business'а, не платный API, budget-tracker не нужен
  const result = await runQuickCheck(business.website);

  await client.websiteAnalysis.upsert({
    where: { businessId },
    update: {
      status: result.error ? "ERROR" : "QUICK_DONE",
      normalizedDomain,
      quickCheckResult: result as any,
      quickCheckedAt: new Date(),
      errorMessage: result.error,
    },
    create: {
      businessId,
      status: result.error ? "ERROR" : "QUICK_DONE",
      normalizedDomain,
      quickCheckResult: result as any,
      quickCheckedAt: new Date(),
      errorMessage: result.error,
    },
  });

  return { status: "quick_checked", fromCache: false, result };
}
