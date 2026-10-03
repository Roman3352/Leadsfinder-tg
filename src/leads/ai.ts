import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import type { LLMProvider } from "../llm/provider.ts";
import {
  buildBriefRequest,
  buildOutreachRequest,
  formatBrief,
  type LeadFacts,
  type SalesBrief,
} from "../llm/prompts.ts";
import { assertMonthlyBudget, checkAndIncrementUsage, logApiUsage } from "../jobs/budget.ts";
import { llmCostEur } from "../config/pricing.ts";
import { settings } from "../config/env.ts";
import { loadLeadView } from "./repository.ts";
import { verifiedFindings, OPPORTUNITY_LABELS, type LeadView } from "./view.ts";

export interface AiDeps {
  db?: PrismaClient;
  llm: LLMProvider;
  jobId?: string; // если задан — расход учитывается в лимите MAX_AI_CALLS_PER_JOB этого job
}

async function callLlm<T>(deps: AiDeps, requestType: string, request: ReturnType<typeof buildBriefRequest>): Promise<T> {
  const db = deps.db ?? prisma;
  await assertMonthlyBudget(settings.maxMonthlyBudgetEur(), db);
  if (deps.jobId) await checkAndIncrementUsage(deps.jobId, "usedAiCalls", 1, db);

  const res = await deps.llm.generateJson<T>(request);
  const cost = llmCostEur(res.usage.inputTokens, res.usage.outputTokens);
  await logApiUsage({
    searchJobId: deps.jobId,
    provider: "OPENAI",
    requestType,
    unitsConsumed: 1,
    estimatedCostMin: cost.min,
    estimatedCostMax: cost.max,
    client: db,
  });
  return res.data;
}

export function buildFacts(view: LeadView): LeadFacts {
  const notes: string[] = [];
  if (view.websiteStatus === "NONE") notes.push("В Google Maps сайт не указан (возможно, он всё же существует, но не привязан к профилю).");
  if (view.websiteStatus === "SOCIAL_ONLY") notes.push("В Google указана только страница соцсети вместо сайта.");
  if (view.websiteStatus === "UNVERIFIED") notes.push("Сайт не удалось автоматически проверить — не утверждай, что он сломан.");
  if (view.opportunities.length === 0) notes.push("Явных возможностей для продажи по данным не найдено.");

  return {
    business: {
      name: view.name,
      niche: view.category,
      city: view.city,
      rating: view.rating,
      reviewCount: view.reviewCount,
      phone: view.phone,
      website: view.websiteUrl,
      websiteStatus: view.websiteStatus,
    },
    findings: view.problems.slice(0, 6).map((p) => ({ label: p.label, evidence: p.evidence, points: p.points })),
    opportunities: view.opportunities.slice(0, 5).map((o) => ({ code: o.code, reason: o.reason })),
    notes,
  };
}

/** Sales brief: создаётся один раз и кешируется в Lead.salesBrief (повторный вызов ничего не тратит). */
export async function ensureSalesBrief(deps: AiDeps, leadId: string, opts: { force?: boolean } = {}): Promise<string | null> {
  const db = deps.db ?? prisma;
  const view = await loadLeadView(leadId, db);
  if (!view) return null;
  if (view.salesBrief && !opts.force) return view.salesBrief;

  const brief = await callLlm<SalesBrief>(deps, "sales_brief", buildBriefRequest(buildFacts(view)));
  const text = formatBrief(view.name, brief);
  await db.lead.update({ where: { id: leadId }, data: { salesBrief: text } });
  return text;
}

/** Персональное сообщение на немецком (по кнопке — расход только когда вы сами попросили). */
export async function generateOutreach(deps: AiDeps, leadId: string, senderName: string): Promise<string> {
  const db = deps.db ?? prisma;
  const view = await loadLeadView(leadId, db);
  if (!view) throw new Error("Лид не найден");

  const data = await callLlm<{ message: string }>(
    deps,
    "outreach",
    buildOutreachRequest({
      businessName: view.name,
      niche: view.category,
      city: view.city,
      senderName,
      verifiedFindings: verifiedFindings(view),
      ideas: view.opportunities.slice(0, 3).map((o) => OPPORTUNITY_LABELS[o.code]?.replace(/^\S+\s/, "") ?? o.code),
    })
  );

  const message = data.message.trim();
  if (message.length < 20) throw new Error("Модель вернула слишком короткое сообщение");
  await db.outreach.create({ data: { leadId, messageText: message, channel: null } });
  return message;
}
