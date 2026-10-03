import type { BotContext } from "../session.ts";
import {
  filtersKeyboard,
  leadCardKeyboard,
  leadDetailsKeyboard,
  listKeyboard,
  messageKeyboard,
  PAGE_SIZE,
  sortKeyboard,
  statusKeyboard,
} from "../keyboards.ts";
import { renderLeadCard, renderLeadDetails, renderListHeader, truncate } from "../render.ts";
import { getServices } from "../services.ts";
import { answer, parsePrice, showOrEdit } from "../util.ts";
import {
  addNote,
  applyFilters,
  getUserSetting,
  loadLeadView,
  loadLeadViews,
  setCrmStatus,
  setOfferedPrice,
  sortViews,
  toggleFavorite,
} from "../../leads/repository.ts";
import { CRM_STATUSES, type CrmStatusName } from "../../leads/view.ts";
import { ensureSalesBrief, generateOutreach } from "../../leads/ai.ts";
import { BudgetExceededError } from "../../jobs/budget.ts";

// ---------- список ----------

export async function showLeadList(ctx: BotContext, view: "all" | "fav", page = 0): Promise<void> {
  await answer(ctx);
  ctx.session.listView = view;
  const { db } = getServices();

  const all = await loadLeadViews(db);
  const base = view === "fav" ? all.filter((v) => v.isFavorite) : all;
  const filtered = sortViews(applyFilters(base, ctx.session.filters), ctx.session.sort);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const text = renderListHeader(base.length, filtered.length, view, ctx.session.filters, ctx.session.sort);
  await showOrEdit(ctx, text, listKeyboard(slice, safePage, totalPages));
}

export async function showPage(ctx: BotContext, page: number): Promise<void> {
  await showLeadList(ctx, ctx.session.listView, page);
}

export async function showFilters(ctx: BotContext): Promise<void> {
  await answer(ctx);
  await showOrEdit(ctx, "🔎 Фильтры (можно выбрать несколько):", filtersKeyboard(ctx.session.filters));
}

export async function toggleFilter(ctx: BotContext, code: string): Promise<void> {
  await answer(ctx);
  const set = new Set(ctx.session.filters);
  if (set.has(code)) set.delete(code);
  else set.add(code);
  ctx.session.filters = [...set];
  await showOrEdit(ctx, "🔎 Фильтры (можно выбрать несколько):", filtersKeyboard(ctx.session.filters));
}

export async function clearFilters(ctx: BotContext): Promise<void> {
  ctx.session.filters = [];
  await showFilters(ctx);
}

export async function showSort(ctx: BotContext): Promise<void> {
  await answer(ctx);
  await showOrEdit(ctx, "↕️ Сортировка:", sortKeyboard(ctx.session.sort));
}

export async function setSort(ctx: BotContext, code: string): Promise<void> {
  ctx.session.sort = code;
  await showLeadList(ctx, ctx.session.listView, 0);
}

// ---------- лид ----------

async function requireView(ctx: BotContext, leadId: string) {
  const view = await loadLeadView(leadId, getServices().db);
  if (!view) {
    await answer(ctx, "Лид не найден");
    await ctx.reply("Лид не найден (возможно, удалён).");
  }
  return view;
}

export async function openDetails(ctx: BotContext, leadId: string, asNewMessage = false): Promise<void> {
  await answer(ctx);
  const view = await requireView(ctx, leadId);
  if (!view) return;
  const text = renderLeadDetails(view);
  if (asNewMessage) await ctx.reply(text, { reply_markup: leadDetailsKeyboard(view) });
  else await showOrEdit(ctx, text, leadDetailsKeyboard(view));
}

export async function onToggleFavorite(ctx: BotContext, leadId: string): Promise<void> {
  const { db } = getServices();
  const next = await toggleFavorite(leadId, db);
  await answer(ctx, next ? "⭐ Добавлено в избранное" : "Убрано из избранного");
  const view = await loadLeadView(leadId, db);
  if (!view) return;
  const isDetails = (ctx.callbackQuery?.message as any)?.text?.includes("Почему такой score");
  if (isDetails) await showOrEdit(ctx, renderLeadDetails(view), leadDetailsKeyboard(view));
  else await showOrEdit(ctx, renderLeadCard(view), leadCardKeyboard(view));
}

export async function showStatusMenu(ctx: BotContext, leadId: string): Promise<void> {
  await answer(ctx);
  const view = await requireView(ctx, leadId);
  if (!view) return;
  await ctx.editMessageReplyMarkup({ reply_markup: statusKeyboard(leadId, view.crmStatus) }).catch(() => {});
}

