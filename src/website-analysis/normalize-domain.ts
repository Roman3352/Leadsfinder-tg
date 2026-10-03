/**
 * https://www.example.de, http://example.de/, www.example.de -> "example.de"
 * Нужно, чтобы не делать повторный quick check / crawl / PageSpeed для одного и
 * того же домена, если он уже недавно проверялся (в т.ч. для другого business,
 * если несколько бизнесов ссылаются на один и тот же сайт).
 */
export function normalizeDomain(rawUrl: string): string | null {
  if (!rawUrl || rawUrl.trim() === "") return null;

  let input = rawUrl.trim();
  if (!/^https?:\/\//i.test(input)) {
    input = `https://${input}`;
  }

  try {
    const url = new URL(input);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}
