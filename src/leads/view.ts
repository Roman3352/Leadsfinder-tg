import { settings } from "../config/env.ts";
import { socialHost } from "../website-analysis/social.ts";
import type { Opportunity, ScoreItem } from "../scoring/score.ts";

export const OPPORTUNITY_LABELS: Record<string, string> = {
  NO_WEBSITE: "🌐 New Website",
  LANDING_PAGE: "📄 Landing Page",
  REDESIGN: "💻 Website Redesign",
  MOBILE_REDESIGN: "📱 Mobile optimization",
  LOCAL_SEO: "📍 Local SEO",
  GOOGLE_BUSINESS_OPTIMIZATION: "🗺 Google Business optimization",
  WHATSAPP_INTEGRATION: "💬 WhatsApp integration",
  ONLINE_BOOKING: "📅 Online booking",
  PORTFOLIO_GALLERY: "🖼 Portfolio / Gallery",
  AI_CHATBOT: "🤖 AI chatbot",
  AUTOMATION: "⚙️ Automation",
  MAINTENANCE: "🔧 Maintenance",
};

export const CRM_STATUSES = [
  "NEW",
  "FAVORITE",
  "CONTACTED",
  "REPLIED",
  "NEGOTIATION",
  "CLIENT",
  "REFUSED",
  "NOT_RELEVANT",
] as const;
export type CrmStatusName = (typeof CRM_STATUSES)[number];

export interface LeadFlags {
  noWebsite: boolean;
  hasWebsite: boolean;
  oldWebsite: boolean;
  poorMobile: boolean;
  poorPageSpeed: boolean;
  noWhatsapp: boolean;
  noBooking: boolean;
  highScore: boolean;
  instagram: boolean;
  email: boolean;
  phone: boolean;
}

export interface LeadView {
  id: string;
  businessId: string;
  score: number;
  emoji: string;
  name: string;
  category: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  phone: string | null;
  email: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null; // только собственный сайт (не соцсеть)
  mapsUrl: string | null;
  websiteStatus: "NONE" | "SOCIAL_ONLY" | "UNVERIFIED" | "OK";
  items: ScoreItem[];
  problems: ScoreItem[];
  opportunities: Opportunity[];
  salesBrief: string | null;
  crmStatus: CrmStatusName;
  isFavorite: boolean;
  offeredPrice: number | null;
  lastContactAt: Date | null;
  notes: { text: string; createdAt: Date }[];
  latestOutreach: string | null;
  createdAt: Date;
  flags: LeadFlags;
}

export function scoreEmoji(score: number): string {
  if (score >= settings.hotScore()) return "🔥";
  if (score >= 50) return "👍";
  return "➖";
}

/** Собирает удобное для UI представление лида из строки БД (lead + business + анализ). */
export function toLeadView(row: any): LeadView {
  const b = row.business;
  const analysis = b.websiteAnalysis ?? null;
  const quick = (analysis?.quickCheckResult ?? null) as any;
  const deepPages = ((analysis?.deepAnalysisResult as any)?.pages ?? []) as any[];
  const pagespeed = (analysis?.pagespeedResult ?? null) as any;
  const breakdown = (row.scoreBreakdown ?? {}) as { items?: ScoreItem[]; websiteStatus?: LeadView["websiteStatus"] };

  const items = [...(breakdown.items ?? [])].sort((a, c) => c.points - a.points);
  const problems = items.filter((i) => i.kind === "problem");
  const websiteStatus = breakdown.websiteStatus ?? "OK";
  const social = socialHost(b.website);
  const websiteUrl = b.website && !social ? (b.website as string) : null;

  const pageSignals = [quick, ...deepPages].filter(Boolean);
  const firstOf = (key: string): string | null => pageSignals.map((p) => p[key]).find((v) => !!v) ?? null;
  const instagramUrl = firstOf("instagramUrl") ?? (social === "instagram.com" ? (b.website as string) : null);
  const email = firstOf("email");

  const hasCode = (code: string) => items.some((i) => i.code === code);
  const checked = !!quick && quick.reachable;
  const notes = ([...(row.notes ?? [])] as any[])
    .sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())
    .map((n) => ({ text: n.text as string, createdAt: new Date(n.createdAt) }));
  const outreach = ([...(row.outreachMessages ?? [])] as any[]).sort(
    (x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime()
  );

  const flags: LeadFlags = {
    noWebsite: websiteStatus === "NONE" || websiteStatus === "SOCIAL_ONLY",
    hasWebsite: !!websiteUrl,
    oldWebsite: hasCode("OUTDATED_SIGNS"),
    poorMobile: hasCode("NOT_MOBILE"),
    poorPageSpeed: hasCode("SLOW_PERF") && (pagespeed?.performanceScore ?? 100) < 75,
    noWhatsapp: checked && !pageSignals.some((p) => p.hasWhatsapp),
    noBooking: checked && !pageSignals.some((p) => p.hasBookingKeyword),
    highScore: row.score >= settings.hotScore(),
    instagram: !!instagramUrl,
    email: !!email,
    phone: !!b.phone,
  };

  return {
    id: row.id,
    businessId: row.businessId,
    score: row.score,
    emoji: scoreEmoji(row.score),
    name: b.name,
    category: b.category ?? null,
    city: b.city ?? null,
    rating: b.rating ?? null,
    reviewCount: b.reviewCount ?? null,
    phone: b.phone ?? null,
    email,
    instagramUrl,
    websiteUrl,
    mapsUrl: b.mapsUrl ?? null,
    websiteStatus,
    items,
    problems,
    opportunities: ((row.opportunities ?? []) as Opportunity[]) ?? [],
    salesBrief: row.salesBrief ?? null,
    crmStatus: row.crmStatus,
    isFavorite: !!row.isFavorite,
    offeredPrice: row.offeredPrice !== null && row.offeredPrice !== undefined ? Number(row.offeredPrice) : null,
    lastContactAt: row.lastContactAt ? new Date(row.lastContactAt) : null,
    notes,
    latestOutreach: outreach[0]?.messageText ?? null,
    createdAt: new Date(row.createdAt),
    flags,
  };
}

/** Проверенные наблюдения для outreach: без "не удалось проверить". */
export function verifiedFindings(view: LeadView): string[] {
  return view.problems
    .filter((p) => p.code !== "SITE_UNVERIFIED")
    .slice(0, 3)
    .map((p) => `${p.label}: ${p.evidence}`);
}
