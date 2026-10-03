import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/client.ts";
import { GooglePlacesClient } from "./client.ts";
import { parseCity } from "./address.ts";
import { checkAndIncrementUsage, logApiUsage, BudgetExceededError } from "../../jobs/budget.ts";

const RESULTS_PER_PAGE = 20; // максимум, который отдаёт Text Search (New) за один вызов

export interface SearchBusinessesParams {
  jobId: string;
  niche: string;
  location: string;
  requestedCount: number;
  apiKey: string;
  client?: PrismaClient;
}

export interface SearchBusinessesResult {
  foundCount: number;
  stoppedForBudget: boolean;
}

/**
 * Ищет бизнесы через Google Places Text Search (New), постранично, пока не
 * наберёт requestedCount или не упрётся в MAX_GOOGLE_REQUESTS_PER_JOB.
 *
 * На каждой странице:
 *  - budget-check перед вызовом (checkAndIncrementUsage бросает BudgetExceededError,
 *    если лимит job уже исчерпан — тогда цикл останавливается, job НЕ падает,
 *    а корректно завершает то, что успел найти)
 *  - upsert Business по googlePlaceId (дедупликация глобальная, не в рамках job)
 *  - lastSeenAt обновляется на КАЖДОЕ обнаружение, в т.ч. повторное
 *  - SearchJobBusiness создаётся, чтобы знать, какие businesses найдены именно в этом job
 */
export async function searchBusinesses(params: SearchBusinessesParams): Promise<SearchBusinessesResult> {
  const db = params.client ?? prisma;
  const placesClient = new GooglePlacesClient(params.apiKey);

  const textQuery = `${params.niche} in ${params.location}`;

  let pageToken: string | undefined;
  let foundCount = 0;
  let stoppedForBudget = false;

  while (foundCount < params.requestedCount) {
    // 1) budget check ПЕРЕД вызовом — не тратим API-запрос, если лимит уже исчерпан
    try {
      await checkAndIncrementUsage(params.jobId, "usedGoogleRequests", 1, db);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        stoppedForBudget = true;
        break;
      }
      throw err;
    }

    const remaining = params.requestedCount - foundCount;
    const page = await placesClient.searchText({
      textQuery,
      pageToken,
      maxResultCount: Math.min(RESULTS_PER_PAGE, remaining),
    });

    await logApiUsage({
      searchJobId: params.jobId,
      provider: "GOOGLE_PLACES_SEARCH",
      requestType: "text_search",
      unitsConsumed: 1,
      client: db,
    });

    for (const place of page.places) {
      const now = new Date();

      const business = await db.business.upsert({
        where: { googlePlaceId: place.id },
        update: { lastSeenAt: now },
        create: {
          googlePlaceId: place.id,
          name: place.displayName?.text ?? "Unknown",
          address: place.formattedAddress,
          city: parseCity(place.formattedAddress),
          category: params.niche,
          lastSeenAt: now,
        },
      });

      await db.searchJobBusiness.upsert({
        where: {
          searchJobId_businessId: { searchJobId: params.jobId, businessId: business.id },
        },
        update: {},
        create: { searchJobId: params.jobId, businessId: business.id },
      });

      foundCount++;
    }

    await db.searchJob.update({
      where: { id: params.jobId },
      data: { foundCount },
    });

    if (!page.nextPageToken || page.places.length === 0) break;
    pageToken = page.nextPageToken;
  }

  if (stoppedForBudget) {
    await db.searchJob.update({
      where: { id: params.jobId },
      data: {
        status: "STOPPED_BUDGET_LIMIT",
        stoppedReason: "MAX_GOOGLE_REQUESTS_PER_JOB reached during search",
        finishedAt: new Date(),
      },
    });
  }

  return { foundCount, stoppedForBudget };
}
