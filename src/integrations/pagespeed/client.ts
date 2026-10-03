const PAGESPEED_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export class PageSpeedApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PageSpeedApiError";
    this.status = status;
  }
}

export interface PageSpeedResult {
  performanceScore: number | null; // 0-100
  seoScore: number | null;
  accessibilityScore: number | null;
  coreWebVitals: {
    lcpMs: number | null; // Largest Contentful Paint
    cls: number | null; // Cumulative Layout Shift
    tbtMs: number | null; // Total Blocking Time (лабораторный proxy для INP)
  };
}

function scoreToPercent(score: number | undefined | null): number | null {
  if (score === undefined || score === null) return null;
  return Math.round(score * 100);
}

async function fetchWithRetry(url: string, opts: { timeoutMs?: number; retries?: number } = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 20000; // PageSpeed реально может отвечать медленно (реальный аудит страницы)
  const retries = opts.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.status >= 500 || res.status === 429) {
        lastError = new PageSpeedApiError(`HTTP ${res.status}`, res.status);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
          continue;
        }
        throw lastError;
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry failed");
}

export class PageSpeedClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async analyze(url: string, strategy: "mobile" | "desktop" = "mobile"): Promise<PageSpeedResult> {
    const params = new URLSearchParams({ url, key: this.apiKey, strategy });
    ["performance", "seo", "accessibility"].forEach((c) => params.append("category", c));

    const res = await fetchWithRetry(`${PAGESPEED_BASE}?${params.toString()}`);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PageSpeedApiError(`runPagespeed failed: ${res.status} ${body}`, res.status);
    }

    const data = (await res.json()) as any;
    const categories = data?.lighthouseResult?.categories ?? {};
    const audits = data?.lighthouseResult?.audits ?? {};

    return {
      performanceScore: scoreToPercent(categories.performance?.score),
      seoScore: scoreToPercent(categories.seo?.score),
      accessibilityScore: scoreToPercent(categories.accessibility?.score),
      coreWebVitals: {
        lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
        cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
        tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
      },
    };
  }
}
