import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/client.ts";
import { GooglePlacesClient } from "./client.ts";
import { checkAndIncrementUsage, logApiUsage, BudgetExceededError } from "../../jobs/budget.ts";

const DETAILS_TTL_DAYS = Number(process.env.GOOGLE_PLACES_DETAILS_TTL_DAYS ?? 30);

export interface FetchDetailsParams {
  jobId: string;
  businessId: string;
  apiKey: string;
  client?: PrismaClient;
  force?: boolean; // игнорировать кэш (редко нужно)
}

export type FetchDetailsOutcome =
  | { status: "fetched" }
  | { status: "cached" } // details уже свежие — вызов Google API пропущен
  | { status: "budget_exceeded" };

/**
 * Вызывается ТОЛЬКО для отобранных business (после quick-фильтра, не для всех
 * найденных на этапе Search). Если details уже получены недавно
 * (detailsFetchedAt < DETAILS_TTL_DAYS назад) — Google API не дёргаем вообще,
 * это и есть кэширование, которое экономит дорогие Enterprise-поля (rating и т.п.).
 */
export async function fetchDetailsForBusiness(params: FetchDetailsParams): Promise<FetchDetailsOutcome> {
  const db = params.client ?? prisma;

  const business = await db.business.findUniqueOrThrow({ where: { id: params.businessId } });

  if (!params.force && business.detailsFetchedAt) {
    const ageMs = Date.now() - business.detailsFetchedAt.getTime();
    const ttlMs = DETAILS_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs < ttlMs) {
      return { status: "cached" };
    }
  }

  try {
    await checkAndIncrementUsage(params.jobId, "usedGoogleRequests", 1, db);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { status: "budget_exceeded" };
    }
    throw err;
  }

  const placesClient = new GooglePlacesClient(params.apiKey);
  const details = await placesClient.getDetails(business.googlePlaceId);

  await logApiUsage({
    searchJobId: params.jobId,
    provider: "GOOGLE_PLACES_DETAILS",
    requestType: "place_details",
    unitsConsumed: 1,
    client: db,
  });

  await db.business.update({
    where: { id: business.id },
    data: {
      website: details.website,
      phone: details.internationalPhoneNumber,
      rating: details.rating,
      reviewCount: details.userRatingCount,
      openingHours: details.regularOpeningHours ?? undefined,
      mapsUrl: details.googleMapsUri,
      lat: details.location?.latitude,
      lng: details.location?.longitude,
      detailsFetchedAt: new Date(),
    },
  });

  return { status: "fetched" };
}
