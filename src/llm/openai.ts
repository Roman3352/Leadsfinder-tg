import { LLMError, type JsonRequest, type JsonResponse, type LLMProvider } from "./provider.ts";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateJson<T>(request: JsonRequest): Promise<JsonResponse<T>> {
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schemaName, strict: true, schema: request.schema },
      },
      max_completion_tokens: request.maxOutputTokens ?? Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 700),
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= 1; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 40000);
      try {
        const res = await fetch(OPENAI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.status === 429 || res.status >= 500) {
          lastError = new LLMError(`OpenAI HTTP ${res.status}`, res.status);
          if (attempt < 1) {
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          throw lastError;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new LLMError(`OpenAI HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
        }

        const json = (await res.json()) as any;
        const choice = json?.choices?.[0];
        if (choice?.message?.refusal) throw new LLMError("Модель отказалась отвечать");
        if (choice?.finish_reason === "length") throw new LLMError("Ответ модели обрезан (увеличьте LLM_MAX_OUTPUT_TOKENS)");

        const content: string | undefined = choice?.message?.content;
        if (!content) throw new LLMError("Пустой ответ модели");

        let data: T;
        try {
          data = JSON.parse(content) as T;
        } catch {
          throw new LLMError("Модель вернула невалидный JSON");
        }

        return {
          data,
          model: json.model ?? this.model,
          usage: {
            inputTokens: json.usage?.prompt_tokens ?? 0,
            outputTokens: json.usage?.completion_tokens ?? 0,
          },
        };
      } catch (err) {
        clearTimeout(timeout);
        lastError = err;
        if (err instanceof LLMError && err.status !== undefined && err.status < 500 && err.status !== 429) throw err;
        if (err instanceof LLMError && err.status === undefined) throw err; // ошибки разбора — без повторов
        if (attempt >= 1) break;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    throw lastError instanceof Error ? lastError : new LLMError("LLM request failed");
  }
}
