import type { QuickCheckResult } from "../website-analysis/quick-check.ts";
import type { HtmlSignals } from "../website-analysis/html-heuristics.ts";
import type { PageSpeedResult } from "../integrations/pagespeed/client.ts";
import { socialHost } from "../website-analysis/social.ts";

/**
 * Детерминированный Lead Score 0–100: "насколько этот бизнес интересен для МОЕЙ продажи"
 * (а не "насколько плох бизнес"). LLM в расчёте score не участвует.
 *
 * Две части:
 *  1) ценность бизнеса (до 30) — насколько это живой бизнес, который способен платить;
 *  2) возможность продажи (до 75) — что реально видно по данным: нет сайта / проблемы сайта.
 * Сумма ограничивается 100. Если данных нет (например, PageSpeed не запускался) —
 * баллы за этот признак не начисляются и ничего не выдумывается.
 * Все веса — в WEIGHTS, чтобы их можно было подкрутить в одном месте.
 */
export const WEIGHTS = {
  noWebsite: 55,
  siteUnverified: 10,
  noHttps: 8,
  notMobile: 15,
  noCta: 10,
  noQuickContact: 4,
  noPortfolio: 4,
  noSiteReviews: 3,
  seoBasicsMany: 6,
  seoBasicsOne: 3,
  perfPoor: 12,
  perfMedium: 7,
  perfSlight: 3,
  seoScorePoor: 4,
  weakConversion: 4,
  outdatedSigns: 5,
  valueReviews: [
    { min: 100, points: 15 },
    { min: 40, points: 11 },
    { min: 15, points: 7 },
    { min: 5, points: 3 },
  ],
  valueRating: [
    { min: 4.7, points: 8 },
    { min: 4.3, points: 6 },
    { min: 4.0, points: 3 },
  ],
  valuePhone: 4,
  valueHours: 3,
};

export type OpportunityCode =
  | "NO_WEBSITE"
  | "LANDING_PAGE"
  | "REDESIGN"
  | "MOBILE_REDESIGN"
  | "LOCAL_SEO"
  | "GOOGLE_BUSINESS_OPTIMIZATION"
  | "WHATSAPP_INTEGRATION"
  | "ONLINE_BOOKING"
  | "PORTFOLIO_GALLERY"
  | "AI_CHATBOT"
  | "AUTOMATION"
  | "MAINTENANCE";
// MULTILINGUAL_WEBSITE намеренно не выдаётся: по имеющимся данным его нельзя обосновать.

export interface ScoreItem {
  code: string;
  kind: "value" | "problem";
  points: number;
  label: string;
  evidence: string;
}

export interface Opportunity {
  code: OpportunityCode;
  reason: string;
}

export type WebsiteStatus = "NONE" | "SOCIAL_ONLY" | "UNVERIFIED" | "OK";

export interface ScoreResult {
  score: number;
  rawTotal: number;
  items: ScoreItem[];
  opportunities: Opportunity[];
  websiteStatus: WebsiteStatus;
  data: { quickCheck: boolean; deep: boolean; pagespeed: boolean };
}

export interface ScoringInput {
  niche: string | null;
  business: {
    name: string;
    rating: number | null;
    reviewCount: number | null;
    phone: string | null;
    website: string | null;
    hasOpeningHours: boolean;
  };
  quickCheck: QuickCheckResult | null;
  deepPages: HtmlSignals[];
  pagespeed: PageSpeedResult | null;
}

const BOOKING_NICHES = [
  "fahrzeugaufbereitung",
  "car wrapping",
  "ppf",
  "keramikversiegelung",
  "autowerkstatt",
  "friseur",
  "barber",
  "beauty",
  "fitnessstudio",
  "fahrschule",
  "restaurant",
];
const VISUAL_NICHES = [
  "fahrzeugaufbereitung",
  "car wrapping",
  "ppf",
  "keramikversiegelung",
  "friseur",
  "barber",
  "beauty",
  "handwerker",
  "gebäudereinigung",
  "autohaus",
];

const inNiche = (niche: string | null, list: string[]) => !!niche && list.includes(niche.trim().toLowerCase());

