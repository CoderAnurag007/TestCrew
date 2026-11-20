import type { ResolvedCategory, SemanticPage } from '@auditor/shared';

/**
 * Guesses what kind of app this is from what exploration saw. Each signal adds
 * to a category's score; the highest score wins, "generic" when nothing stands
 * out. The signals are reported so people can see why, and override it.
 */
export function detectCategory(pages: SemanticPage[]): { category: ResolvedCategory; signals: string[]; scores: Record<ResolvedCategory, number> } {
  const scores: Record<ResolvedCategory, number> = { ecommerce: 0, saas: 0, booking: 0, content: 0, tools: 0, generic: 1 };
  const signals: string[] = [];
  const signalCategory = new Map<string, ResolvedCategory>();
  const add = (category: ResolvedCategory, points: number, signal: string) => {
    scores[category] += points;
    if (!signals.includes(signal)) {
      signals.push(signal);
      signalCategory.set(signal, category);
    }
  };
  const texts = pages.map((page) =>
    [page.title, page.route, ...page.importantText, page.contentSignature ?? '', ...page.elements.map((el) => `${el.text ?? ''} ${el.label ?? ''} ${el.href ?? ''}`)].join(' '),
  );
  const all = texts.join(' ').toLowerCase();
  const count = (re: RegExp) => (all.match(re) ?? []).length;

  const priced = count(/(?:[$€£₹¥]|\b(?:usd|eur|gbp|inr|rs\.?))\s?\d[\d,.]*/g);
  if (priced >= 5) add('ecommerce', Math.min(6, Math.floor(priced / 5)), `${priced} prices`);
  if (/add to (cart|bag|basket)/.test(all)) add('ecommerce', 5, '"Add to cart" buttons');
  if (/\/(cart|basket|checkout)\b/.test(all) || /\bcart\b/.test(all)) add('ecommerce', 3, 'cart or checkout links');
  if (/\/(products?|shop|collections|catalog)\b/.test(all)) add('ecommerce', 2, 'product or shop pages');

  if (/\b(book now|reserve|check availability|appointment|check-?in|check-?out date|guests)\b/.test(all)) add('booking', 5, 'booking words (book now, availability, guests)');
  if (pages.some((page) => page.elements.some((el) => el.inputType === 'date' || el.inputType === 'datetime-local'))) add('booking', 2, 'date pickers');

  if (/\b(dashboard|workspace|projects?|settings|billing|team|members|api keys?)\b/.test(all)) add('saas', 3, 'dashboard and settings pages');
  if (pages.some((page) => page.elements.some((el) => /^(new|create|add)\b/i.test(el.text ?? '') && !/add to/i.test(el.text ?? '')))) add('saas', 2, '"New/Create" buttons');
  if (pages.filter((page) => (page.listItems ?? []).length > 3).length >= 2) add('saas', 1, 'list views');

  // Online tools: file pickers on many pages and "X to Y" converter links.
  const filePages = pages.filter((page) => page.elements.some((el) => el.inputType === 'file')).length;
  if (filePages >= 2) add('tools', Math.min(8, 3 + filePages), `file pickers on ${filePages} pages`);
  const converters = new Set(all.match(/\b[a-z0-9]{2,6}-to-[a-z0-9]{2,6}\b/g) ?? []).size;
  if (converters >= 3) add('tools', 4, `${converters} "X to Y" converter links`);
  if (count(/\b(convert|compress|merge|resize|converter|compressor)\b/g) >= 6) add('tools', 2, 'convert / compress / merge tools');

  if (/\/(blog|news|articles?|posts?|stories)\b/.test(all)) add('content', 4, 'blog or news sections');
  if (/\b(read more|min read|published|author)\b/.test(all)) add('content', 2, 'article words (read more, author)');

  const ranked = (Object.entries(scores) as Array<[ResolvedCategory, number]>).sort((a, b) => b[1] - a[1]);
  const [winner, top] = ranked[0] ?? ['generic', 0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  const category = top >= 4 && top > runnerUp ? winner : 'generic';
  // The reasons for the chosen type come first, so "detected from…" explains the choice.
  const ordered = [...signals].sort((a, b) => Number(signalCategory.get(b) === category) - Number(signalCategory.get(a) === category));
  return { category, signals: ordered, scores };
}
