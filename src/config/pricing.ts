import { envNumber } from "./env.ts";

/**
 * Ставки провайдеров вынесены в конфиг (.env), а не зашиты в код: цены меняются,
 * а стоимость Google зависит от SKU и набора полей (FieldMask).
 * Значения по умолчанию — ПРИМЕРНЫЕ, их нужно сверять с актуальными прайсами.
 * "min" учитывает бесплатные месячные лимиты (для Google это 0), "max" — худший случай.
 * Все итоговые суммы считаются в EUR (курс — EUR_PER_USD, тоже приблизительный).
 */
export interface CostRange {
  min: number;
  max: number;
}

function eurPerUsd(): number {
  return envNumber("EUR_PER_USD", 0.9);
}

export function unitCostEur(provider: string, requestType: string): CostRange {
  const k = eurPerUsd();
  switch (provider) {
    case "GOOGLE_PLACES_SEARCH":
      return {
        min: (envNumber("GOOGLE_TEXT_SEARCH_USD_PER_1000_MIN", 0) / 1000) * k,
        max: (envNumber("GOOGLE_TEXT_SEARCH_USD_PER_1000_MAX", 35) / 1000) * k,
      };
    case "GOOGLE_PLACES_DETAILS":
      return {
        min: (envNumber("GOOGLE_DETAILS_USD_PER_1000_MIN", 0) / 1000) * k,
        max: (envNumber("GOOGLE_DETAILS_USD_PER_1000_MAX", 20) / 1000) * k,
      };
    case "FIRECRAWL":
      return {
        min: envNumber("FIRECRAWL_USD_PER_CREDIT_MIN", 0.0008) * k,
        max: envNumber("FIRECRAWL_USD_PER_CREDIT_MAX", 0.003) * k,
      };
    default:
      return { min: 0, max: 0 }; // PageSpeed бесплатный; OpenAI считается по токенам (llmCostEur)
  }
}

export function llmCostEur(inputTokens: number, outputTokens: number): CostRange {
  const k = eurPerUsd();
  const inRate = envNumber("OPENAI_INPUT_USD_PER_1M", 0.15);
  const outRate = envNumber("OPENAI_OUTPUT_USD_PER_1M", 0.6);
  const cost = ((inputTokens * inRate + outputTokens * outRate) / 1_000_000) * k;
  return { min: cost, max: cost };
}

export function formatEur(value: number): string {
  if (value < 0.01) return "€0";
  return `€${value.toFixed(2)}`;
}

export function formatRange(range: CostRange): string {
  return `~${formatEur(range.min)}–${formatEur(range.max)}`;
}
