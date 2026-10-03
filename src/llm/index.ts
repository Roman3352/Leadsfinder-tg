import { envString } from "../config/env.ts";
import type { LLMProvider } from "./provider.ts";
import { OpenAIProvider } from "./openai.ts";

/**
 * Возвращает провайдера или null, если AI не настроен (тогда бот работает без AI-функций).
 * Модель задаётся ТОЛЬКО через DEFAULT_LLM_MODEL — в коде она не зашита.
 */
export function createLLMProvider(): LLMProvider | null {
  const providerName = envString("LLM_PROVIDER") ?? "openai";

  if (providerName === "openai") {
    const apiKey = envString("OPENAI_API_KEY");
    if (!apiKey) return null;
    const model = envString("DEFAULT_LLM_MODEL");
    if (!model) throw new Error("DEFAULT_LLM_MODEL не задан в .env (например: gpt-4o-mini)");
    return new OpenAIProvider(apiKey, model);
  }

  throw new Error(`Неизвестный LLM_PROVIDER: ${providerName}`);
}
