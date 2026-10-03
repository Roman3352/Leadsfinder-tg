import { unitCostEur, llmCostEur, type CostRange } from "../config/pricing.ts";

/**
 * Оценка стоимости поиска (диапазон, а не точная цифра). Допущения ниже —
 * консервативные и намеренно грубые; фактические расходы пишутся в ApiUsageLog,
 * чтобы позже сравнивать estimated vs actual.
 */
const ASSUMPTIONS = {
  resultsPerSearchPage: 20,
  withWebsiteRatio: { min: 0.5, max: 0.85 },
  promisingRatio: { min: 0.3, max: 0.8 }, // доля сайтов, идущих на deep analysis
  firecrawlCreditsPerSite: { min: 3, max: 5 }, // 1 map + 2..4 scrape
  aiBriefRatio: { min: 0.2, max: 0.7 }, // доля лидов, для которых делается AI brief
  aiTokens: { min: { input: 1500, output: 350 }, max: { input: 2500, output: 700 } },
};

export function estimateSearchCost(businessCount: number): CostRange {
  const a = ASSUMPTIONS;
  const searchCalls = Math.ceil(businessCount / a.resultsPerSearchPage);
  const search = unitCostEur("GOOGLE_PLACES_SEARCH", "text_search");
  const details = unitCostEur("GOOGLE_PLACES_DETAILS", "place_details");
  const firecrawl = unitCostEur("FIRECRAWL", "scrape");

  const one = (side: "min" | "max") => {
    const sites = businessCount * a.withWebsiteRatio[side];
    const promising = sites * a.promisingRatio[side];
    const credits = promising * a.firecrawlCreditsPerSite[side];
    const aiCalls = businessCount * a.aiBriefRatio[side];
    const tokens = a.aiTokens[side];
    const ai = llmCostEur(tokens.input, tokens.output)[side] * aiCalls;
    return (
      searchCalls * search[side] +
      businessCount * details[side] +
      credits * firecrawl[side] +
      ai
    );
  };

  return { min: one("min"), max: one("max") };
}
