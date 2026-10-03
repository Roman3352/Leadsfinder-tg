import { getDetailsFieldMask, getSearchFieldMask } from "./field-masks.ts";

const PLACES_API_BASE = "https://places.googleapis.com/v1";

export interface PlaceSearchResult {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
}

export interface PlaceSearchResponse {
  places: PlaceSearchResult[];
  nextPageToken?: string;
}

export interface PlaceDetailsResponse {
  id: string;
  website?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  googleMapsUri?: string;
  location?: { latitude: number; longitude: number };
}

export class GooglePlacesApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GooglePlacesApiError";
    this.status = status;
  }
}

interface FetchWithRetryOptions {
  timeoutMs?: number;
  retries?: number;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOptions = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retries = opts.retries ?? 2;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      // ретраим только на временные ошибки (5xx, 429), не на 4xx (кроме 429)
      if (res.status >= 500 || res.status === 429) {
        lastError = new GooglePlacesApiError(`HTTP ${res.status}`, res.status);
        if (attempt < retries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry failed");
}

function backoffMs(attempt: number): number {
  return 300 * Math.pow(2, attempt); // 300ms, 600ms, 1200ms...
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GooglePlacesClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Text Search (New). Использует МИНИМАЛЬНЫЙ field mask (см. field-masks.ts) —
   * никаких rating/website/phone на этом этапе, только то, что нужно для
   * дедупликации и построения списка кандидатов.
   */
  async searchText(params: {
    textQuery: string;
    pageToken?: string;
    maxResultCount?: number;
  }): Promise<PlaceSearchResponse> {
    const res = await fetchWithRetry(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": getSearchFieldMask(),
      },
      body: JSON.stringify({
        textQuery: params.textQuery,
        maxResultCount: params.maxResultCount ?? 20,
        ...(params.pageToken ? { pageToken: params.pageToken } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GooglePlacesApiError(`searchText failed: ${res.status} ${body}`, res.status);
    }

    const data = (await res.json()) as PlaceSearchResponse;
    return { places: data.places ?? [], nextPageToken: data.nextPageToken };
  }

  /**
   * Place Details — вызывается только для отдельного, уже отобранного placeId.
   * Field mask настраиваемый через env (GOOGLE_PLACES_DETAILS_FIELD_MASK),
   * pipeline не завязан на конкретный набор полей.
   */
  async getDetails(placeId: string): Promise<PlaceDetailsResponse> {
    const res = await fetchWithRetry(`${PLACES_API_BASE}/places/${placeId}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": getDetailsFieldMask(),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GooglePlacesApiError(`getDetails failed: ${res.status} ${body}`, res.status);
    }

    return (await res.json()) as PlaceDetailsResponse;
  }
}
