import { OPPORTUNITY_LABELS, type LeadView } from "../leads/view.ts";
import type { DashboardStats } from "../leads/repository.ts";
import { FILTERS, SORTS } from "../leads/repository.ts";
import type { JobProgress, JobSummary } from "../jobs/run-search-job.ts";
import { formatRange } from "../config/pricing.ts";
import { settings } from "../config/env.ts";

export const TELEGRAM_LIMIT = 4000;

export function truncate(text: string, max = TELEGRAM_LIMIT): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const stars = (v: LeadView) => (v.rating !== null ? `⭐ ${v.rating} (${v.reviewCount ?? 0} reviews)` : "⭐ нет рейтинга в Google");

function websiteLine(v: LeadView): string {
  switch (v.websiteStatus) {
    case "NONE":
      return "🌐 Website: нет — NO WEBSITE";
    case "SOCIAL_ONLY":
      return "🌐 Website: нет (только соцсеть) — NO WEBSITE";
    case "UNVERIFIED":
      return "🌐 Website: есть, но не удалось проверить";
    default:
      return "🌐 Website: есть";
  }
}

export function renderLeadCard(v: LeadView): string {
  const lines = [
    `${v.emoji} ${v.score}/100`,
    "",
    v.name,
    ...(v.category ? [v.category] : []),
    ...(v.city ? [`📍 ${v.city}`] : []),
    stars(v),
    websiteLine(v),
  ];

  if (v.problems.length > 0) {
    lines.push("", "Problems:", ...v.problems.slice(0, 4).map((p) => `⚠️ ${p.label}`));
  }
  if (v.opportunities.length > 0) {
    lines.push("", "Potential services:", ...v.opportunities.slice(0, 3).map((o) => OPPORTUNITY_LABELS[o.code] ?? o.code));
  }
  return truncate(lines.join("\n"));
}

export function renderLeadDetails(v: LeadView): string {
  const money = v.offeredPrice !== null ? `${v.offeredPrice}` : null;
  const lines = [
    `${v.emoji} ${v.score}/100 — ${v.name}`,
    [v.category, v.city].filter(Boolean).join(" · "),
    "",
    stars(v),
    websiteLine(v),
    ...(v.websiteUrl ? [`   ${v.websiteUrl}`] : []),
    ...(v.phone ? [`📞 ${v.phone}`] : []),
    ...(v.email ? [`📧 ${v.email}`] : []),
    ...(v.instagramUrl ? [`📸 ${v.instagramUrl}`] : []),
    "",
    `📌 CRM: ${v.crmStatus}${v.isFavorite ? " ⭐" : ""}${money ? ` · цена: ${money}` : ""}`,
    ...(v.lastContactAt ? [`Последний контакт: ${v.lastContactAt.toISOString().slice(0, 10)}`] : []),
    "",
    "Почему такой score:",
    ...v.items.map((i) => `+${i.points} ${i.label} — ${i.evidence}`),
  ];

  if (v.opportunities.length > 0) {
    lines.push("", "Recommended services:", ...v.opportunities.map((o) => `${OPPORTUNITY_LABELS[o.code] ?? o.code} — ${o.reason}`));
  }
  if (v.salesBrief) lines.push("", "— SALES BRIEF —", v.salesBrief);
  if (v.notes.length > 0) lines.push("", "Заметки:", ...v.notes.slice(0, 3).map((n) => `• ${n.text}`));
  if (v.latestOutreach) lines.push("", "Последнее сообщение — кнопка 💬 покажет его заново или создаст новое.");

  return truncate(lines.join("\n"));
}

