import type { BotContext } from "./session.ts";

/** Редактирует сообщение, с которого пришёл callback; если нельзя — отправляет новое. */
export async function showOrEdit(ctx: BotContext, text: string, keyboard: any): Promise<void> {
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
      return;
    } catch (err: any) {
      const description = String(err?.description ?? err?.message ?? "");
      if (description.includes("message is not modified")) return;
      // сообщение слишком старое / удалено — покажем новым
    }
  }
  await ctx.reply(text, { reply_markup: keyboard });
}

export async function answer(ctx: BotContext, text?: string): Promise<void> {
  if (!ctx.callbackQuery) return;
  await ctx.answerCallbackQuery(text ? { text } : undefined).catch(() => {});
}

export function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[€\s]/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 && value < 10_000_000 ? value : null;
}