export async function onSetStatus(ctx: BotContext, leadId: string, status: string): Promise<void> {
  if (!(CRM_STATUSES as readonly string[]).includes(status)) {
    await answer(ctx, "Неизвестный статус");
    return;
  }
  const { db } = getServices();
  await setCrmStatus(leadId, status as CrmStatusName, db);
  await answer(ctx, `Статус: ${status}`);
  const view = await loadLeadView(leadId, db);
  if (view) await showOrEdit(ctx, renderLeadDetails(view), leadDetailsKeyboard(view));
}

export async function askNote(ctx: BotContext, leadId: string): Promise<void> {
  await answer(ctx);
  ctx.session.step = "awaiting_note";
  ctx.session.targetLeadId = leadId;
  await ctx.reply("📝 Напишите заметку одним сообщением:");
}

export async function askPrice(ctx: BotContext, leadId: string): Promise<void> {
  await answer(ctx);
  ctx.session.step = "awaiting_price";
  ctx.session.targetLeadId = leadId;
  await ctx.reply("💰 Напишите предложенную цену числом (например 890). «0» — сбросить:");
}

export async function onNoteText(ctx: BotContext, text: string): Promise<void> {
  const leadId = ctx.session.targetLeadId;
  ctx.session.step = "idle";
  if (!leadId) return;
  await addNote(leadId, text.trim(), getServices().db);
  await ctx.reply("✅ Заметка сохранена. Открыть лид: /leads");
}

export async function onPriceText(ctx: BotContext, text: string): Promise<void> {
  const leadId = ctx.session.targetLeadId;
  const price = parsePrice(text);
  if (price === null) {
    await ctx.reply("Не понял число. Напишите цену цифрами, например 890:");
    return;
  }
  ctx.session.step = "idle";
  if (!leadId) return;
  await setOfferedPrice(leadId, price === 0 ? null : price, getServices().db);
  await ctx.reply(price === 0 ? "✅ Цена сброшена." : `✅ Цена сохранена: ${price}`);
}

// ---------- AI ----------

function aiUnavailable(ctx: BotContext): boolean {
  if (getServices().llm) return false;
  void ctx.reply("🤖 AI не настроен: добавьте OPENAI_API_KEY и DEFAULT_LLM_MODEL в .env и перезапустите бота.");
  return true;
}

export async function onBrief(ctx: BotContext, leadId: string): Promise<void> {
  if (aiUnavailable(ctx)) {
    await answer(ctx);
    return;
  }
  await answer(ctx, "🧠 Готовлю Sales Brief…");
  const services = getServices();
  try {
    await ensureSalesBrief({ db: services.db, llm: services.llm! }, leadId);
    const view = await loadLeadView(leadId, services.db);
    if (view) await showOrEdit(ctx, renderLeadDetails(view), leadDetailsKeyboard(view));
  } catch (err) {
    await reportAiError(ctx, err);
  }
}

export async function onMessage(ctx: BotContext, leadId: string, regenerate: boolean): Promise<void> {
  const services = getServices();
  const view = await requireView(ctx, leadId);
  if (!view) return;

  if (view.latestOutreach && !regenerate) {
    await answer(ctx);
    await ctx.reply(truncate(view.latestOutreach), { reply_markup: messageKeyboard(leadId) });
    return;
  }
  if (aiUnavailable(ctx)) {
    await answer(ctx);
    return;
  }

  await answer(ctx, "💬 Пишу сообщение…");
  const senderSetting = await getUserSetting(String(ctx.from!.id), "senderName", services.db);
  const senderName = typeof senderSetting === "string" && senderSetting ? senderSetting : "[Ihr Name]";
  try {
    const message = await generateOutreach({ db: services.db, llm: services.llm! }, leadId, senderName);
    await ctx.reply(truncate(message), { reply_markup: messageKeyboard(leadId) });
    if (senderName === "[Ihr Name]") {
      await ctx.reply("ℹ️ Подпись «[Ihr Name]» — замените на своё имя. Чтобы бот подписывал сам: ⚙️ Settings → имя для подписи.");
    }
  } catch (err) {
    await reportAiError(ctx, err);
  }
}

async function reportAiError(ctx: BotContext, err: unknown): Promise<void> {
  if (err instanceof BudgetExceededError) {
    await ctx.reply(`⛔ Лимит достигнут: ${err.reason}`);
    return;
  }
  console.error("[bot] AI error:", err instanceof Error ? err.message : err);
  await ctx.reply(`⚠️ AI сейчас недоступен: ${err instanceof Error ? err.message : "ошибка"}. Попробуйте позже.`);
}
