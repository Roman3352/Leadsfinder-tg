import { InlineKeyboard } from "grammy";
import { CRM_STATUSES, type LeadView } from "../leads/view.ts";
import { FILTERS, SORTS } from "../leads/repository.ts";

export const NICHES = [
  "Fahrzeugaufbereitung",
  "Car Wrapping",
  "PPF",
  "Keramikversiegelung",
  "Autowerkstatt",
  "Autohaus",
  "Friseur",
  "Barber",
  "Beauty",
  "Fitnessstudio",
  "Handwerker",
  "Gebäudereinigung",
  "Immobilienmakler",
  "Fahrschule",
  "Restaurant",
] as const;

export const COUNT_OPTIONS = [20, 50, 100, 200] as const;
export const PAGE_SIZE = 6;
export const OTHER_NICHE = "__other";

const isHttp = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔎 Найти клиентов", "m:find")
    .row()
    .text("🏠 Dashboard", "m:dash")
    .text("📋 My Leads", "m:leads")
    .row()
    .text("⭐ Favorites", "m:favs")
    .text("⚙️ Settings", "m:set");
}

export function nicheKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  NICHES.forEach((niche, i) => {
    kb.text(niche, `niche:${niche}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("✏️ Другое", `niche:${OTHER_NICHE}`);
  return kb;
}

export function countKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  COUNT_OPTIONS.forEach((count) => kb.text(String(count), `cnt:${count}`));
  return kb;
}

export function leadCardKeyboard(v: LeadView): InlineKeyboard {
  const kb = new InlineKeyboard().text("🔍 OPEN", `ld:o:${v.id}`);
  if (isHttp(v.mapsUrl)) kb.url("📍 GOOGLE MAPS", v.mapsUrl);
  kb.row();
  if (isHttp(v.websiteUrl)) kb.url("🌐 WEBSITE", v.websiteUrl);
  kb.text(v.isFavorite ? "★ В избранном" : "⭐ FAVORITE", `ld:fav:${v.id}`).row();
  kb.text("💬 AI MESSAGE", `ld:msg:${v.id}`);
  return kb;
}

export function leadDetailsKeyboard(v: LeadView): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (isHttp(v.websiteUrl)) kb.url("🌐 Website", v.websiteUrl);
  if (isHttp(v.mapsUrl)) kb.url("📍 Google Maps", v.mapsUrl);
  if (isHttp(v.websiteUrl) || isHttp(v.mapsUrl)) kb.row();
  if (isHttp(v.instagramUrl)) kb.url("📸 Instagram", v.instagramUrl).row();
  kb.text(v.isFavorite ? "★ Убрать из избранного" : "⭐ Favorite", `ld:fav:${v.id}`)
    .text("💬 Generate message", `ld:msg:${v.id}`)
    .row();
  if (!v.salesBrief) kb.text("🧠 Sales Brief", `ld:brief:${v.id}`).row();
  kb.text(`📌 Статус: ${v.crmStatus}`, `ld:st:${v.id}`).row();
  kb.text("📝 Заметка", `ld:note:${v.id}`).text("💰 Цена", `ld:price:${v.id}`).row();
  kb.text("⬅️ К списку", "ls:p:0");
  return kb;
}

export function statusKeyboard(leadId: string, current: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  CRM_STATUSES.forEach((status, i) => {
    kb.text(status === current ? `• ${status}` : status, `ld:ss:${leadId}:${status}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("⬅️ Назад", `ld:d:${leadId}`);
  return kb;
}

export function messageKeyboard(leadId: string): InlineKeyboard {
  return new InlineKeyboard().text("🔄 Заново", `ld:msg:${leadId}:new`).text("⬅️ К лиду", `ld:d:${leadId}`);
}

export function listKeyboard(views: LeadView[], page: number, totalPages: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const v of views) {
    const label = `${v.emoji} ${v.score} · ${v.name}${v.city ? ` (${v.city})` : ""}`;
    kb.text(label.length > 48 ? `${label.slice(0, 47)}…` : label, `ld:d:${v.id}`).row();
  }
  if (totalPages > 1) {
    if (page > 0) kb.text("⬅️", `ls:p:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, `ls:p:${page}`);
    if (page < totalPages - 1) kb.text("➡️", `ls:p:${page + 1}`);
    kb.row();
  }
  kb.text("🔎 Фильтры", "ls:f").text("↕️ Сортировка", "ls:s").row();
  kb.text("🏠 Меню", "m:home");
  return kb;
}

export function filtersKeyboard(active: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  FILTERS.forEach((f, i) => {
    kb.text(`${active.includes(f.code) ? "✅ " : ""}${f.label}`, `ls:ft:${f.code}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("🧹 Сбросить", "ls:fc").text("✔️ Показать", "ls:p:0");
  return kb;
}

export function sortKeyboard(current: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  SORTS.forEach((s) => kb.text(`${s.code === current ? "• " : ""}${s.label}`, `ls:ss:${s.code}`));
  kb.row().text("⬅️ Назад", "ls:p:0");
  return kb;
}

export function jobDoneKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("📋 Открыть лиды", "m:leads").text("🏠 Меню", "m:home");
}

export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✏️ Имя для подписи сообщений", "set:name").row().text("🏠 Меню", "m:home");
}
