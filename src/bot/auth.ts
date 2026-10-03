/**
 * Бот — личный инструмент, и каждый запрос тратит деньги на API. Поэтому доступ только у владельца:
 * ALLOWED_TELEGRAM_IDS в .env. Пока список пуст, бот отвечает только подсказкой с вашим Telegram ID.
 */
export function parseAllowedIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function authMiddleware(allowed: Set<string>) {
  return async (ctx: any, next: () => Promise<void>) => {
    const id = ctx.from?.id;
    if (id === undefined) return;

    if (allowed.size === 0) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery().catch(() => {});
      } else {
        await ctx.reply(
          `🔒 Бот ещё не настроен.\n\nВаш Telegram ID: ${id}\n\nДобавьте в файл .env строку:\nALLOWED_TELEGRAM_IDS=${id}\nи перезапустите бота.`
        );
      }
      return;
    }

    if (!allowed.has(String(id))) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      return; // чужим не отвечаем вообще
    }

    await next();
  };
}
