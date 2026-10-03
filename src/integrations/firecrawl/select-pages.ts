export type PageKind = "home" | "services" | "contact" | "about" | "other";

export interface SelectedPage {
  url: string;
  kind: PageKind;
}

const KEYWORDS: Record<Exclude<PageKind, "home" | "other">, RegExp> = {
  services: /leistung|service|angebot|preis/i,
  contact: /kontakt|contact|impressum/i,
  about: /ueber-uns|über-uns|about|team|unternehmen/i,
};

/**
 * Не сканируем весь сайт: берём homepage + максимум по одной странице на
 * каждую из категорий services/contact/about, только если такая страница
 * реально нашлась в /map. Итого максимум maxPages страниц на сайт.
 */
export function selectPagesToScrape(homepageUrl: string, mappedLinks: string[], maxPages = 4): SelectedPage[] {
  const selected: SelectedPage[] = [{ url: homepageUrl, kind: "home" }];
  const usedUrls = new Set([normalizeForCompare(homepageUrl)]);

  const categories: Exclude<PageKind, "home" | "other">[] = ["services", "contact", "about"];

  for (const kind of categories) {
    if (selected.length >= maxPages) break;
    const regex = KEYWORDS[kind];
    const match = mappedLinks.find((link) => regex.test(link) && !usedUrls.has(normalizeForCompare(link)));
    if (match) {
      selected.push({ url: match, kind });
      usedUrls.add(normalizeForCompare(match));
    }
  }

  return selected.slice(0, maxPages);
}

function normalizeForCompare(url: string): string {
  return url.replace(/\/$/, "").toLowerCase();
}
