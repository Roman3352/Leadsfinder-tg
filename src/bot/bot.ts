import { Bot } from "grammy";
import { envString } from "../config/env.ts";
import { type BotContext, sessionMiddleware } from "./session.ts";
import { authMiddleware, parseAllowedIds } from "./auth.ts";
import { mainMenuKeyboard } from "./keyboards.ts";
import { showHome, showDashboard, showSettings, askSenderName, onSenderNameText } from "./handlers/settings.ts";
import { startFindLeads, onNicheChosen, onNicheText, onLocationText, onCountChosen } from "./handlers/find-leads.ts";
import {
  showLeadList,
  showPage,
  showFilters,
  toggleFilter,
  clearFilters,
  showSort,
  setSort,
  openDetails,
  onToggleFavorite,
  showStatusMenu,
  onSetStatus,
  askNote,
  askPrice,
  onNoteText,
  onPriceText,
  onBrief,
  onMessage,
} from "./handlers/leads.ts";

const BOT_TOKEN = envString("TELEGRAM_BOT_TOKEN");
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN не задан в .env");

export function buildBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(BOT_TOKEN!);

  bot.use(sessionMiddleware);
  bot.use(authMiddleware(parseAllowedIds(envString("ALLOWED_TELEGRAM_IDS"))));

  bot.command("start", showHome);
  bot.command("find", startFindLeads);
  bot.command("leads", (ctx) => showLeadList(ctx, "all", 0));
  bot.command("favorites", (ctx) => showLeadList(ctx, "fav", 0));
  bot.command("dashboard", showDashboard);
  bot.command("settings", showSettings);

  bot.callbackQuery("m:home", showHome);
  bot.callbackQuery("m:find", startFindLeads);
  bot.callbackQuery("m:dash", showDashboard);
  bot.callbackQuery("m:leads", (ctx) => showLeadList(ctx, "all", 0));
  bot.callbackQuery("m:favs", (ctx) => showLeadList(ctx, "fav", 0));
  bot.callbackQuery("m:set", showSettings);
  bot.callbackQuery("set:name", askSenderName);

  bot.callbackQuery(new RegExp(`^niche:(.+)$`), (ctx) => onNicheChosen(ctx, ctx.match![1]));
  bot.callbackQuery(/^cnt:(\d+)$/, (ctx) => onCountChosen(ctx, Number(ctx.match![1])));

  bot.callbackQuery(/^ls:p:(\d+)$/, (ctx) => showPage(ctx, Number(ctx.match![1])));
  bot.callbackQuery("ls:f", showFilters);
  bot.callbackQuery(/^ls:ft:(.+)$/, (ctx) => toggleFilter(ctx, ctx.match![1]));
  bot.callbackQuery("ls:fc", clearFilters);
  bot.callbackQuery("ls:s", showSort);
  bot.callbackQuery(/^ls:ss:(.+)$/, (ctx) => setSort(ctx, ctx.match![1]));

  bot.callbackQuery(/^ld:[do]:([^:]+)$/, (ctx) => openDetails(ctx, ctx.match![1]));
  bot.callbackQuery(/^ld:fav:([^:]+)$/, (ctx) => onToggleFavorite(ctx, ctx.match![1]));
  bot.callbackQuery(/^ld:st:([^:]+)$/, (ctx) => showStatusMenu(ctx, ctx.match![1]));
  bot.callbackQuery(/^ld:ss:([^:]+):(.+)$/, (ctx) => onSetStatus(ctx, ctx.match![1], ctx.match![2]));
  bot.callbackQuery(/^ld:note:([^:]+)$/, (ctx) => askNote(ctx, ctx.match![1]));
  bot.callbackQuery(/^ld:price:([^:]+)$/, (ctx) => askPrice(ctx, ctx.match![1]));
  bot.callbackQuery(/^ld:brief:([^:]+)$/, (ctx) => onBrief(ctx, ctx.match![1]));
  bot.callbackQuery(/^ld:msg:([^:]+)(?::new)?$/, (ctx) => onMessage(ctx, ctx.match![1], ctx.callbackQuery!.data.endsWith(":new")));

  bot.on("message:text", async (ctx) => {
    const step = ctx.session.step;
    if (step === "awaiting_niche_text") return onNicheText(ctx, ctx.message.text);
    if (step === "awaiting_location") return onLocationText(ctx, ctx.message.text);
    if (step === "awaiting_note") return onNoteText(ctx, ctx.message.text);
    if (step === "awaiting_price") return onPriceText(ctx, ctx.message.text);
    if (step === "awaiting_sender_name") return onSenderNameText(ctx, ctx.message.text);
    await ctx.reply("Не понял команду.", { reply_markup: mainMenuKeyboard() });
  });

  bot.catch((err) => {
    console.error("[bot] unhandled error:", err.error);
  });

  return bot;
}

async function main() {
  const bot = buildBot();
  console.log("Bot starting (long polling)...");
  await bot.start({ drop_pending_updates: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
