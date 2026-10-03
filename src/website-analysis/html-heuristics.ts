export interface HtmlSignals {
  mobileFriendly: boolean;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  hasPhoneLink: boolean;
  hasWhatsapp: boolean;
  hasContactForm: boolean;
  hasBookingKeyword: boolean;
  hasPortfolioKeyword: boolean;
  hasReviewsKeyword: boolean;
  hasPricesKeyword: boolean;
  hasClearCta: boolean;
  email: string | null;
  instagramUrl: string | null;
}

function extract(regex: RegExp, html: string): string | null {
  const m = html.match(regex);
  return m?.[1]?.trim() || null;
}

function test(regex: RegExp, html: string): boolean {
  return regex.test(html);
}

/**
 * Разбор HTML нарочно простой (regex, без DOM-парсера/headless browser) —
 * используется и в quick check (1 страница), и в deep analysis (до 4 страниц).
 */
export function analyzeHtml(html: string): HtmlSignals {
  const title = extract(/<title[^>]*>([^<]*)<\/title>/i, html);
  const metaDescription =
    extract(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ??
    extract(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, html);
  const h1 = extract(/<h1[^>]*>([^<]*)<\/h1>/i, html);

  const mobileFriendly = test(/<meta[^>]+name=["']viewport["']/i, html);
  const hasPhoneLink = test(/href=["']tel:/i, html);
  const hasWhatsapp = test(/wa\.me\/|api\.whatsapp\.com/i, html);
  const hasContactForm = test(/<form[\s\S]*?<\/form>/i, html);
  const hasBookingKeyword = test(/termin|buchen|book\s*now|reservier|appointment/i, html);
  const hasPortfolioKeyword = test(/portfolio|galerie|gallery|referenzen/i, html);
  const hasReviewsKeyword = test(/bewertung|testimonial|review/i, html);
  const hasPricesKeyword = test(/preis(e)?\b|price(s)?\b|ab\s?\d+\s?€|€\s?\d/i, html);

  const hasClearCta = hasPhoneLink || hasWhatsapp || hasContactForm || hasBookingKeyword;

  const email = extract(/href=["']mailto:([^"'?\s>]+)/i, html);
  const instagramMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?/i);
  const blockedHandles = ["p", "reel", "reels", "explore", "sharer", "accounts", "stories"];
  const instagramUrl =
    instagramMatch && !blockedHandles.includes(instagramMatch[1].toLowerCase())
      ? `https://instagram.com/${instagramMatch[1]}`
      : null;

  return {
    mobileFriendly,
    title,
    metaDescription,
    h1,
    hasPhoneLink,
    hasWhatsapp,
    hasContactForm,
    hasBookingKeyword,
    hasPortfolioKeyword,
    hasReviewsKeyword,
    hasPricesKeyword,
    hasClearCta,
    email,
    instagramUrl,
  };
}

export const EMPTY_HTML_SIGNALS: HtmlSignals = {
  mobileFriendly: false,
  title: null,
  metaDescription: null,
  h1: null,
  hasPhoneLink: false,
  hasWhatsapp: false,
  hasContactForm: false,
  hasBookingKeyword: false,
  hasPortfolioKeyword: false,
  hasReviewsKeyword: false,
  hasPricesKeyword: false,
  hasClearCta: false,
  email: null,
  instagramUrl: null,
};
