import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { unitCostEur } from "../config/pricing.ts";

export type UsageField =
  | "usedGoogleRequests"
  | "usedFirecrawlCredits"
  | "usedPagespeedRequests"
  | "usedAiCalls";

const LIMIT_FIELD: Record<UsageField, string> = {
  usedGoogleRequests: "maxGoogleRequests",
  usedFirecrawlCredits: "maxFirecrawlCredits",
  usedPagespeedRequests: "maxPagespeedRequests",
  usedAiCalls: "maxAiCalls",
};

export class BudgetExceededError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "BudgetExceededError";
    this.reason = reason;
  }
}

/**
 * Атомарно проверяет и увеличивает счётчик расхода на SearchJob.
 * Условный UPDATE (usedX <= maxX - amount) защищает от гонки между параллельными вызовами.
 * Если лимит исчерпан — BudgetExceededError: вызывающий код должен остановиться, а не тратить дальше.
 */
export async function checkAndIncrementUsage(
  jobId: string,
  field: UsageField,
  amount: number,
  client: PrismaClient = prisma
): Promise<void> {
  const limitField = LIMIT_FIELD[field];

  const job = (await client.searchJob.findUniqueOrThrow({ where: { id: jobId } })) as any;
  if (job[field] + amount > job[limitField]) {
    throw new BudgetExceededError(`${field} limit reached: ${job[field]}+${amount} > ${job[limitField]}`);
  }

  const result = await client.searchJob.updateMany({
    where: { id: jobId, [field]: { lte: job[limitField] - amount } } as any,
    data: { [field]: { increment: amount } } as any,
  });

  if (result.count === 0) {
    const fresh = (await client.searchJob.findUniqueOrThrow({ where: { id: jobId } })) as any;
    if (fresh[field] + amount > fresh[limitField]) {
      throw new BudgetExceededError(`${field} limit reached: ${fresh[field]}+${amount} > ${fresh[limitField]}`);
    }
    await client.searchJob.update({ where: { id: jobId }, data: { [field]: { increment: amount } } as any });
  }
}

export interface MonthlySpend {
  min: number;
  max: number;
  spentForBudget: number; // консервативно: max-оценка (или actualCost, если он известен)
}

/** Сумма расходов (EUR) по ApiUsageLog с начала текущего месяца. */
export async function getMonthlySpend(client: PrismaClient = prisma): Promise<MonthlySpend> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const logs = (await client.apiUsageLog.findMany({
    where: { createdAt: { gte: start } },
  })) as any[];

  let min = 0;
  let max = 0;
  let spent = 0;
  for (const log of logs) {
    const lo = Number(log.estimatedCostMin ?? 0);
    const hi = Number(log.estimatedCostMax ?? 0);
    min += lo;
    max += hi;
    spent += log.actualCost !== null && log.actualCost !== undefined ? Number(log.actualCost) : hi;
  }
  return { min, max, spentForBudget: spent };
}

/** Останавливает работу, если месячный бюджет (MAX_MONTHLY_API_BUDGET, EUR) уже исчерпан. */
export async function assertMonthlyBudget(maxMonthlyEur: number, client: PrismaClient = prisma): Promise<void> {
  const spend = await getMonthlySpend(client);
  if (spend.spentForBudget >= maxMonthlyEur) {
    throw new BudgetExceededError(
      `MAX_MONTHLY_API_BUDGET reached: ~€${spend.spentForBudget.toFixed(2)} of €${maxMonthlyEur.toFixed(2)}`
    );
  }
}

export async function logApiUsage(params: {
  searchJobId?: string;
  provider: "GOOGLE_PLACES_SEARCH" | "GOOGLE_PLACES_DETAILS" | "FIRECRAWL" | "PAGESPEED" | "OPENAI";
  requestType: string;
  unitsConsumed?: number;
  estimatedCostMin?: number;
  estimatedCostMax?: number;
  actualCost?: number;
  client?: PrismaClient;
}): Promise<void> {
  const client = params.client ?? prisma;
  const units = params.unitsConsumed ?? 1;
  const unit = unitCostEur(params.provider, params.requestType);

  await client.apiUsageLog.create({
    data: {
      searchJobId: params.searchJobId,
      provider: params.provider,
      requestType: params.requestType,
      unitsConsumed: units,
      estimatedCostMin: params.estimatedCostMin ?? unit.min * units,
      estimatedCostMax: params.estimatedCostMax ?? unit.max * units,
      actualCost: params.actualCost,
    },
  });
}
