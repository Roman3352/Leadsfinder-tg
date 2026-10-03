/**
 * Field mask'и вынесены в конфиг, а не захардкожены в pipeline — по требованию
 * "архитектура должна позволять менять набор полей без переписывания pipeline".
 *
 * Search field mask — используется на этапе Text Search, должен быть МИНИМАЛЬНЫМ:
 * только то, что нужно для дедупликации и первичного списка (без rating/phone/website —
 * они дороже и запрашиваются отдельно на этапе Details только для отобранных бизнесов).
 *
 * Details field mask — используется на этапе Place Details, для конкретного отобранного
 * places.id. Здесь уже можно запрашивать website/rating/phone и т.д.
 */

const DEFAULT_SEARCH_FIELDS = ["places.id", "places.displayName", "places.formattedAddress"];

const DEFAULT_DETAILS_FIELDS = [
  "websiteUri",
  "internationalPhoneNumber",
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "googleMapsUri",
  "location",
];

export function getSearchFieldMask(): string {
  const fields = parseFieldsEnv(process.env.GOOGLE_PLACES_SEARCH_FIELD_MASK, DEFAULT_SEARCH_FIELDS);
  // searchText response всегда нужно смотреть под "places.*" — поле nextPageToken отдаётся
  // всегда, его не нужно указывать в field mask.
  return fields.join(",");
}

export function getDetailsFieldMask(): string {
  return parseFieldsEnv(process.env.GOOGLE_PLACES_DETAILS_FIELD_MASK, DEFAULT_DETAILS_FIELDS).join(",");
}

function parseFieldsEnv(envValue: string | undefined, fallback: string[]): string[] {
  if (!envValue || envValue.trim() === "") return fallback;
  return envValue
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}
