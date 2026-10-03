import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { computeLeadScore, type ScoreResult } from "../scoring/score.ts";
import type { QuickCheckResult } from "../website-analysis/quick-check.ts";
import type { PageSpeedResult } from "../integrations/pagespeed/client.ts";

export const BLOCK_VERSION = 1;

/**
 * Считает Lead Score по накопленным данным и сохраняет Lead.
 * Возвращает null, если Place Details ещё не получены: тогда мы НЕ знаем, есть ли у бизнеса сайт,
 * и нельзя считать его "без сайта" (это дало бы ложный лид).
 * При пересчёте не затираются CRM-статус, заметки, избранное и sales brief.
 */
export async function buildLead(
  businessId: string,
  db: PrismaClient = prisma
): Promise<{ leadId: string; result: ScoreResult } | null> {
  const business = (await db.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { websiteAnalysis: true },
  })) as any;

  if (!business.detailsFetchedAt) return null;

  const analysis = business.websiteAnalysis;
  const deepPages = ((analysis?.deepAnalysisResult as any)?.pages ?? []) as any[];

  const result = computeLeadScore({
    niche: business.category ?? null,
    business: {
      name: business.name,
      rating: business.rating ?? null,
      reviewCount: business.reviewCount ?? null,
      phone: business.phone ?? null,
      website: business.website ?? null,
      hasOpeningHours: !!business.openingHours,
    },
    quickCheck: (analysis?.quickCheckResult as QuickCheckResult | null) ?? null,
    deepPages,
    pagespeed: (analysis?.pagespeedResult as PageSpeedResult | null) ?? null,
  });

  const breakdown = {
    version: BLOCK_VERSION,
    total: result.score,
    rawTotal: result.rawTotal,
    items: result.items,
    websiteStatus: result.websiteStatus,
    data: result.data,
  };

  const lead = (await db.lead.upsert({
    where: { businessId },
    update: { score: result.score, scoreBreakdown: breakdown as any, opportunities: result.opportunities as any },
    create: { businessId, score: result.score, scoreBreakdown: breakdown as any, opportunities: result.opportunities as any },
  })) as any;

  return { leadId: lead.id, result };
}
