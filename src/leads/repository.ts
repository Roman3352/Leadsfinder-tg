import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { toLeadView, type CrmStatusName, type LeadView, type LeadFlags } from "./view.ts";

const LEAD_INCLUDE = {
  business: { include: { websiteAnalysis: true } },
  notes: true,
  outreachMessages: true,
};

export const FILTERS: { code: string; label: string; test: (f: LeadFlags) => boolean }[] = [
  { code: "nowebsite", label: "No website", test: (f) => f.noWebsite },
  { code: "website", label: "Website", test: (f) => f.hasWebsite },
  { code: "old", label: "Old website", test: (f) => f.oldWebsite },
  { code: "mobile", label: "Poor mobile", test: (f) => f.poorMobile },
  { code: "speed", label: "Poor PageSpeed", test: (f) => f.poorPageSpeed },
  { code: "nowa", label: "No WhatsApp", test: (f) => f.noWhatsapp },
  { code: "nobook", label: "No booking", test: (f) => f.noBooking },
  { code: "hot", label: "High Lead Score", test: (f) => f.highScore },
  { code: "insta", label: "Instagram", test: (f) => f.instagram },
  { code: "email", label: "Email", test: (f) => f.email },
  { code: "phone", label: "Phone", test: (f) => f.phone },
];

export const SORTS: { code: string; label: string; cmp: (a: LeadView, b: LeadView) => number }[] = [
  { code: "score", label: "Lead Score", cmp: (a, b) => b.score - a.score },
  { code: "reviews", label: "Reviews", cmp: (a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0) },
  { code: "rating", label: "Rating", cmp: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) },
  { code: "new", label: "Newest", cmp: (a, b) => b.createdAt.getTime() - a.createdAt.getTime() },
];

export async function loadLeadViews(db: PrismaClient = prisma): Promise<LeadView[]> {
  const rows = (await db.lead.findMany({ include: LEAD_INCLUDE })) as any[];
  return rows.map(toLeadView);
}

export async function loadLeadView(leadId: string, db: PrismaClient = prisma): Promise<LeadView | null> {
  const row = (await db.lead.findUnique({ where: { id: leadId }, include: LEAD_INCLUDE })) as any;
  return row ? toLeadView(row) : null;
}

export async function loadJobLeadViews(jobId: string, db: PrismaClient = prisma): Promise<LeadView[]> {
  const links = (await db.searchJobBusiness.findMany({ where: { searchJobId: jobId } })) as any[];
  const ids = new Set(links.map((l) => l.businessId));
  const all = await loadLeadViews(db);
  return all.filter((v) => ids.has(v.businessId));
}

export function applyFilters(views: LeadView[], filterCodes: string[]): LeadView[] {
  const active = FILTERS.filter((f) => filterCodes.includes(f.code));
  return views.filter((v) => active.every((f) => f.test(v.flags)));
}

export function sortViews(views: LeadView[], sortCode: string): LeadView[] {
  const sort = SORTS.find((s) => s.code === sortCode) ?? SORTS[0];
  return [...views].sort(sort.cmp);
}

export async function toggleFavorite(leadId: string, db: PrismaClient = prisma): Promise<boolean> {
  const lead = (await db.lead.findUniqueOrThrow({ where: { id: leadId } })) as any;
  const next = !lead.isFavorite;
  let crmStatus = lead.crmStatus;
  if (next && crmStatus === "NEW") crmStatus = "FAVORITE";
  if (!next && crmStatus === "FAVORITE") crmStatus = "NEW";
  await db.lead.update({ where: { id: leadId }, data: { isFavorite: next, crmStatus } });
  return next;
}

export async function setCrmStatus(leadId: string, status: CrmStatusName, db: PrismaClient = prisma): Promise<void> {
  const data: any = { crmStatus: status };
  if (status === "FAVORITE") data.isFavorite = true;
  if (status === "CONTACTED") data.lastContactAt = new Date();
  await db.lead.update({ where: { id: leadId }, data });
}

export async function addNote(leadId: string, text: string, db: PrismaClient = prisma): Promise<void> {
  await db.note.create({ data: { leadId, text: text.slice(0, 2000) } });
}

export async function setOfferedPrice(leadId: string, price: number | null, db: PrismaClient = prisma): Promise<void> {
  await db.lead.update({ where: { id: leadId }, data: { offeredPrice: price } });
}

export async function getOrCreateUser(telegramId: string, db: PrismaClient = prisma): Promise<any> {
  return db.user.upsert({ where: { telegramId }, update: {}, create: { telegramId, settings: {} } });
}

export async function getUserSetting(telegramId: string, key: string, db: PrismaClient = prisma): Promise<any> {
  const user = (await getOrCreateUser(telegramId, db)) as any;
  return (user.settings ?? {})[key];
}

export async function setUserSetting(telegramId: string, key: string, value: unknown, db: PrismaClient = prisma): Promise<void> {
  const user = (await getOrCreateUser(telegramId, db)) as any;
  await db.user.update({ where: { id: user.id }, data: { settings: { ...(user.settings ?? {}), [key]: value } } });
}

export interface DashboardStats {
  total: number;
  hot: number;
  favorites: number;
  byStatus: Record<string, number>;
}

export function computeDashboard(views: LeadView[]): DashboardStats {
  const byStatus: Record<string, number> = {};
  for (const v of views) byStatus[v.crmStatus] = (byStatus[v.crmStatus] ?? 0) + 1;
  return {
    total: views.length,
    hot: views.filter((v) => v.flags.highScore).length,
    favorites: views.filter((v) => v.isFavorite).length,
    byStatus,
  };
}