export function renderListHeader(total: number, shown: number, view: "all" | "fav", filters: string[], sort: string): string {
  const filterNames = FILTERS.filter((f) => filters.includes(f.code)).map((f) => f.label);
  const sortName = SORTS.find((s) => s.code === sort)?.label ?? "Lead Score";
  return [
    view === "fav" ? `⭐ Favorites (${shown})` : `📋 My Leads (${shown} из ${total})`,
    `Фильтры: ${filterNames.length > 0 ? filterNames.join(", ") : "нет"}`,
    `Сортировка: ${sortName}`,
    shown === 0 ? "\nПока пусто. Запустите поиск: 🔎 Найти клиентов" : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function renderProgress(p: JobProgress | { phase: "start" }, niche: string, location: string): string {
  const head = `🔎 ${niche} · ${location}`;
  if (p.phase === "start" || p.phase === "search") return `${head}\n\nFinding businesses...`;
  if (p.phase === "analysis") {
    const c = p.counters;
    const lines = [
      head,
      "",
      "Finding businesses... ✅",
      `Found: ${p.found}`,
      "",
      `Analyzing websites: ${c.processed}/${c.total}`,
      `With website: ${c.withWebsite}`,
      `Without website: ${c.withoutWebsite}`,
      `Potential leads (promising): ${c.promising}`,
      `Analyzed: ${c.analyzed}`,
    ];
    if (c.errors > 0) lines.push(`Сайт не открылся: ${c.errors}`);
    if (c.failed > 0) lines.push(`Ошибки обработки: ${c.failed}`);
    return lines.join("\n");
  }
  if (p.phase === "scoring") return `${head}\n\nСчитаю Lead Score...`;
  return `${head}\n\nAI Sales Brief: ${p.done}/${p.total}`;
}

export function renderSummary(s: JobSummary): string {
  if (s.status === "FAILED") {
    return `❌ Поиск завершился с ошибкой\n\n${s.error ?? "неизвестная ошибка"}\n\nЛимиты не превышены, повторите позже. Если ошибка повторяется — проверьте ключи в .env.`;
  }
  const lines = [
    s.status === "DONE" ? "✅ Analysis finished" : "⚠️ Analysis finished (остановлено по лимиту)",
    "",
    `${s.found} businesses found`,
    `${s.withWebsite} websites`,
    `${s.withoutWebsite} without websites`,
    `${s.promising} promising sites (deep analysis)`,
    `${s.leadsCreated} leads scored`,
    "",
    `🔥 ${s.hotLeads} leads with score ${settings.hotScore()}+`,
  ];
  if (s.aiBriefs > 0) lines.push(`🧠 AI Sales Brief: ${s.aiBriefs}`);
  if (s.limitsHit.length > 0) lines.push("", `Достигнут лимит: ${s.limitsHit.join(", ")}`, "Часть данных собрана не полностью. Лимиты меняются в .env.");
  if (s.costMax > 0) lines.push("", `Расход (оценка): ${formatRange({ min: s.costMin, max: s.costMax })}`);
  return lines.join("\n");
}

export function renderDashboard(
  stats: DashboardStats,
  spend: { min: number; max: number },
  budgetEur: number,
  runningJob: boolean
): string {
  const st = stats.byStatus;
  return [
    "🏠 Dashboard",
    "",
    `Лидов всего: ${stats.total}`,
    `🔥 Горячих (${settings.hotScore()}+): ${stats.hot}`,
    `⭐ В избранном: ${stats.favorites}`,
    "",
    "CRM:",
    `NEW ${st.NEW ?? 0} · CONTACTED ${st.CONTACTED ?? 0} · REPLIED ${st.REPLIED ?? 0}`,
    `NEGOTIATION ${st.NEGOTIATION ?? 0} · CLIENT ${st.CLIENT ?? 0}`,
    `REFUSED ${st.REFUSED ?? 0} · NOT_RELEVANT ${st.NOT_RELEVANT ?? 0}`,
    "",
    `Расход API в этом месяце (оценка): ${formatRange(spend)} из бюджета €${budgetEur}`,
    ...(runningJob ? ["", "⏳ Сейчас идёт поиск"] : []),
  ].join("\n");
}
