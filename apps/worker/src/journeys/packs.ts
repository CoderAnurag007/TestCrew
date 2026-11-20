/// <reference lib="dom" />
import type { ResolvedCategory } from '@auditor/shared';
import { BlockedError, type JourneyContext, moneyEqual, NotFoundError, parseMoney, pathOf } from './toolkit.js';
import { toolJourneys } from './tools.js';

/**
 * Business journeys per app category. Each journey is written like a careful
 * tester would do it by hand, and checks the business rules that a page-level
 * crawl cannot see: totals add up, a saved value stays saved, an order exists
 * after it is placed.
 */
export type JourneyRequirement = 'readonly' | 'full' | 'transaction' | 'payment';

export interface JourneyDefinition {
  id: string;
  name: string;
  category: ResolvedCategory;
  requires: JourneyRequirement;
  /** Runs as a signed-out visitor (no audit session), e.g. to check the sign-in page itself. */
  signedOut?: boolean;
  /** Longer limit for journeys that try many pages (default 2.5 minutes). */
  timeoutMs?: number;
  run: (ctx: JourneyContext, shared: SharedState) => Promise<void>;
}

export interface SharedState {
  productUrl?: string;
  productTitle?: string;
  productPrice?: number | null;
  orderNumber?: string;
}

const PRODUCT_LINKS_SCRIPT = `(() => {
  const priceRe = /(?:[$€£₹¥]|\\b(?:USD|EUR|GBP|INR|Rs\\.?)\\b)\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?(?:€|USD|EUR)/;
  const out = [];
  const seen = new Set();
  const productHref = /\\/(products?|p|item|items|dp|listing)\\/[^/?#]+/i;
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    if (a.closest('nav, header, footer, [role="navigation"]')) continue;
    const r = a.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    let card = a;
    let hasPrice = false;
    for (let i = 0; i < 5 && card; i += 1) {
      if (priceRe.test(card.innerText || '')) { hasPrice = true; break; }
      card = card.parentElement;
    }
    const score = (productHref.test(href) ? 2 : 0) + (hasPrice ? 2 : 0) + (a.querySelector('img') ? 1 : 0);
    if (score < 2) continue;
    const abs = new URL(href, location.href).toString();
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ href: abs, score, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 20);
})()`;

const PRODUCT_INFO_SCRIPT = `(() => {
  const priceRe = /(?:[$€£₹¥]|\\b(?:USD|EUR|GBP|INR|Rs\\.?)\\b)\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?(?:€|USD|EUR)/;
  const h1 = document.querySelector('h1');
  let price = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent || '{}');
      const items = Array.isArray(data) ? data : [data, ...(data['@graph'] || [])];
      for (const item of items) {
        const offers = item && item.offers ? (Array.isArray(item.offers) ? item.offers[0] : item.offers) : null;
        if (offers && (offers.price || offers.lowPrice)) { price = String(offers.price || offers.lowPrice); break; }
      }
    } catch {}
    if (price) break;
  }
  if (!price) {
    const meta = document.querySelector('[itemprop="price"]');
    if (meta) price = meta.getAttribute('content') || meta.textContent;
  }
  if (!price) {
    const scope = (h1 && h1.closest('main, article, section, div')) || document.querySelector('main') || document.body;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const m = (node.textContent || '').match(priceRe);
      if (m) { price = m[0]; break; }
    }
  }
  const main = document.querySelector('main') || document.body;
  const imgs = Array.from(main.querySelectorAll('img')).filter((img) => img.getBoundingClientRect().width > 40);
  return {
    title: h1 ? (h1.textContent || '').replace(/\\s+/g, ' ').trim() : '',
    price,
    images: imgs.length,
    brokenImages: imgs.filter((img) => img.complete && img.naturalWidth === 0).length,
    brokenSrcs: imgs.filter((img) => img.complete && img.naturalWidth === 0 && img.currentSrc && !img.currentSrc.startsWith('data:')).map((img) => img.currentSrc).slice(0, 10),
    variantGroups: Array.from(document.querySelectorAll('select[name*="size" i], select[name*="color" i], select[name*="colour" i], select[name*="variant" i], select[name*="option" i], fieldset input[type="radio"]')).length,
  };
})()`;

const CART_SCRIPT = `(() => {
  const priceRe = /(?:[$€£₹¥]|\\b(?:USD|EUR|GBP|INR|Rs\\.?)\\b)\\s?-?\\d[\\d,.]*|-?\\d[\\d,.]*\\s?(?:€|USD|EUR)/g;
  const qtyInputs = Array.from(document.querySelectorAll('input[type="number"], input[name*="qty" i], input[name*="quantity" i], select[name*="qty" i], select[name*="quantity" i], [aria-label*="quantity" i]'))
    .filter((el) => el.getBoundingClientRect().width > 0 && !el.closest('header, nav'));
  const lines = [];
  for (const input of qtyInputs) {
    let row = input;
    for (let i = 0; i < 6 && row; i += 1) {
      row = row.parentElement;
      if (!row) break;
      const prices = (row.innerText || '').match(priceRe) || [];
      if (prices.length >= 1 && (row.innerText || '').length < 600) break;
    }
    if (!row) continue;
    const prices = (row.innerText || '').match(priceRe) || [];
    const qty = Number(input.value || input.getAttribute('value') || input.textContent || '1');
    const name = ((row.querySelector('a, h2, h3, h4, [class*="name" i], [class*="title" i]') || {}).textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    lines.push({ name, prices, qty: Number.isFinite(qty) ? qty : 1 });
  }
  const labelled = (re) => {
    const candidates = Array.from(document.querySelectorAll('tr, li, div, dl, p, span'))
      .filter((el) => el.children.length <= 6 && re.test((el.innerText || '').split('\\n')[0] || '') && (el.innerText || '').length < 80)
      // Smallest matching element first, so a whole totals block is not read as one line.
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    for (const el of candidates) {
      const m = (el.innerText || '').match(priceRe);
      if (m) return m[m.length - 1];
    }
    return null;
  };
  return {
    lines,
    subtotal: labelled(/\\bsub-?total\\b/i),
    shipping: labelled(/\\b(shipping|delivery)\\b/i),
    tax: labelled(/\\b(tax|gst|vat)\\b/i),
    discount: labelled(/\\b(discount|savings|coupon|promo)\\b/i),
    total: labelled(/^(order |grand |estimated )?total\\b/i),
    emptyText: /(cart|bag|basket) is empty|no items|nothing in your (cart|bag)/i.test(document.body.innerText || ''),
  };
})()`;