export function computeLeadScore(input: ScoringInput): ScoreResult {
  const items: ScoreItem[] = [];
  const opportunities: Opportunity[] = [];
  const add = (code: string, kind: ScoreItem["kind"], points: number, label: string, evidence: string) =>
    items.push({ code, kind, points, label, evidence });
  const opp = (code: OpportunityCode, reason: string) => opportunities.push({ code, reason });

  const b = input.business;
  const reviews = b.reviewCount ?? 0;
  const niche = input.niche;

  // --- 1) ценность бизнеса ---
  const reviewTier = WEIGHTS.valueReviews.find((t) => reviews >= t.min);
  if (reviewTier) add("REVIEWS", "value", reviewTier.points, `Живой бизнес: ${reviews} отзывов`, `Google: ${reviews} отзывов`);
  const ratingTier = b.rating !== null ? WEIGHTS.valueRating.find((t) => (b.rating as number) >= t.min) : undefined;
  if (ratingTier) add("RATING", "value", ratingTier.points, `Хороший рейтинг ${b.rating}`, `Google: рейтинг ${b.rating}`);
  if (b.phone) add("PHONE", "value", WEIGHTS.valuePhone, "Есть телефон для контакта", b.phone);
  if (b.hasOpeningHours) add("HOURS", "value", WEIGHTS.valueHours, "Указаны часы работы (бизнес активен)", "Google: часы работы заполнены");

  // --- 2) возможность продажи ---
  const social = socialHost(b.website);
  const hasOwnSite = !!b.website && !social;
  let websiteStatus: WebsiteStatus = "OK";
  const qc = input.quickCheck;
  const data = { quickCheck: !!qc, deep: input.deepPages.length > 0, pagespeed: !!input.pagespeed };

  if (!hasOwnSite) {
    websiteStatus = social ? "SOCIAL_ONLY" : "NONE";
    add(
      "NO_WEBSITE",
      "problem",
      WEIGHTS.noWebsite,
      "Нет собственного сайта",
      social ? `В Google указана только страница соцсети (${social})` : "В Google Maps сайт не указан"
    );
    opp("NO_WEBSITE", "У бизнеса нет собственного сайта — нужен новый сайт.");
    opp("LANDING_PAGE", "Быстрый вход: одностраничный сайт с контактами, услугами и кнопкой связи.");
  } else if (!qc) {
    websiteStatus = "UNVERIFIED";
  } else if (!qc.reachable) {
    websiteStatus = "UNVERIFIED";
    add(
      "SITE_UNVERIFIED",
      "problem",
      WEIGHTS.siteUnverified,
      "Сайт не удалось проверить",
      `Не загрузился (${qc.error ?? "ошибка"}) — проверьте вручную, возможно сайт недоступен`
    );
  } else {
    const pages: HtmlSignals[] = [qc, ...input.deepPages];
    const any = (key: keyof HtmlSignals) => pages.some((p) => !!p[key]);

    if (!qc.https) add("NO_HTTPS", "problem", WEIGHTS.noHttps, "Сайт без HTTPS", "Адрес открывается без защищённого соединения");
    if (!qc.mobileFriendly)
      add("NOT_MOBILE", "problem", WEIGHTS.notMobile, "Нет мобильной адаптации", "В коде страницы нет viewport meta");
    if (!any("hasClearCta"))
      add("NO_CTA", "problem", WEIGHTS.noCta, "Нет понятного призыва к действию", "Нет ни телефона-ссылки, ни WhatsApp, ни формы, ни записи");
    if (!any("hasPhoneLink") && !any("hasWhatsapp"))
      add("NO_QUICK_CONTACT", "problem", WEIGHTS.noQuickContact, "Нет быстрой связи (звонок/WhatsApp в один тап)", "Нет tel:-ссылки и WhatsApp-ссылки");
    if (inNiche(niche, VISUAL_NICHES) && !any("hasPortfolioKeyword"))
      add("NO_PORTFOLIO", "problem", WEIGHTS.noPortfolio, "Нет портфолио/галереи", "На проверенных страницах нет раздела с работами");
    if (reviews >= 15 && !any("hasReviewsKeyword"))
      add("NO_SITE_REVIEWS", "problem", WEIGHTS.noSiteReviews, "Отзывы не показаны на сайте", `В Google ${reviews} отзывов, на сайте они не найдены`);

    const missingSeo = [!qc.title, !qc.metaDescription, !qc.h1].filter(Boolean).length;
    if (missingSeo >= 2)
      add("POOR_SEO_BASICS", "problem", WEIGHTS.seoBasicsMany, "Слабая базовая SEO-разметка", "Не хватает title / meta description / H1");
    else if (missingSeo === 1)
      add("POOR_SEO_BASICS", "problem", WEIGHTS.seoBasicsOne, "Неполная SEO-разметка", "Не хватает одного из: title / meta description / H1");

    if (!any("hasContactForm") && !any("hasBookingKeyword"))
      add("WEAK_CONVERSION", "problem", WEIGHTS.weakConversion, "Слабый путь клиента к заявке", "Нет формы обратной связи и онлайн-записи");
    if (!qc.mobileFriendly && !qc.https)
      add("OUTDATED_SIGNS", "problem", WEIGHTS.outdatedSigns, "Признаки устаревшего сайта", "Нет HTTPS и нет адаптации под мобильные");

    const ps = input.pagespeed;
    if (ps?.performanceScore !== null && ps?.performanceScore !== undefined) {
      const perf = ps.performanceScore;
      if (perf < 50) add("SLOW_PERF", "problem", WEIGHTS.perfPoor, "Сайт медленно загружается", `PageSpeed (mobile): ${perf}/100`);
      else if (perf < 75) add("SLOW_PERF", "problem", WEIGHTS.perfMedium, "Скорость сайта ниже среднего", `PageSpeed (mobile): ${perf}/100`);
      else if (perf < 90) add("SLOW_PERF", "problem", WEIGHTS.perfSlight, "Есть резерв по скорости", `PageSpeed (mobile): ${perf}/100`);
    }
    if (ps?.seoScore !== null && ps?.seoScore !== undefined && ps.seoScore < 70)
      add("POOR_SEO_SCORE", "problem", WEIGHTS.seoScorePoor, "Низкий SEO-балл", `PageSpeed SEO: ${ps.seoScore}/100`);
  }

  // --- возможности продажи (только с основанием в данных) ---
  const has = (code: string) => items.some((i) => i.code === code);
  const checked = hasOwnSite && !!qc && qc.reachable;
  const anyPage = (key: keyof HtmlSignals) => !!qc && [qc, ...input.deepPages].some((p) => !!p[key]);
  const perfPoor = input.pagespeed?.performanceScore !== null && input.pagespeed?.performanceScore !== undefined && input.pagespeed.performanceScore < 50;

  if (checked) {
    const redesignSignals = [has("NOT_MOBILE"), has("OUTDATED_SIGNS"), perfPoor, has("NO_HTTPS")].filter(Boolean).length;
    if (redesignSignals >= 2) opp("REDESIGN", "Сразу несколько технических проблем сайта — оправдан редизайн.");
    else if (has("NOT_MOBILE")) opp("MOBILE_REDESIGN", "Сайт не адаптирован под телефоны — нужна мобильная версия.");

    if (has("POOR_SEO_BASICS") || has("POOR_SEO_SCORE"))
      opp("LOCAL_SEO", "Слабая SEO-разметка / низкий SEO-балл — можно улучшить локальную видимость.");
    if (!anyPage("hasWhatsapp")) opp("WHATSAPP_INTEGRATION", "На сайте нет кнопки WhatsApp.");
    if (inNiche(niche, BOOKING_NICHES) && !anyPage("hasBookingKeyword"))
      opp("ONLINE_BOOKING", "Ниша работает по записи, а на сайте не видно онлайн-записи.");
    if (inNiche(niche, VISUAL_NICHES) && !anyPage("hasPortfolioKeyword"))
      opp("PORTFOLIO_GALLERY", "Ниша визуальная, а раздела с работами на сайте не найдено.");
    if (reviews >= 50 && !anyPage("hasContactForm") && !anyPage("hasBookingKeyword"))
      opp("AI_CHATBOT", `Много отзывов (${reviews}) — вероятно много обращений, а на сайте нет формы/записи: чат-бот принимал бы заявки.`);
    if (inNiche(niche, BOOKING_NICHES) && reviews >= 30 && !anyPage("hasBookingKeyword") && !anyPage("hasContactForm"))
      opp("AUTOMATION", "Клиентов много, а запись и заявки, судя по сайту, идут вручную — можно автоматизировать.");
    if ((has("NO_HTTPS") || !qc!.title || !qc!.metaDescription) && !opportunities.some((o) => o.code === "REDESIGN"))
      opp("MAINTENANCE", "Сайт выглядит без технической поддержки (HTTPS/разметка).");
  }

  if (!hasOwnSite && inNiche(niche, BOOKING_NICHES) && reviews >= 30)
    opp("AUTOMATION", "Клиентов много (по отзывам), а онлайн-записи без сайта нет — можно автоматизировать заявки.");

  // Google-профиль актуален независимо от наличия сайта
  if (b.rating === null)
    opp("GOOGLE_BUSINESS_OPTIMIZATION", "В Google у бизнеса нет рейтинга/отзывов — профиль можно развивать.");
  else if (b.rating < 4.3 || reviews < 15)
    opp("GOOGLE_BUSINESS_OPTIMIZATION", `Профиль в Google можно усилить (рейтинг ${b.rating}, отзывов ${reviews}).`);
  else if (!b.hasOpeningHours) opp("GOOGLE_BUSINESS_OPTIMIZATION", "В Google-профиле не заполнены часы работы.");

  const rawTotal = items.reduce((sum, i) => sum + i.points, 0);
  return {
    score: Math.max(0, Math.min(100, rawTotal)),
    rawTotal,
    items,
    opportunities,
    websiteStatus,
    data,
  };
}
