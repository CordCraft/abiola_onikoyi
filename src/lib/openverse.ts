import "server-only";

export type StockImage = {
  url: string;
  credit: string | null;
  creditUrl: string | null;
};

// Fetches a relevant, openly-licensed photo from the Openverse API
// (no API key required). Returns null on any failure so callers can degrade
// gracefully (a post without an image still works).
export async function fetchStockImage(query: string): Promise<StockImage | null> {
  try {
    const params = new URLSearchParams({
      q: query,
      page_size: "8",
      mature: "false",
      // Permissive licences that allow use with attribution.
      license_type: "all-cc",
    });
    const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "abiolaonikoyi.com" },
      // Don't let a slow image search hang the whole generation.
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: Array<{
        url?: string;
        creator?: string;
        license?: string;
        foreign_landing_url?: string;
      }>;
    };

    const hit = (data.results ?? []).find((r) => r.url);
    if (!hit?.url) return null;

    const creditParts = [hit.creator, hit.license?.toUpperCase()].filter(Boolean);
    return {
      url: hit.url,
      credit: creditParts.length ? creditParts.join(" · ") : "Openverse",
      creditUrl: hit.foreign_landing_url ?? null,
    };
  } catch {
    return null;
  }
}
