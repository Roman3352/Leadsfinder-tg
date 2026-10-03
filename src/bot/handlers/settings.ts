import type { BotContext } from "../session.ts";
import { mainMenuKeyboard, settingsKeyboard, COUNT_OPTIONS } from "../keyboards.ts";
import { renderDashboard, truncate } from "../render.ts";
import { getServices } from "../services.ts";
import { answer, showOrEdit } from "../util.ts";
import { computeDashboard, getOrCreateUser, getUserSetting, loadLeadViews, setUserSetting } from "../../leads/repository.ts";
import { getMonthlySpend } from "../../jobs/budget.ts";
import { settings } from "../../config/env.ts";
import { estimateSearchCost } from "../../cost/estimate.ts";
import { formatRange } from "../../config/pricing.ts";

export async function showHome(ctx: BotContext): Promise<void> {
  await answer(ctx);
  ctx.session.step = "idle";
  await ctx.reply("👋 AI Lead Finder\n\nВыберите действие:", { reply_markup: mainMenuKeyboard() });
}

export async function showDashboard(ctx: BotContext): Promise<void> {
  await answer(ctx);
  const { db } = getServices();
  const user = await getOrCreateUser(String(ctx.from!.id), db);
  const [views, spend, running] = await Promise.all([
    loadLeadViews(db),
    getMonthlySpend(db),
    db.searchJob.findFirst({ where: { userId: user.id, status: "RUNNING" } }),
  ]);
  await ctx.reply(renderDashboard(computeDashboard(views), spend, settings.maxMonthlyBudgetEur(), !!running), {
    reply_markup: mainMenuKeyboard(),
  });
}

export async function showSettings(ctx: BotContext): Promise<void> {
  await answer(ctx);
  const services = getServices();
  const spend = await getMonthlySpend(services.db);
  const limits = settings.jobLimits();
  const sender = await getUserSetting(String(ctx.from!.id), "senderName", services.db);
  const mark = (ok: boolean) => (ok ? "✅" : "❌");

  const lines = [
    "⚙️ Settings",
    "",
    `Ключи: Google ${mark(!!services.keys.google)} · Firecrawl ${mark(!!services.keys.firecrawl)} · PageSpeed ${mark(!!services.keys.pagespeed)} · AI ${mark(!!services.llm)}${services.llm ? ` (${services.llm.model})` : ""}`,
    "",
    "Лимиты на один поиск:",
    `Google ${limits.maxGoogleRequests} · Firecrawl ${limits.maxFirecrawlCredits} · PageSpeed ${limits.maxPagespeedRequests} · AI ${limits.maxAiCalls}`,
    `Месячный бюджет: €${settings.maxMonthlyBudgetEur()} · потрачено (оценка): ${formatRange(spend)}`,
    `AI Sales Brief — для лидов со score ≥ ${settings.aiMinScore()}; горячие — ${settings.hotScore()}+`,
    "",
    "Оценка стоимости поиска (диапазон, не точная сумма):",
    ...COUNT_OPTIONS.map((n) => `${n} компаний → ${formatRange(estimateSearchCost(n))}`),
    "Оценка зависит от тарифов Google (SKU/поля) и бесплатных лимитов; факт расходов записывается в базу.",
    "",
    `Подпись в сообщениях: ${typeof sender === "string" && sender ? sender : "не задана"}`,
  ];
  await showOrEdit(ctx, truncate(lines.join("\n")), settingsKeyboard());
}

export async function askSenderName(ctx: BotContext): Promise<void> {
  await answer(ctx);
  ctx.session.step = "awaiting_sender_name";
  await ctx.reply("✏️ Напишите имя для подписи в сообщениях (например: Max Mustermann):");
}

export async function onSenderNameText(ctx: BotContext, text: string): Promise<void> {
  const name = text.trim().slice(0, 80);
  if (name.length < 2) {
    await ctx.reply("Слишком коротко, напишите имя ещё раз.");
    return;
  }
  ctx.session.step = "idle";
  await setUserSetting(String(ctx.from!.id), "senderName", name, getServices().db);
  await ctx.reply(`✅ Подпись сохранена: ${name}`);
}
