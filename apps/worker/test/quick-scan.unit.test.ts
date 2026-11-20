import { describe, expect, it } from 'vitest';
import { reconcileQuickFindings, snagsFor } from '../src/quick-scan.js';

const ok = { status: 200, loadMs: 900, errors: [], brokenImages: [] };

describe('quick scan', () => {
  it('reports nothing for a healthy page', () => {
    expect(snagsFor('https://shop.test/', ok, true)).toEqual([]);
  });

  it('turns page problems into plain-language snags', () => {
    const snags = snagsFor(
      'https://shop.test/cart',
      { status: 200, loadMs: 9_500, errors: ['TypeError: x is undefined'], brokenImages: ['https://cdn.test/a.png', 'https://cdn.test/b.png', 'https://cdn.test/c.png'] },
      false,
    );
    expect(snags.map((snag) => snag.kind)).toEqual(['script-error', 'broken-images', 'slow-page']);
    expect(snags[1]!.title).toBe('3 images not loading on /cart');
    expect(snags[1]!.severity).toBe('MEDIUM');
    expect(snags[2]!.description).toContain('9.5 seconds');
  });

  it('marks a broken home page as high and a missing inner page as medium', () => {
    expect(snagsFor('https://shop.test/', { ...ok, status: 500 }, true)[0]).toMatchObject({ severity: 'HIGH', title: 'The home page answers with error 500' });
    expect(snagsFor('https://shop.test/old', { ...ok, status: 404 }, false)[0]).toMatchObject({ severity: 'MEDIUM', title: 'The page /old answers with error 404' });
  });

  it('folds a quick snag into the full finding for the same problem and keeps the rest', async () => {
    const findings = [
      { id: 'q1', signature: 'quick|broken-page|/old', category: 'BUG', url: 'https://shop.test/old', title: 'The page /old answers with error 404' },
      { id: 'q2', signature: 'quick|phone-overflow|/', category: 'VISUAL', url: 'https://shop.test/', title: 'The home page is wider than a phone screen' },
      { id: 'f1', signature: 'link|/old|404', category: 'BUG', url: 'https://shop.test/old', title: 'Broken link' },
    ];
    const moved: unknown[] = [];
    const deleted: string[] = [];
    const prisma = {
      finding: {
        findMany: async () => findings,
        delete: async ({ where }: { where: { id: string } }) => deleted.push(where.id),
      },
      evidence: { updateMany: async (args: unknown) => moved.push(args) },
    };
    const removed = await reconcileQuickFindings({ prisma } as never, 'run1');
    expect(removed).toBe(1);
    expect(deleted).toEqual(['q1']);
    expect(moved).toEqual([{ where: { findingId: 'q1' }, data: { findingId: 'f1' } }]);
  });
});
