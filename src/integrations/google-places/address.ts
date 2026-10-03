/** "Musterstr. 1, 35578 Wetzlar, Germany" -> "Wetzlar" */
export function parseCity(formattedAddress: string | undefined | null): string | null {
  if (!formattedAddress) return null;
  const match = formattedAddress.match(/\b\d{5}\s+([^,]+)/);
  return match ? match[1].trim() : null;
}
