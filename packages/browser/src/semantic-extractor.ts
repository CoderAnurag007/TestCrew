import type { SemanticElement, SemanticPage } from '@auditor/shared';
import type { Page } from 'playwright';
import { classifyActionRisk } from './risk.js';
import { buildSelectorMeta } from './selectors.js';

interface RawElement {
  index: number;
  tag: string;
  role: string | null;
  type: string | null;
  text: string | null;
  label: string | null;
  placeholder: string | null;
  name: string | null;
  href: string | null;
  id: string | null;
  testId: string | null;
  inputType: string | null;
  visible: boolean;
  enabled: boolean;
  expanded: boolean | null;
  hasPopup: boolean;
  inNavigation: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
}

const EXTRACT_SCRIPT = `(() => {
  const navRootSelector = 'nav, aside, mat-sidenav, mat-nav-list, [role="navigation"], .sidebar, .sidenav, .mat-sidenav, .mat-drawer, [class*="sidebar"], [class*="sidenav"], [class*="nav-menu"], .p-panelmenu, .p-tieredmenu';
  const itemSelector = 'a[href], a[routerLink], [routerLink], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="treeitem"], summary, [contenteditable="true"], mat-list-item, .mat-mdc-list-item, .mat-list-item, .p-menuitem-link, .p-panelmenu-header, .p-panelmenu-header-link, .p-menuitem, mat-expansion-panel-header, .nav-link, .menu-item, .nav-item, [class*="menu-item"], [class*="nav-item"], [class*="submenu"]';
  const seen = new Set();
  const interactive = [];
  for (const el of document.querySelectorAll(itemSelector)) {
    if (!seen.has(el)) {
      seen.add(el);
      interactive.push(el);
    }
  }
  for (const root of document.querySelectorAll(navRootSelector)) {
    for (const el of root.querySelectorAll(itemSelector + ', li, [class*="submenu"]')) {
      if (!seen.has(el)) {
        seen.add(el);
        interactive.push(el);
      }
    }
  }

  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el.id) {
      const match = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (match && match.textContent && match.textContent.trim()) {
        return match.textContent.trim();
      }
    }
    const parent = el.closest('label');
    if (parent && parent.textContent && parent.textContent.trim()) {
      return parent.textContent.trim();
    }
    const primary = el.querySelector(':scope > .mdc-list-item__primary-text, :scope > .mat-line, :scope > .mat-mdc-list-item-unscoped-content');
    if (primary && primary.textContent && primary.textContent.trim()) {
      return primary.textContent.trim().slice(0, 80);
    }
    const firstLine = ((el.innerText || el.textContent || '') + '').split('\\n').map((item) => item.trim()).find(Boolean);
    return firstLine ? firstLine.slice(0, 80) : null;
  };

  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const hrefFor = (el) => {
    const router = el.getAttribute('routerlink') || el.getAttribute('ng-reflect-router-link');
    if (router) return router;
    if (el.tagName.toLowerCase() === 'a') {
      return el.getAttribute('href');
    }
    const nested = el.querySelector('a[href], [routerLink], [ng-reflect-router-link]');
    if (nested) {
      return nested.getAttribute('routerlink') || nested.getAttribute('ng-reflect-router-link') || nested.getAttribute('href');
    }
    return null;
  };

  return interactive.map((el, index) => {
    const text = labelFor(el);
    const box = el.getBoundingClientRect();
    const expandedAttr = el.getAttribute('aria-expanded');
    const href = hrefFor(el);
    const hasChevron = Boolean(el.querySelector('[class*="chevron"], [class*="caret"], [class*="arrow"], .mat-expansion-indicator, .mat-icon, i.fa-chevron-down, i.fa-angle-down'));
    const inNavigation = Boolean(el.closest(navRootSelector));
    return {
      index: index,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      text: text || null,
      label: text,
      placeholder: el.getAttribute('placeholder'),
      name: el.getAttribute('name'),
      href: href,
      id: el.id || null,
      testId: el.getAttribute('data-testid'),
      inputType: el.tagName.toLowerCase() === 'input' ? el.type : el.getAttribute('type'),
      visible: isVisible(el),
      enabled: el.disabled === true ? false : el.getAttribute('aria-disabled') !== 'true',
      expanded: expandedAttr === 'true' ? true : expandedAttr === 'false' ? false : hasChevron && inNavigation && !href ? false : null,
      hasPopup: el.getAttribute('aria-haspopup') === 'true' || el.getAttribute('aria-haspopup') === 'menu',
      inNavigation: inNavigation,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  });
})()`;

