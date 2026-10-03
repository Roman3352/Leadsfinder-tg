import { analyzeHtml, EMPTY_HTML_SIGNALS, type HtmlSignals } from "./html-heuristics.ts";

export interface QuickCheckResult extends HtmlSignals {
  reachable: boolean;
  https: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Один fetch домашней страницы + regex-эвристики (html-heuristics.ts) — это
 * ровно "cheap quick check": без headless browser и без Firecrawl. Firecrawl /
 * глубокий crawl (deep-analysis.ts) — следующий этап, только для сайтов,
 * которые после этого quick check выглядят перспективными.
 */
export async function runQuickCheck(url: string, timeoutMs = 6000): Promise<QuickCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadFinderBot/1.0)" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        reachable: false,
        https: res.url.startsWith("https://"),
        statusCode: res.status,
        ...EMPTY_HTML_SIGNALS,
        error: `HTTP ${res.status}`,
      };
    }

    const html = await res.text();
    const parsed = analyzeHtml(html);

    return {
      reachable: true,
      https: res.url.startsWith("https://"),
      statusCode: res.status,
      ...parsed,
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      reachable: false,
      https: false,
      ...EMPTY_HTML_SIGNALS,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
