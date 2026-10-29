export type SourceResult = {
  source: string;
  ok?: boolean;
  skipped?: string;
  error?: string;
  added?: number;
  scanned?: number;
};

/** Runs `fn` over items with at most `limit` in flight. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (err) {
        console.error("jarvis sync item failed", err);
      }
    }
  });
  await Promise.all(workers);
}