interface CartSnapshot {
  lines: Array<{ name: string; prices: string[]; qty: number }>;
  subtotal: string | null;
  shipping: string | null;
  tax: string | null;
  discount: string | null;
  total: string | null;
  emptyText: boolean;
}

async function findProduct(ctx: JourneyContext, shared: SharedState): Promise<string> {
  if (shared.productUrl) return shared.productUrl;
  type Link = { href: string; score: number };
  const sameSite = (links: Link[]) => links.filter((link) => new URL(link.href).host === new URL(ctx.baseUrl).host);
  // Product grids on slow sites render well after the page "loads"; a page that
  // stays blank is reloaded once before giving up on it.
  const productsHere = async (): Promise<Link[]> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (let waited = 0; waited <= 8_000; waited += 1_000) {
        const links = sameSite((await ctx.page.evaluate(PRODUCT_LINKS_SCRIPT).catch(() => [])) as Link[]);
        if (links.length) return links;
        const text = await ctx.page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
        if (text.trim().length > 200 && waited >= 3_000) break;
        await ctx.page.waitForTimeout(1_000);
      }
      const blank = (await ctx.page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')).trim().length <= 200;
      if (!blank) break;
      await ctx.page.reload({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => undefined);
      await ctx.settle();
    }
    return [];
  };
  await ctx.goto('/');
  let links = await productsHere();
  if (links.length === 0) {
    // Follow the site's own shop link first, then try common catalog paths directly
    // (a plain page load, so this is safe in read-only mode).
    const paths = ['/shop', '/products', '/collections/all', '/store', '/catalog', '/search'];
    const linked: string[] = [];
    for (const path of paths) {
      const href = await ctx.page
        .locator(`a[href$="${path}"], a[href*="${path}?"], a[href*="${path}/"]`)
        .first()
        .getAttribute('href', { timeout: 1_000 })
        .catch(() => null);
      if (href) linked.push(href);
    }
    for (const target of [...new Set([...linked, ...paths])]) {
      await ctx.goto(target).catch(() => undefined);
      links = await productsHere();
      if (links.length) break;
    }
  }
  const first = links[0];
  if (!first) throw new NotFoundError('Could not find a product with a price on the home page or a shop page. Add a product page as a control hint or custom journey if your catalog lives elsewhere.');
  shared.productUrl = first.href;
  return first.href;
}

async function readProduct(ctx: JourneyContext) {
  return (await ctx.page.evaluate(PRODUCT_INFO_SCRIPT)) as {
    title: string;
    price: string | null;
    images: number;
    brokenImages: number;
    brokenSrcs: string[];
    variantGroups: number;
  };
}

/** Picks the first real option of required variant selectors (size, colour) so add-to-cart is possible. */
async function chooseVariants(ctx: JourneyContext): Promise<number> {
  let chosen = 0;
  const selects = ctx.page.locator('select[name*="size" i], select[name*="color" i], select[name*="colour" i], select[name*="variant" i], select[name*="option" i]');
  for (let i = 0; i < Math.min(await selects.count(), 5); i += 1) {
    const select = selects.nth(i);
    if (!(await select.isVisible().catch(() => false))) continue;
    const values = await select.locator('option').evaluateAll((items) =>
      items.map((item) => ({ value: (item as HTMLOptionElement).value, disabled: (item as HTMLOptionElement).disabled, text: item.textContent ?? '' })),
    );
    const usable = values.find((option) => option.value && !option.disabled && !/^(select|choose|--)/i.test(option.text.trim()));
    if (usable) {
      await select.selectOption(usable.value).catch(() => undefined);
      chosen += 1;
    }
  }
  const radios = ctx.page.locator('fieldset input[type="radio"]:visible');
  if ((await radios.count()) > 0 && !(await ctx.page.locator('fieldset input[type="radio"]:checked').count())) {
    await radios.first().check({ timeout: 2_000 }).catch(() => undefined);
    chosen += 1;
  }
  return chosen;
}

async function addToCart(ctx: JourneyContext, shared: SharedState): Promise<{ before: number | null; after: number | null }> {
  const url = await findProduct(ctx, shared);
  await ctx.goto(url);
  const before = await ctx.cartCount();
  await chooseVariants(ctx);
  const button = await ctx.mustFind('add_to_cart', 'an "Add to cart" button');
  await ctx.click(button, `Adding "${shared.productTitle ?? 'product'}" to the cart`);
  await ctx.page.waitForTimeout(800);
  const after = await ctx.cartCount();
  // Close a mini-cart drawer if one opened, the same way a shopper would.
  const close = ctx.page.locator('[role="dialog"] button[aria-label*="close" i], [class*="drawer" i] button[aria-label*="close" i], [class*="minicart" i] button[aria-label*="close" i]').first();
  if (await close.isVisible().catch(() => false)) await close.click({ timeout: 2_000 }).catch(() => undefined);
  return { before, after };
}

