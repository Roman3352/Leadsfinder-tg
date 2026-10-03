/**
 * Абстракция LLM-провайдера. Бизнес-логика (sales brief, outreach) знает только этот
 * интерфейс — поменять OpenAI на другого провайдера можно, не трогая остальной код.
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JsonRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>; // JSON Schema ответа
  maxOutputTokens?: number;
}

export interface JsonResponse<T> {
  data: T;
  usage: LLMUsage;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generateJson<T>(request: JsonRequest): Promise<JsonResponse<T>>;
}

export class LLMError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LLMError";
    this.status = status;
  }
}
