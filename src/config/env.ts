export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function envString(name: string): string | undefined {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

// Значения читаются в момент вызова (а не при импорте) — так их можно менять в тестах.
export const settings = {
  hotScore: () => envNumber("HOT_LEAD_SCORE", 70),
  aiMinScore: () => envNumber("AI_MIN_SCORE", 40),
  maxMonthlyBudgetEur: () => envNumber("MAX_MONTHLY_API_BUDGET", 20),
  aiConcurrency: () => envNumber("AI_CONCURRENCY", 3),
  jobLimits: () => ({
    maxGoogleRequests: envNumber("MAX_GOOGLE_REQUESTS_PER_JOB", 250),
    maxFirecrawlCredits: envNumber("MAX_FIRECRAWL_CREDITS_PER_JOB", 400),
    maxPagespeedRequests: envNumber("MAX_PAGESPEED_REQUESTS_PER_JOB", 100),
    maxAiCalls: envNumber("MAX_AI_CALLS_PER_JOB", 120),
  }),
};