async function openCart(ctx: JourneyContext): Promise<CartSnapshot> {
  // A journey starts on a blank page; the cart link lives in the site's header.
  if (!ctx.page.url().startsWith(new URL(ctx.baseUrl).origin)) await ctx.goto('/');
  let cart = await ctx.find('cart');
  if (!cart) {
    await ctx.goto('/');
    cart = await ctx.find('cart');
  }
  if (cart?.href) {
    await ctx.goto(cart.href);
  } else if (cart) {
    await ctx.click(cart, 'Opening the cart');
  } else {
    await ctx.goto('/cart');
  }
  return (await ctx.page.evaluate(CART_SCRIPT)) as CartSnapshot;
}

function lineAmounts(line: { prices: string[]; qty: number }): { unit: number | null; total: number | null } {
  const values = line.prices.map((price) => parseMoney(price)).filter((value): value is number => value !== null && value > 0);
  if (values.length === 0) return { unit: null, total: null };
  if (values.length === 1) return { unit: line.qty === 1 ? values[0]! : null, total: values[0]! };
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  return { unit: sorted[0]!, total: sorted.at(-1)! };
}

function checkCartMath(ctx: JourneyContext, cart: CartSnapshot, label: string): void {
  let sum = 0;
  let complete = true;
  for (const line of cart.lines) {
    const { unit, total } = lineAmounts(line);
    if (unit !== null && total !== null && line.qty > 1) {
      ctx.check(`${label}: line total = unit price × quantity (${line.name || 'item'})`, moneyEqual(unit * line.qty, total), (unit * line.qty).toFixed(2), total.toFixed(2));
    }
    if (total === null) complete = false;
    else sum += total;
  }
  const subtotal = parseMoney(cart.subtotal);
  if (complete && subtotal !== null && cart.lines.length > 0) {
    ctx.check(`${label}: subtotal = sum of line totals`, moneyEqual(sum, subtotal), sum.toFixed(2), subtotal.toFixed(2));
  }
  const total = parseMoney(cart.total);
  if (subtotal !== null && total !== null) {
    const expected = subtotal + (parseMoney(cart.shipping) ?? 0) + (parseMoney(cart.tax) ?? 0) - Math.abs(parseMoney(cart.discount) ?? 0);
    ctx.check(`${label}: total = subtotal + shipping + tax − discount`, moneyEqual(expected, total, 0.02), expected.toFixed(2), total.toFixed(2));
  }
}

/** Moves through checkout pages, filling each form, until payment fields appear (or the order can be placed). */
async function advanceCheckout(ctx: JourneyContext): Promise<'payment' | 'review' | 'stuck'> {
  for (let stage = 0; stage < 6; stage += 1) {
    if (await isPaymentStep(ctx)) return 'payment';
    const filled = await ctx.fillForm();
    // Pick a shipping method if one is offered and none is chosen.
    const shippingRadio = ctx.page.locator('input[type="radio"][name*="ship" i]:visible, input[type="radio"][name*="delivery" i]:visible').first();
    if ((await shippingRadio.count()) && !(await ctx.page.locator('input[type="radio"][name*="ship" i]:checked, input[type="radio"][name*="delivery" i]:checked').count())) {
      await shippingRadio.check({ timeout: 2_000 }).catch(() => undefined);
    }
    const next = (await ctx.find('continue', { prefer: 'last' })) ?? null;
    const place = await ctx.find('place_order', { prefer: 'last' });
    if (!next && place) return 'review';
    if (!next) return filled > 0 ? 'review' : 'stuck';
    const before = ctx.page.url();
    await ctx.click(next, `Continuing checkout ("${next.label}")`);
    if (ctx.page.url() === before && !(await isPaymentStep(ctx))) {
      const errors = await ctx.page.locator('[aria-invalid="true"], .error:visible, [class*="error" i]:visible, [role="alert"]:visible').count();
      if (errors > 0) {
        ctx.check('Checkout accepts the test address', false, 'next step', `${errors} validation errors shown`);
        return 'stuck';
      }
    }
  }
  return (await isPaymentStep(ctx)) ? 'payment' : 'stuck';
}

async function isPaymentStep(ctx: JourneyContext): Promise<boolean> {
  const hasCardField = await ctx.page
    .locator('input[autocomplete="cc-number"], input[name*="card" i], input[name*="cardnumber" i], iframe[src*="stripe" i], iframe[name*="stripe" i], iframe[src*="braintree" i], iframe[src*="adyen" i], iframe[src*="razorpay" i]')
    .count()
    .catch(() => 0);
  return hasCardField > 0;
}

async function selectNonCardMethod(ctx: JourneyContext): Promise<string | null> {
  const option = ctx.page
    .getByRole('radio', { name: /cash on delivery|\bcod\b|pay on delivery|bank transfer|invoice|pay later|manual/i })
    .first();
  if (await option.isVisible().catch(() => false)) {
    await option.check({ timeout: 2_000 }).catch(() => undefined);
    return (await option.getAttribute('aria-label')) ?? 'non-card method';
  }
  const label = ctx.page.locator('label', { hasText: /cash on delivery|pay on delivery|bank transfer|invoice|pay later/i }).first();
  if (await label.isVisible().catch(() => false)) {
    await label.click({ timeout: 2_000 }).catch(() => undefined);
    return ((await label.textContent()) ?? 'non-card method').trim();
  }
  return null;
}

/** "Your order number is ORD-1001", "Order #4521", "Confirmation: AB12CD3" -> the id (it must contain a digit). */
const ORDER_NUMBER = /(?:order|confirmation|booking|reference)[^\n]{0,40}?#?\b([A-Z]{0,8}-?\d[A-Z0-9-]{2,})\b/i;

