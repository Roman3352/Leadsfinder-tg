import type { BotContext } from "../session.ts";
import { countKeyboard, jobDoneKeyboard, leadCardKeyboard, nicheKeyboard, OTHER_NICHE, COUNT_OPTIONS } from "../keyboards.ts";
import { renderLeadCard, renderProgress, renderSummary } from "../render.ts";
import { getServices } from "../services.ts";
import { answer } from "../util.ts";
import { runSearchJob, type JobProgress } from "../../jobs/run-search-job.ts";
import { assertMonthlyBudget, BudgetExceededError } from "../../jobs/budget.ts";
import { settings } from "../../config/env.ts";
import { estimateSearchCost } from "../../cost/estimate.ts";
import { formatRange } from "../../config/pricing.ts";
import { getOrCreateUser, loadJobLeadViews } from "../../leads/repository.ts";

export async function startFindLeads(ctx: BotContext): Promise<void> {
  await answer(ctx);
  ctx.session.step = "idle";
  ctx.session.niche = undefined;
  ctx.session.location = undefined;
  await ctx.reply("🔎 FIND CLIENTS\n\nВыберите нишу:", { reply_markup: nicheKeyboard() });
}

export async function onNicheChosen(ctx: BotContext, niche: string): Promise<void> {
  await answer(ctx);
  if (niche === OTHER_NICHE) {
    ctx.session.step = "awaiting_niche_text";
    await ctx.reply("Напишите нишу текстом (например: Tattoo Studio, Zahnarzt, Tierarzt):");
    return;
  }
  ctx.session.niche = niche;
  ctx.session.step = "awaiting_location";
  await ctx.reply(`Ниша: ${niche}\n\nТеперь напишите Ort: город, землю или «Deutschland». Например: Wetzlar`);
}

export async function onNicheText(ctx: BotContext, text: string): Promise<void> {
  const niche = text.trim().slice(0, 60);
  if (niche.length < 2) {
    await ctx.reply("Слишком коротко, напишите нишу ещё раз.");
    return;
  }
  ctx.session.niche = niche;
  ctx.session.step = "awaiting_location";
  await ctx.reply(`Ниша: ${niche}\n\nТеперь напишите Ort: город, землю или «Deutschland». Например: Wetzlar`);
}

export async function onLocationText(ctx: BotContext, text: string): Promise<void> {
  const location = text.trim().slice(0, 80);
  if (location.length < 2) {
    await ctx.reply("Слишком коротко, напишите Ort ещё раз.");
    return;
  }
  ctx.session.location = location;
  ctx.session.step = "awaiting_count";
  const estimates = COUNT_OPTIONS.map((n) => `${n} → ${formatRange(estimateSearchCost(n))}`).join("\n");
  await ctx.reply(
    `Ort: ${location}\n\nСколько компаний искать?\n\nОриентировочная стоимость (оценка, не точная сумма):\n${estimates}`,
    { reply_markup: countKeyboard() }
  );
}

export async function onCountChosen(ctx: BotContext, requestedCount: number): Promise<void> {
  await answer(ctx);
  const { niche, location } = ctx.session;
  if (!niche || !location) {
    ctx.session.step = "idle";
    await ctx.reply("Что-то пошло не так, начните заново: /find");
    return;
  }

  const services = getServices();
  const { db } = services;
  if (!services.keys.google) {
    ctx.session.step = "idle";
    await ctx.reply("⚠️ GOOGLE_PLACES_API_KEY не задан в .env — поиск невозможен.");
    return;
  }

  const user = await getOrCreateUser(String(ctx.from!.id), db);
  const running = await db.searchJob.findFirst({ where: { userId: user.id, status: "RUNNING" } });
  if (running) {
    await ctx.reply("⏳ Предыдущий поиск ещё идёт. Дождитесь уведомления о завершении.");
    return;
  }

  try {
    await assertMonthlyBudget(settings.maxMonthlyBudgetEur(), db);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      ctx.session.step = "idle";
      await ctx.reply(`⛔ Месячный бюджет на API исчерпан (${err.reason}).\nПоиск не запущен. Лимит меняется в .env: MAX_MONTHLY_API_BUDGET.`);
      return;
    }
    throw err;
  }

  const job = (await db.searchJob.create({
    data: {
      userId: user.id,
      niche,
      location,
      requestedCount,
      status: "RUNNING",
      startedAt: new Date(),
      costEstimateMin: estimateSearchCost(requestedCount).min,
      costEstimateMax: estimateSearchCost(requestedCount).max,
      ...settings.jobLimits(),
    },
  })) as any;

  ctx.session.step = "idle";
  const chatId = ctx.chat!.id;
  const api = ctx.api;
  const progressMsg = await ctx.reply(renderProgress({ phase: "start" }, niche, location));

  // Поиск идёт в фоне: бот остаётся отзывчивым, а по завершении присылает уведомление.
  void (async () => {
    let lastEdit = 0;
    let lastText = "";
    const onProgress = async (p: JobProgress) => {
      const now = Date.now();
      if (now - lastEdit < 2500 && p.phase === "analysis") return; // не спамим правками
      const text = renderProgress(p, niche, location);
      if (text === lastText) return;
      lastEdit = now;
      lastText = text;
      await api.editMessageText(chatId, progressMsg.message_id, text).catch(() => {});
    };

    const summary = await runSearchJob({
      jobId: job.id,
      keys: { google: services.keys.google!, firecrawl: services.keys.firecrawl, pagespeed: services.keys.pagespeed },
      llm: services.llm,
      db,
      onProgress,
    });

    await api.sendMessage(chatId, renderSummary(summary), { reply_markup: jobDoneKeyboard() });

    if (summary.status !== "FAILED") {
      const top = (await loadJobLeadViews(job.id, db)).sort((a, b) => b.score - a.score).slice(0, 5);
      for (const view of top) {
        await api.sendMessage(chatId, renderLeadCard(view), { reply_markup: leadCardKeyboard(view) });
      }
    }
  })().catch(async (err) => {
    console.error("[bot] background job crashed:", err);
    await db.searchJob
      .update({ where: { id: job.id }, data: { status: "FAILED", stoppedReason: String(err?.message ?? err).slice(0, 500), finishedAt: new Date() } })
      .catch(() => {});
    await api.sendMessage(chatId, "❌ Поиск неожиданно завершился с ошибкой. Подробности в логах сервера.").catch(() => {});
  });
}
