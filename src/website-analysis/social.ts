import { normalizeDomain } from "./normalize-domain.ts";

// Многие небольшие бизнесы указывают в Google вместо сайта страницу в соцсети —
// собственного сайта у них при этом нет, и краулить Facebook/Instagram нет смысла.
const SOCIAL_HOSTS = [
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "linktr.ee",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "xing.com",
  "wa.me",
  "pinterest.com",
];

export function socialHost(url: string | null | undefined): string | null {
  if (!url) return null;
  const host = normalizeDomain(url);
  if (!host) return null;
  return SOCIAL_HOSTS.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}

export function isSocialOnly(url: string | null | undefined): boolean {
  return socialHost(url) !== null;
}