const HEADING_SCRIPT = `(() => {
  const active = document.querySelector('[aria-current="page"], .mdc-list-item--activated, .mat-list-item-active, .active[routerlink], a.active');
  const activeText = (active && (active.getAttribute('aria-label') || active.textContent || '').trim().split('\\n')[0]) || '';
  const roots = [
    document.querySelector('.mat-sidenav-content'),
    document.querySelector('.mat-drawer-content'),
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
  ].filter(Boolean);
  const scope = roots[0] || document;
  const collect = (root) => Array.from(root.querySelectorAll('h1, h2, h3, [data-testid="page-title"]'))
    .filter((node) => !node.closest('nav, aside, mat-sidenav, mat-nav-list, [role="navigation"]'))
    .map((node) => (node.textContent || '').trim())
    .filter(Boolean);
  const fromScope = collect(scope);
  const headings = fromScope.length > 0 ? fromScope : collect(document);
  if (activeText && !headings.includes(activeText)) {
    headings.unshift(activeText);
  }
  return headings.slice(0, 12);
})()`;

const CONTENT_SCRIPT = `(() => {
  const main = document.querySelector('.mat-sidenav-content, .mat-drawer-content, main, [role="main"]') || document.body;
  return ((main && main.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
})()`;

export class SemanticExtractor {
  async extract(page: Page): Promise<SemanticPage> {
    const url = page.url();
    const title = await page.title();
    const parsed = new URL(url);
    const hash = parsed.hash.replace(/^#/, '');
    const route = hash.startsWith('/') ? hash : `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const raw = (await page.evaluate(EXTRACT_SCRIPT)) as RawElement[];
    const modalOpen = Boolean(
      await page.evaluate(
        `Boolean(document.querySelector('[role="dialog"], dialog[open], .modal, [data-testid="modal"]'))`,
      ),
    );
    const importantText = (await page.evaluate(HEADING_SCRIPT)) as string[];
    const contentSignature = (await page.evaluate(CONTENT_SCRIPT)) as string;

    const elements: SemanticElement[] = raw.map((item) => {
      const selectors = buildSelectorMeta({
        testId: item.testId,
        id: item.id,
        role: item.role ?? (item.tag === 'a' ? 'link' : item.tag === 'button' ? 'button' : null),
        accessibleName: item.label ?? item.text,
        label: item.label,
        name: item.name,
        text: item.text,
        tag: item.tag,
        type: item.inputType,
        href: item.href,
      });
      return {
        id: `el_${item.index}`,
        type: item.tag,
        role: item.role,
        text: item.text,
        label: item.label,
        placeholder: item.placeholder,
        name: item.name,
        href: item.href,
        inputType: item.inputType,
        visible: item.visible,
        enabled: item.enabled,
        boundingBox: item.box,
        selectors,
        expanded: item.expanded,
        hasPopup: item.hasPopup,
        inNavigation: item.inNavigation,
        riskLevel: classifyActionRisk({
          text: item.text ?? item.label,
          href: item.href,
          name: item.name,
          type: item.inputType,
        }),
      };
    });

    return {
      url,
      title,
      route,
      modalOpen,
      importantText,
      contentSignature,
      elements,
    };
  }
}