/* ------------------------------ e-commerce ------------------------------ */

const ecommerce: JourneyDefinition[] = [
  {
    id: 'browse_catalog',
    name: 'Browse catalog to a product',
    category: 'ecommerce',
    requires: 'readonly',
    run: async (ctx, shared) => {
      await ctx.step('Find a product with a price', async () => {
        const url = await findProduct(ctx, shared);
        return `Found ${pathOf(url)}`;
      });
      await ctx.step('Open the product page', async () => {
        await ctx.goto(await findProduct(ctx, shared));
        const info = await readProduct(ctx);
        shared.productTitle = info.title;
        shared.productPrice = parseMoney(info.price);
        ctx.check('Product has a title', info.title.length > 0, 'a heading', info.title || '(none)');
        ctx.check('Product shows a price', (shared.productPrice ?? 0) > 0, 'a price above 0', info.price ?? '(none)');
        // An image that has not rendered may just be lazy or a placeholder; only a
        // request that actually fails proves it is broken.
        const broken: string[] = [];
        for (const src of [...new Set(info.brokenSrcs)]) {
          const response = await ctx.page.request.get(src, { timeout: 10_000, failOnStatusCode: false }).catch(() => null);
          if (!response || response.status() >= 400) broken.push(src);
        }
        ctx.check('Product images load', broken.length === 0, '0 broken images', broken.length ? `${broken.length} broken: ${broken.slice(0, 3).join(', ')}` : '0 broken');
        const add = await ctx.find('add_to_cart');
        const soldOut = /sold out|out of stock|unavailable/i.test((await ctx.page.locator('main, body').first().innerText().catch(() => '')) ?? '');
        ctx.check('Product can be added to the cart (or is clearly marked sold out)', Boolean(add) || soldOut, 'an "Add to cart" button', add ? `"${add.label}"` : soldOut ? 'sold out' : 'none found');
        return `${info.title} at ${info.price ?? 'no price'}`;
      });
    },
  },
  {
    id: 'search_product',
    name: 'Search finds products',
    category: 'ecommerce',
    requires: 'readonly',
    run: async (ctx, shared) => {
      await ctx.step('Search for a product by name', async () => {
        const term =
          ctx.plan.testData.searchTerms[0] ??
          (shared.productTitle ?? '').split(/\s+/).find((word) => word.length >= 4 && /[a-z]/i.test(word)) ??
          null;
        if (!term) throw new NotFoundError('No search term: add one to the test plan or let "Browse catalog" find a product first.');
        await ctx.goto('/');
        const box = await ctx.mustFind('search', 'a search box');
        await box.locator.fill(term, { timeout: 5_000 });
        await box.locator.press('Enter');
        await ctx.settle();
        // Results often arrive a few seconds later; wait for products or a "no results" message.
        let text = '';
        let results = 0;
        for (let waited = 0; waited <= 10_000; waited += 1_000) {
          text = (await ctx.page.locator('body').innerText().catch(() => '')).toLowerCase();
          results = ((await ctx.page.evaluate(PRODUCT_LINKS_SCRIPT)) as unknown[]).length;
          if (results > 0 || /no (results|products|matches)|nothing (was )?found|0 results/.test(text)) break;
          await ctx.page.waitForTimeout(1_000);
        }
        ctx.check(`Results mention "${term}"`, text.includes(term.toLowerCase()), term, text.includes(term.toLowerCase()) ? 'found' : 'not found');
        ctx.check('Search returns at least one product', results > 0, '≥ 1 product', String(results));
        return `"${term}" returned ${results} products`;
      });
    },
  },
  {
    id: 'add_to_cart',
    name: 'Add to cart updates the cart',
    category: 'ecommerce',
    requires: 'full',
    run: async (ctx, shared) => {
      await ctx.step('Add a product to the cart', async () => {
        ctx.requireFull();
        const { before, after } = await addToCart(ctx, shared);
        if (before !== null || after !== null) {
          ctx.check('Cart count goes up by 1', after === (before ?? 0) + 1, (before ?? 0) + 1, after ?? '(no count shown)');
        }
        return `Cart count ${before ?? '–'} → ${after ?? '–'}`;
      });
      await ctx.step('The product is in the cart', async () => {
        const cart = await openCart(ctx);
        ctx.check('Cart lists at least one item', cart.lines.length > 0 && !cart.emptyText, '≥ 1 item', cart.emptyText ? 'cart is empty' : String(cart.lines.length));
        const linePrice = cart.lines[0] ? lineAmounts(cart.lines[0]).unit ?? lineAmounts(cart.lines[0]).total : null;
        if (shared.productPrice && linePrice) {
          ctx.check('Cart price matches the product page', moneyEqual(shared.productPrice, linePrice), shared.productPrice.toFixed(2), linePrice.toFixed(2));
        }
        return `${cart.lines.length} line(s) in the cart`;
      });
    },
  },
  {
    id: 'cart_math',
    name: 'Cart quantities and totals add up',
    category: 'ecommerce',
    requires: 'full',
    run: async (ctx, shared) => {
      await ctx.step('Put an item in the cart', async () => {
        ctx.requireFull();
        // Start from an empty cart so earlier tests' items do not change the sums.
        let cart = await openCart(ctx);
        for (let i = 0; i < 10 && cart.lines.length > 0; i += 1) {
          const remove = await ctx.find('remove_from_cart');
          if (!remove) break;
          await ctx.click(remove, 'Emptying the cart first');
          await ctx.settle();
          cart = (await ctx.page.evaluate(CART_SCRIPT)) as CartSnapshot;
        }
        await addToCart(ctx, shared);
        cart = await openCart(ctx);
        ctx.check('Cart has an item to work with', cart.lines.length > 0, '≥ 1 item', String(cart.lines.length));
        const label = cart.lines.length === 1 && cart.lines[0]?.qty === 1 ? 'Quantity 1' : 'Cart as found';
        checkCartMath(ctx, cart, label);
        return `${cart.lines.length} line(s), subtotal ${cart.subtotal ?? 'not shown'}`;
      });
      await ctx.step('Change the quantity to 2', async () => {
        ctx.requireFull();
        const qty = ctx.page.locator('input[type="number"]:visible, input[name*="qty" i]:visible, input[name*="quantity" i]:visible, select[name*="qty" i]:visible, select[name*="quantity" i]:visible').first();
        if (!(await qty.count())) throw new NotFoundError('The cart has no quantity field.');
        const tag = await qty.evaluate((el) => el.tagName.toLowerCase());
        if (tag === 'select') await qty.selectOption('2');
        else {
          await qty.fill('2');
          await qty.press('Enter').catch(() => undefined);
        }
        const update = await ctx.find('save');
        if (update && /update|recalculate|apply/i.test(update.label)) await ctx.click(update, 'Updating the cart');
        await ctx.settle();
        const cart = (await ctx.page.evaluate(CART_SCRIPT)) as CartSnapshot;
        ctx.check('Quantity shows 2', cart.lines[0]?.qty === 2, 2, cart.lines[0]?.qty ?? '(none)');
        checkCartMath(ctx, cart, 'Quantity 2');
        const count = await ctx.cartCount();
        if (count !== null) ctx.check('Cart badge counts 2 items', count === 2, 2, count);
      });
      await ctx.step('Remove the item', async () => {
        ctx.requireFull();
        const remove = await ctx.mustFind('remove_from_cart', 'a remove button in the cart');
        await ctx.click(remove, 'Removing the item');
        const cart = (await ctx.page.evaluate(CART_SCRIPT)) as CartSnapshot;
        ctx.check('Cart is empty after removing the only item', cart.lines.length === 0 || cart.emptyText, 'empty cart', `${cart.lines.length} line(s)`);
      });
    },
  },
  {
    id: 'checkout_to_payment',
    name: 'Checkout up to payment',
    category: 'ecommerce',
    requires: 'transaction',
    run: async (ctx, shared) => {
      let cartTotal: number | null = null;
      await ctx.step('Add a product and open the cart', async () => {
        ctx.requireTransactions();
        let cart = await openCart(ctx);
        if (cart.lines.length === 0) {
          await addToCart(ctx, shared);
          cart = await openCart(ctx);
        }
        cartTotal = parseMoney(cart.total) ?? parseMoney(cart.subtotal);
        ctx.check('Cart has an item', cart.lines.length > 0, '≥ 1', String(cart.lines.length));
        return `Cart total ${cartTotal ?? 'not shown'}`;
      });
      await ctx.step('Start checkout', async () => {
        ctx.requireTransactions();
        const checkout = await ctx.mustFind('checkout', 'a checkout button');
        await ctx.click(checkout, 'Starting checkout');
        const loginWall = /log ?in|sign ?in/i.test(await ctx.page.title()) && !(await ctx.find('continue'));
        if (loginWall) {
          const guest = ctx.page.getByRole('button', { name: /guest/i }).or(ctx.page.getByRole('link', { name: /guest/i })).first();
          if (await guest.isVisible().catch(() => false)) await guest.click().catch(() => undefined);
        }
        return `On ${pathOf(ctx.page.url())}`;
      });
      await ctx.step('Fill shipping details and reach payment', async () => {
        ctx.requireTransactions();
        const reached = await advanceCheckout(ctx);
        ctx.check('Checkout reaches the payment or review step', reached !== 'stuck', 'payment or review step', reached);
        const text = await ctx.page.locator('body').innerText().catch(() => '');
        const amounts = [...text.matchAll(/(?:[$€£₹¥])\s?\d[\d,.]*/g)].map((m) => parseMoney(m[0])).filter((v): v is number => v !== null);
        if (cartTotal !== null && amounts.length) {
          const carried = amounts.some((value) => value >= cartTotal! - 0.011);
          ctx.check('Checkout total is at least the cart total', carried, `≥ ${cartTotal}`, amounts.slice(-3).join(', '));
        }
        return `Stopped at the ${reached} step`;
      });
    },
  },
  {
    id: 'place_order',
    name: 'Place an order end to end',
    category: 'ecommerce',
    requires: 'payment',
    run: async (ctx, shared) => {
      await ctx.step('Go through checkout', async () => {
        ctx.requireTransactions();
        if (ctx.plan.transactions.stopBefore === 'payment') {
          throw new BlockedError('The test plan stops before payment, so no order is placed.');
        }
        let cart = await openCart(ctx);
        if (cart.lines.length === 0) {
          await addToCart(ctx, shared);
          cart = await openCart(ctx);
        }
        const checkout = await ctx.mustFind('checkout', 'a checkout button');
        await ctx.click(checkout, 'Starting checkout');
        const reached = await advanceCheckout(ctx);
        ctx.check('Checkout reaches payment or review', reached !== 'stuck', 'payment or review', reached);
        return reached;
      });
      await ctx.step('Pay', async () => {
        ctx.requireTransactions();
        const cardStep = await isPaymentStep(ctx);
        if (cardStep) {
          const nonCard = await selectNonCardMethod(ctx);
          if (nonCard) return `Chose ${nonCard}`;
          if (!ctx.permissions.paymentAllowed) throw new BlockedError(ctx.permissions.paymentReason);
          await ctx.assertNoLivePayment();
          const filled = await ctx.fillSandboxCard();
          ctx.check('Sandbox card details entered', filled >= 2, '≥ 2 card fields', String(filled));
          return `Entered the sandbox card in ${filled} fields`;
        }
        const nonCard = await selectNonCardMethod(ctx);
        return nonCard ? `Chose ${nonCard}` : 'No payment fields on this step';
      });
      await ctx.step('Place the order', async () => {
        ctx.requireTransactions();
        if (ctx.plan.transactions.stopBefore === 'place_order') {
          throw new BlockedError('The test plan stops before the final "place order" click.');
        }
        await ctx.assertNoLivePayment();
        const place = await ctx.mustFind('place_order', 'a "Place order" button', { prefer: 'last' });
        await ctx.click(place, 'Placing the order');
        await ctx.page.waitForTimeout(2_000);
        await ctx.settle();
        const text = await ctx.page.locator('body').innerText().catch(() => '');
        const confirmed = /thank you|order (is )?(confirmed|placed|received|complete)|we('| ha)ve received your order/i.test(text);
        const number = text.match(ORDER_NUMBER)?.[1];
        ctx.check('Order confirmation is shown', confirmed, 'a confirmation message', confirmed ? 'shown' : text.slice(0, 120));
        ctx.check('Confirmation shows an order number', Boolean(number), 'an order number', number ?? 'none');
        if (number) shared.orderNumber = number;
        return number ? `Order ${number}` : 'Order placed';
      });
      await ctx.step('The order appears in order history', async () => {
        if (!shared.orderNumber) throw new NotFoundError('No order number to look up.');
        const history = ctx.page.getByRole('link', { name: /my orders|order history|orders|my account/i }).first();
        if (await history.isVisible().catch(() => false)) {
          await history.click({ timeout: 8_000 });
          await ctx.settle();
        } else {
          for (const path of ['/account/orders', '/orders', '/my-account/orders', '/account']) {
            await ctx.goto(path).catch(() => undefined);
            if (!/404|not found/i.test(await ctx.page.title())) break;
          }
        }
        const text = await ctx.page.locator('body').innerText().catch(() => '');
        ctx.check('Order history lists the new order', text.includes(shared.orderNumber), shared.orderNumber, text.includes(shared.orderNumber) ? 'listed' : 'not listed');
      });
    },
  },
];

/* --------------------------------- SaaS --------------------------------- */

const saas: JourneyDefinition[] = [
  {
    id: 'auth_session',
    name: 'Sign in keeps the session across pages',
    category: 'saas',
    requires: 'readonly',
    run: async (ctx) => {
      await ctx.step('Open app pages and reload', async () => {
        await ctx.goto('/');
        const links = await ctx.page.locator('nav a[href], aside a[href], [role="navigation"] a[href]').evaluateAll((items) =>
          items.map((item) => (item as HTMLAnchorElement).href).filter((href) => href.startsWith(location.origin)),
        );
        const visited: string[] = [];
        for (const href of [...new Set(links)].slice(0, 3)) {
          await ctx.goto(href);
          visited.push(pathOf(ctx.page.url()));
        }
        await ctx.page.reload({ waitUntil: 'domcontentloaded' });
        const loginShown = (await ctx.page.locator('input[type="password"]:visible').count()) > 0;
        ctx.check('Still signed in after navigating and reloading', !loginShown, 'no login form', loginShown ? 'login form shown' : 'signed in');
        return `Visited ${visited.join(', ') || 'the home page'}`;
      });
    },
  },
  {
    id: 'list_controls',
    name: 'Search, filter, sort and paging on lists',
    category: 'saas',
    requires: 'readonly',
    run: async (ctx) => {
      let rowsFound = 0;
      await ctx.step('Find a list or table', async () => {
        await ctx.goto('/');
        const tableLink = ctx.page.locator('nav a[href], aside a[href]').first();
        const rows = await ctx.page.locator('table tbody tr, [role="row"]').count();
        if (rows === 0 && (await tableLink.count())) {
          await tableLink.click().catch(() => undefined);
          await ctx.settle();
        }
        const count = await ctx.page.locator('table tbody tr, [role="row"]').count();
        if (count === 0) throw new NotFoundError('No table or list found on the first screens.');
        rowsFound = count;
        return `${count} rows`;
      });
      // Without a list there is nothing to sort or page; comparing two empty row sets proves nothing.
      if (!rowsFound) return;
      await ctx.step('Sort and page the list', async () => {
        const header = ctx.page.locator('th button, th[aria-sort], th a').first();
        if (await header.count()) {
          const first = await ctx.page.locator('table tbody tr').first().innerText().catch(() => '');
          await header.click().catch(() => undefined);
          await ctx.settle();
          const after = await ctx.page.locator('table tbody tr').first().innerText().catch(() => '');
          ctx.check('Sorting changes the row order', first !== after, 'a different first row', after === first ? 'same first row' : 'changed');
        }
        // A pager control: "Next", "Next page", or a lone › / » arrow (not breadcrumbs or "All tools →").
        const nextName = /^(next( page)?|›|»|>)$/i;
        const next = ctx.page.getByRole('button', { name: nextName }).or(ctx.page.getByRole('link', { name: nextName })).first();
        if (await next.isVisible().catch(() => false)) {
          const before = await ctx.page.locator('table tbody tr, [role="row"]').allInnerTexts();
          if (before.length === 0) return 'No rows on this screen to page through';
          await next.click().catch(() => undefined);
          await ctx.settle();
          const after = await ctx.page.locator('table tbody tr, [role="row"]').allInnerTexts();
          ctx.check('Next page shows different rows', before.join('|') !== after.join('|'), 'different rows', 'same rows');
        }
      });
    },
  },
  {
    id: 'crud_lifecycle',
    name: 'Create, edit and delete a record',
    category: 'saas',
    requires: 'full',
    run: async (ctx) => {
      const name = `TestCrew ${ctx.token}`;
      let listUrl = '';
      await ctx.step('Create a record', async () => {
        ctx.requireFull();
        await ctx.goto('/');
        const create = await ctx.mustFind('create', 'a "New" or "Create" button');
        listUrl = ctx.page.url();
        await ctx.click(create, 'Opening the create form');
        const firstText = ctx.page.locator('input[type="text"]:visible, input:not([type]):visible').first();
        if (await firstText.count()) await firstText.fill(name);
        await ctx.fillForm();
        const save = await ctx.mustFind('save', 'a save button', { prefer: 'last' });
        await ctx.click(save, 'Saving the new record');
        await ctx.goto(listUrl);
        const text = await ctx.page.locator('body').innerText();
        ctx.check('The new record is listed', text.includes(name), name, text.includes(name) ? 'listed' : 'missing');
      });
      await ctx.step('Delete the record', async () => {
        ctx.requireFull();
        if (ctx.permissions.kind !== 'STAGING') throw new BlockedError('Deleting is only tested on staging.');
        const row = ctx.page.locator('tr, li, [role="row"]', { hasText: name }).first();
        if (!(await row.count())) throw new NotFoundError('The created record is not listed, so it cannot be deleted.');
        const del = row.getByRole('button', { name: /delete|remove/i }).first();
        if (!(await del.count())) throw new NotFoundError('No delete button next to the record.');
        await del.click();
        const confirm = ctx.page.getByRole('button', { name: /^(delete|remove|yes|confirm)/i }).last();
        if (await confirm.isVisible().catch(() => false)) await confirm.click();
        await ctx.goto(listUrl);
        const text = await ctx.page.locator('body').innerText();
        ctx.check('The deleted record is gone', !text.includes(name), 'not listed', text.includes(name) ? 'still listed' : 'gone');
      });
    },
  },
  {
    id: 'settings_persist',
    name: 'Settings changes are saved',
    category: 'saas',
    requires: 'full',
    run: async (ctx) => {
      await ctx.step('Change a setting and reload', async () => {
        ctx.requireFull();
        const link = ctx.page.getByRole('link', { name: /settings|preferences|profile/i }).first();
        await ctx.goto('/');
        if (!(await link.isVisible().catch(() => false))) throw new NotFoundError('No settings page linked from the home page.');
        await link.click();
        await ctx.settle();
        const field = ctx.page.locator('input[type="text"]:visible').first();
        if (!(await field.count())) throw new NotFoundError('The settings page has no text field.');
        const original = await field.inputValue();
        const changed = `${original.slice(0, 40)} ${ctx.token}`.trim();
        await field.fill(changed);
        const save = await ctx.mustFind('save', 'a save button', { prefer: 'last' });
        await ctx.click(save, 'Saving settings');
        await ctx.page.reload({ waitUntil: 'domcontentloaded' });
        const after = await ctx.page.locator('input[type="text"]:visible').first().inputValue().catch(() => '');
        ctx.check('The changed setting is still there after reload', after === changed, changed, after);
        // Put the original value back.
        await ctx.page.locator('input[type="text"]:visible').first().fill(original).catch(() => undefined);
        const again = await ctx.find('save', { prefer: 'last' });
        if (again) await ctx.click(again, 'Restoring the original value');
      });
    },
  },
];

/* -------------------------------- booking -------------------------------- */

async function bookingFlow(ctx: JourneyContext, complete: boolean): Promise<void> {
  await ctx.step('Search availability', async () => {
    await ctx.goto('/');
    const date = ctx.page.locator('input[type="date"]:visible').first();
    if (await date.count()) {
      const target = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
      await date.fill(target).catch(() => undefined);
    }
    const book = await ctx.mustFind('book', 'a "Book" or "Check availability" control');
    await ctx.click(book, 'Searching availability');
    const slots = await ctx.page.getByRole('button', { name: /^\d{1,2}(:\d{2})?\s?(am|pm)?$|available/i }).count();
    ctx.check('Available slots or results are shown', slots > 0 || /available|results/i.test(await ctx.page.locator('body').innerText()), '≥ 1 slot', String(slots));
  });
  if (!complete) return;
  await ctx.step('Pick a slot and fill the booking form', async () => {
    ctx.requireTransactions();
    const slot = ctx.page.getByRole('button', { name: /^\d{1,2}(:\d{2})?\s?(am|pm)?$|select|available/i }).first();
    if (!(await slot.count())) throw new NotFoundError('No bookable slot found.');
    await slot.click();
    await ctx.settle();
    const filled = await ctx.fillForm();
    ctx.check('Booking form accepts the test details', filled > 0, '≥ 1 field', String(filled));
  });
  await ctx.step('Confirm the booking', async () => {
    ctx.requireTransactions();
    if (ctx.plan.transactions.stopBefore !== 'none') throw new BlockedError(`The test plan stops before ${ctx.plan.transactions.stopBefore === 'payment' ? 'payment' : 'the final confirmation'}.`);
    if (await isPaymentStep(ctx)) {
      if (!ctx.permissions.paymentAllowed) throw new BlockedError(ctx.permissions.paymentReason);
      await ctx.assertNoLivePayment();
      await ctx.fillSandboxCard();
    }
    const place = await ctx.mustFind('place_order', 'a confirm button', { prefer: 'last' });
    await ctx.click(place, 'Confirming the booking');
    const text = await ctx.page.locator('body').innerText();
    ctx.check('Booking confirmation is shown', /confirmed|thank you|booking (number|reference)|see you/i.test(text), 'a confirmation', text.slice(0, 120));
  });
}

const booking: JourneyDefinition[] = [
  { id: 'availability_search', name: 'Search availability', category: 'booking', requires: 'readonly', run: (ctx) => bookingFlow(ctx, false) },
  { id: 'booking_to_payment', name: 'Book a slot up to payment', category: 'booking', requires: 'transaction', run: (ctx) => bookingFlow(ctx, false).then(() => undefined) },
  { id: 'complete_booking', name: 'Complete a booking', category: 'booking', requires: 'payment', run: (ctx) => bookingFlow(ctx, true) },
];

/* -------------------------------- content -------------------------------- */

const content: JourneyDefinition[] = [
  {
    id: 'article_navigation',
    name: 'Open articles from listings',
    category: 'content',
    requires: 'readonly',
    run: async (ctx) => {
      await ctx.step('Open an article', async () => {
        await ctx.goto('/');
        const link = ctx.page.locator('article a[href], a[href*="/blog/"], a[href*="/news/"], a[href*="/article"], a[href*="/post"]').first();
        if (!(await link.count())) throw new NotFoundError('No article links found on the home page.');
        await link.click();
        await ctx.settle();
        const title = (await ctx.page.locator('h1').first().innerText().catch(() => '')).trim();
        const body = (await ctx.page.locator('article, main').first().innerText().catch(() => '')).length;
        ctx.check('Article has a title', title.length > 0, 'a heading', title || '(none)');
        ctx.check('Article has a body', body > 300, '> 300 characters', String(body));
        await ctx.page.goBack().catch(() => undefined);
        return title;
      });
    },
  },
  {
    id: 'content_search',
    name: 'Search content',
    category: 'content',
    requires: 'readonly',
    run: async (ctx) => {
      await ctx.step('Search for a word', async () => {
        await ctx.goto('/');
        const term = ctx.plan.testData.searchTerms[0] ?? ((await ctx.page.locator('h2, h3').first().innerText().catch(() => '')).split(/\s+/).find((word) => word.length > 4) ?? '');
        if (!term) throw new NotFoundError('No search term available; add one to the test plan.');
        const box = await ctx.mustFind('search', 'a search box');
        await box.locator.fill(term);
        await box.locator.press('Enter');
        await ctx.settle();
        const text = (await ctx.page.locator('body').innerText()).toLowerCase();
        ctx.check(`Results mention "${term}"`, text.includes(term.toLowerCase()), term, text.includes(term.toLowerCase()) ? 'found' : 'not found');
      });
    },
  },
  {
    id: 'newsletter_signup',
    name: 'Newsletter / contact form',
    category: 'content',
    requires: 'full',
    run: async (ctx) => {
      await ctx.step('Subscribe with a test address', async () => {
        ctx.requireFull();
        await ctx.goto('/');
        const subscribe = await ctx.mustFind('subscribe', 'a newsletter form');
        const form = subscribe.locator.locator('xpath=ancestor::form[1]');
        await ctx.fillForm((await form.count()) ? form : undefined);
        await ctx.click(subscribe, 'Subscribing');
        const text = await ctx.page.locator('body').innerText();
        ctx.check('A thank-you or confirmation message appears', /thank|subscribed|check your (inbox|email)|confirm/i.test(text), 'a confirmation', 'none');
      });
    },
  },
];

/* -------------------------------- generic -------------------------------- */

const generic: JourneyDefinition[] = [
  {
    id: 'contact_form',
    name: 'Contact form submits',
    category: 'generic',
    requires: 'full',
    run: async (ctx) => {
      await ctx.step('Send the contact form', async () => {
        ctx.requireFull();
        await ctx.goto('/');
        const link = ctx.page.getByRole('link', { name: /^contact( us)?$/i }).first();
        if (await link.isVisible().catch(() => false)) {
          await link.click();
          await ctx.settle();
        }
        const form = ctx.page.locator('form:has(textarea)').first();
        if (!(await form.count())) throw new NotFoundError('No contact form (a form with a message box) found.');
        const filled = await ctx.fillForm(form);
        ctx.check('The form accepts the test details', filled > 0, '≥ 1 field', String(filled));
        await form.locator('button[type="submit"], input[type="submit"], button:not([type])').last().click({ timeout: 8_000 });
        await ctx.settle();
        const text = await ctx.page.locator('body').innerText();
        ctx.check('A thank-you message appears', /thank|received|sent|we('| wi)ll (be in touch|get back)/i.test(text), 'a confirmation', text.slice(0, 120));
      });
    },
  },
  {
    id: 'auth_pages',
    name: 'Sign-in and sign-up pages work',
    category: 'generic',
    requires: 'readonly',
    // A signed-in visitor is redirected away from the sign-in page, so look as a guest.
    signedOut: true,
    run: async (ctx) => {
      await ctx.step('Open the sign-in page', async () => {
        await ctx.goto('/');
        const passwordField = ctx.page.locator('input[type="password"]');
        if ((await passwordField.count()) === 0) {
          // Follow a sign-in link or menu item; never press a form's submit button here.
          const login = await ctx.find('login');
          if (!login) throw new NotFoundError('No sign-in link on the home page.');
          if (login.href) await ctx.goto(login.href);
          else if (await login.locator.evaluate((el) => (el as { type?: string }).type === 'submit').catch(() => false)) {
            throw new NotFoundError('The only sign-in control is a form submit button, not a link to a sign-in page.');
          } else await ctx.click(login, 'Opening sign-in');
        }
        const password = await passwordField.count();
        ctx.check('Sign-in page has a password field', password > 0, 'a password field', String(password));
      });
    },
  },
];

export const PACKS: Record<ResolvedCategory, JourneyDefinition[]> = { ecommerce, saas, booking, content, tools: toolJourneys, generic };
