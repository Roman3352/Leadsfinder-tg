const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

export class FirecrawlApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "FirecrawlApiError";
    this.status = status;
  }
}

export interface MapResult {
  links: string[];
}

export interface ScrapeResult {
  markdown: string;
  html: string;
  title: string | null;
  description: string | null;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const retries = opts.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (res.status >= 500 || res.status === 429) {
        lastError = new FirecrawlApiError(`HTTP ${res.status}`, res.status);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
          continue;
        }
        throw lastError;
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry failed");
}

export class FirecrawlClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * /map — дешёвая операция, просто возвращает список URL сайта, БЕЗ скачивания
   * содержимого. Используем это, чтобы найти реальные страницы services/contact/
   * about, вместо угадывания путей вслепую (и вместо дорогого полного crawl).
   */
  async mapSite(url: string, limit = 50): Promise<MapResult> {
    const res = await fetchWithRetry(`${FIRECRAWL_BASE}/map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ url, limit }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FirecrawlApiError(`map failed: ${res.status} ${body}`, res.status);
    }

    const data = (await res.json()) as { links?: string[] };
    return { links: data.links ?? [] };
  }

  /**
   * /scrape — одна страница. Просим markdown (компактно, удобно для будущего
   * LLM-этапа) и html (нужен только чтобы прогнать те же эвристики, что и в
   * quick check — не сохраняем сырой html, только извлечённые сигналы).
   */
  async scrapeUrl(url: string): Promise<ScrapeResult> {
    const res = await fetchWithRetry(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown", "html"] }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FirecrawlApiError(`scrape failed: ${res.status} ${body}`, res.status);
    }

    const data = (await res.json()) as {
      data?: { markdown?: string; html?: string; metadata?: { title?: string; description?: string } };
    };

    return {
      markdown: data.data?.markdown ?? "",
      html: data.data?.html ?? "",
      title: data.data?.metadata?.title ?? null,
      description: data.data?.metadata?.description ?? null,
    };
  }
}
