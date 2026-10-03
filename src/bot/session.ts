import { session, type Context, type SessionFlavor } from "grammy";

export type Step =
  | "idle"
  | "awaiting_niche_text"
  | "awaiting_location"
  | "awaiting_count"
  | "awaiting_note"
  | "awaiting_price"
  | "awaiting_sender_name";

export interface SessionData {
  step: Step;
  niche?: string;
  location?: string;
  targetLeadId?: string; // для заметки / цены
  listView: "all" | "fav";
  filters: string[];
  sort: string;
}

export type BotContext = Context & SessionFlavor<SessionData>;

export function initialSession(): SessionData {
  return { step: "idle", listView: "all", filters: [], sort: "score" };
}

// Сессии в памяти — достаточно для личного бота. После перезапуска диалог начинается заново.
export const sessionMiddleware = session({ initial: initialSession });
