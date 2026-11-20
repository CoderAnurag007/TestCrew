import { BrowserManager } from '@auditor/browser';
import type { SemanticPage } from '@auditor/shared';

/**
 * Same-origin link integrity: every link the explorer saw is fetched once with
 * the audit's session, and links that answer 404/410 or a server error are
 * reported. External sites are never fetched, and links that look like they
 * change state (logout, delete, unsubscribe) are never followed, even with GET.
 */
export interface BrokenLink {
  url: string;
  status: number | null;
  error?: string;
  linkedFrom: string;
  label: string;
}

const UNSAFE_GET = /log-?out|sign-?out|logoff|delete|remove|destroy|unsubscribe|deactivate|cancel|revoke|reset|clear-?cart|empty-?cart|add-?to-?cart|cart\/add|wishlist\/add|checkout|payment|\/pay\b|order\/place|place-?order/i;

export async function checkLinks(input: {
  pages: SemanticPage[];
  baseUrl: string;
  storageState?: unknown;
  maxLinks?: number;
  concurrency?: number;
}): Promise<{ checked: number; broken: BrokenLink[]; skippedUnsafe: number }> {
  const origin = new URL(input.baseUrl).origin;
  const targets = new Map<string, { linkedFrom: string; label: string }>();
  let skippedUnsafe = 0;
  for (const page of input.pages) {
    for (const element of page.elements) {
      if (!element.href) continue;
      const raw = element.href.trim();
      if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel|sms|data):/i.test(raw)) continue;
      let absolute: URL;
      try {
        absolute = new URL(raw, page.url);
      } catch {
        continue;
      }
      if (absolute.origin !== origin) continue;
      absolute.hash = '';
      const key = absolute.toString();
      if (UNSAFE_GET.test(`${absolute.pathname}${absolute.search}`) || UNSAFE_GET.test(element.label ?? element.text ?? '')) {
        skippedUnsafe += 1;
        continue;
      }
      if (!targets.has(key)) {
        targets.set(key, { linkedFrom: page.url, label: (element.label ?? element.text ?? raw).trim().slice(0, 80) });
      }
    }
  }

  const queue = [...targets.entries()].slice(0, input.maxLinks ?? 80);
  if (queue.length === 0) {
    return { checked: 0, broken: [], skippedUnsafe };
  }

  const manager = new BrowserManager();
  const context = await manager.createContext(input.storageState ? { storageState: input.storageState as never } : {});
  const broken: BrokenLink[] = [];
  try {
    const request = context.request;
    let index = 0;
    const worker = async () => {
      while (index < queue.length) {
        const current = queue[index];
        index += 1;
        if (!current) continue;
        const [url, meta] = current;
        try {
          const response = await request.get(url, { timeout: 15_000, maxRedirects: 5, failOnStatusCode: false });
          const status = response.status();
          if (status === 404 || status === 410 || status >= 500) {
            broken.push({ url, status, linkedFrom: meta.linkedFrom, label: meta.label });
          }
          await response.dispose().catch(() => undefined);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'request failed';
          if (!/timeout/i.test(message)) {
            broken.push({ url, status: null, error: message.slice(0, 200), linkedFrom: meta.linkedFrom, label: meta.label });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, input.concurrency ?? 4) }, () => worker()));
  } finally {
    await context.close().catch(() => undefined);
    await manager.close().catch(() => undefined);
  }
  return { checked: queue.length, broken, skippedUnsafe };
}
