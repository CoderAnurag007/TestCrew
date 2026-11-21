/**
 * Measurements taken inside the page for the design review. Kept as plain
 * JavaScript strings: they run in the browser as written, so the TypeScript
 * build cannot rename helpers inside them ("__name is not defined").
 */

export type MeasuredBox = [number, number, number, number];

export type PageMeasurements = {
  docWidth: number;
  docHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
  contrast: Array<{ text: string; ratio: number; need: number; fg: string; bg: string; size: number; box: MeasuredBox }>;
  smallText: Array<{ text: string; size: number; box: MeasuredBox }>;
  tapTargets: Array<{ label: string; width: number; height: number; box: MeasuredBox }>;
  overflow: Array<{ label: string; right: number; box: MeasuredBox }>;
  blurryImages: Array<{ src: string; scale: number; box: MeasuredBox }>;
  stretchedImages: Array<{ src: string; box: MeasuredBox }>;
  missingAlt: Array<{ src: string; box: MeasuredBox }>;
  unlabeledFields: Array<{ label: string; box: MeasuredBox }>;
  h1Count: number;
  fonts: Array<{ family: string; count: number }>;
  fontSizes: number;
  buttonStyles: number;
};

export const MEASURE_SCRIPT = String.raw`(() => {
  var out = { docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight,
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, dpr: window.devicePixelRatio || 1,
    contrast: [], smallText: [], tapTargets: [], overflow: [], blurryImages: [], stretchedImages: [],
    missingAlt: [], unlabeledFields: [], h1Count: 0, fonts: [], fontSizes: 0, buttonStyles: 0 };
  var sx = window.scrollX, sy = window.scrollY;
  function boxOf(el) { var r = el.getBoundingClientRect(); return [Math.round(r.left + sx), Math.round(r.top + sy), Math.round(r.width), Math.round(r.height)]; }
  function shown(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) return false;
    if (cs.clip && cs.clip.indexOf('rect(0') === 0) return false;
    return true;
  }
  function parse(color) {
    var m = color && color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function blend(top, under) { var a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; }
  function lum(c) { var v = [c[0], c[1], c[2]].map(function (x) { x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); var hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); }
  function background(el) {
    var layers = [];
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      var c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    var base = [255, 255, 255, 1];
    for (var i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  }
  function hex(c) { return '#' + [c[0], c[1], c[2]].map(function (x) { return Math.round(x).toString(16).padStart(2, '0'); }).join(''); }
  function labelOf(el) { return ((el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('alt') || el.tagName.toLowerCase()) + '').trim().replace(/\s+/g, ' ').slice(0, 60); }

  var all = Array.prototype.slice.call(document.body ? document.body.querySelectorAll('*') : []).slice(0, 4000);
  var fonts = {}, sizes = {}, buttons = {};
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tag = el.tagName;
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|PATH|OPTION|TEMPLATE|IFRAME|CANVAS|VIDEO)$/.test(tag) || el.closest('svg')) continue;
    var own = '';
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) own += c.textContent;
    own = own.trim().replace(/\s+/g, ' ');
    if (own.length >= 2 && shown(el)) {
      var cs = getComputedStyle(el);
      var size = parseFloat(cs.fontSize) || 16;
      var family = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
      if (family && !/icon|awesome|material|glyph|symbol/i.test(family)) fonts[family] = (fonts[family] || 0) + 1;
      sizes[Math.round(size)] = (sizes[Math.round(size)] || 0) + 1;
      var fg = parse(cs.color);
      var bg = background(el);
      var disabled = el.closest('[disabled],[aria-disabled="true"]');
      if (fg && bg && !disabled) {
        var fgc = fg[3] < 1 ? blend(fg, bg) : fg;
        var r = ratio(fgc, bg);
        var bold = Number(cs.fontWeight) >= 700;
        var need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        if (r < need) out.contrast.push({ text: own.slice(0, 60), ratio: Math.round(r * 100) / 100, need: need, fg: hex(fgc), bg: hex(bg), size: Math.round(size), box: boxOf(el) });
      }
      if (size < 12 && own.length >= 4) out.smallText.push({ text: own.slice(0, 60), size: Math.round(size * 10) / 10, box: boxOf(el) });
    }
  }
  out.contrast.sort(function (a, b) { return a.ratio - b.ratio; });
  out.contrast = out.contrast.slice(0, 40);
  out.smallText = out.smallText.slice(0, 40);
  out.fonts = Object.keys(fonts).map(function (k) { return { family: k, count: fonts[k] }; }).filter(function (f) { return f.count >= 3; }).sort(function (a, b) { return b.count - a.count; });
  out.fontSizes = Object.keys(sizes).filter(function (k) { return sizes[k] >= 2; }).length;

  var targets = [];
  var controls = document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link]');
  for (var j = 0; j < controls.length && j < 1500; j++) {
    var ctl = controls[j];
    if (!shown(ctl)) continue;
    var rect = ctl.getBoundingClientRect();
    var isInlineLink = ctl.tagName === 'A' && getComputedStyle(ctl).display === 'inline' && ctl.parentElement && (ctl.parentElement.innerText || '').length > (ctl.innerText || '').length + 10;
    targets.push({ el: ctl, r: rect, small: !isInlineLink && (rect.width < 24 || rect.height < 24) });
    var cs2 = getComputedStyle(ctl);
    var looksButton = ctl.tagName === 'BUTTON' || ctl.getAttribute('role') === 'button' || (ctl.tagName === 'INPUT' && /submit|button/.test(ctl.type)) || /\b(btn|button)\b/i.test(ctl.className && ctl.className.baseVal === undefined ? ctl.className : '');
    if (looksButton) {
      var bgc = parse(cs2.backgroundColor);
      var key = (bgc && bgc[3] > 0 ? hex(bgc) : 'none') + '|' + Math.round(parseFloat(cs2.borderTopLeftRadius) || 0) + '|' + Math.round(parseFloat(cs2.fontSize) || 0);
      buttons[key] = 1;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(ctl.tagName) && !/submit|button|reset|image/.test(ctl.type || '')) {
      var named = ctl.getAttribute('aria-label') || ctl.getAttribute('aria-labelledby') || ctl.getAttribute('title') || ctl.closest('label') || (ctl.id && document.querySelector('label[for="' + CSS.escape(ctl.id) + '"]'));
      if (!named) out.unlabeledFields.push({ label: (ctl.getAttribute('placeholder') || ctl.getAttribute('name') || ctl.type || ctl.tagName.toLowerCase()).slice(0, 60), box: boxOf(ctl) });
    }
  }
  // WCAG 2.5.8: a small target is fine when a 24px circle on its centre touches no other target.
  for (var t = 0; t < targets.length; t++) {
    if (!targets[t].small) continue;
    var r1 = targets[t].r, cx = r1.left + r1.width / 2, cy = r1.top + r1.height / 2, crowded = false;
    for (var u = 0; u < targets.length && !crowded; u++) {
      if (u === t) continue;
      var r2 = targets[u].r;
      if (targets[u].el.contains(targets[t].el) || targets[t].el.contains(targets[u].el)) continue;
      if (targets[u].small) {
        var dx = r2.left + r2.width / 2 - cx, dy = r2.top + r2.height / 2 - cy;
        if (dx * dx + dy * dy < 24 * 24) crowded = true;
      } else {
        var nx = Math.max(r2.left, Math.min(cx, r2.right)), ny = Math.max(r2.top, Math.min(cy, r2.bottom));
        if ((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) < 12 * 12) crowded = true;
      }
    }
    if (crowded) out.tapTargets.push({ label: labelOf(targets[t].el), width: Math.round(r1.width), height: Math.round(r1.height), box: boxOf(targets[t].el) });
  }
  out.tapTargets = out.tapTargets.slice(0, 40);
  out.buttonStyles = Object.keys(buttons).length;

  if (out.docWidth > out.viewportWidth + 8) {
    for (var k = 0; k < all.length; k++) {
      var node = all[k];
      var rr = node.getBoundingClientRect();
      if (rr.right > out.viewportWidth + 8 && rr.width > 0 && rr.height > 0 && shown(node)) {
        var child = node.firstElementChild;
        var childWide = false;
        for (; child; child = child.nextElementSibling) if (child.getBoundingClientRect().right > out.viewportWidth + 8) { childWide = true; break; }
        if (!childWide) out.overflow.push({ label: node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (typeof node.className === 'string' && node.className ? '.' + node.className.trim().split(/\s+/)[0] : ''), right: Math.round(rr.right), box: boxOf(node) });
        if (out.overflow.length >= 5) break;
      }
    }
  }

  var images = document.images;
  for (var m = 0; m < images.length && m < 400; m++) {
    var img = images[m];
    if (!shown(img) || !img.complete || !img.naturalWidth) continue;
    var ir = img.getBoundingClientRect();
    var src = (img.currentSrc || img.src || '').slice(0, 200);
    if (/\.svg(\?|$)/i.test(src)) continue;
    if (!img.hasAttribute('alt') && ir.width >= 16 && ir.height >= 16) out.missingAlt.push({ src: src, box: boxOf(img) });
    var scale = (ir.width * out.dpr) / img.naturalWidth;
    if (ir.width >= 120 && scale > 1.6) out.blurryImages.push({ src: src, scale: Math.round(scale * 10) / 10, box: boxOf(img) });
    var fit = getComputedStyle(img).objectFit;
    var shownRatio = ir.width / ir.height, realRatio = img.naturalWidth / img.naturalHeight;
    if ((fit === 'fill' || !fit) && ir.width >= 60 && ir.height >= 60 && Math.abs(shownRatio / realRatio - 1) > 0.12) out.stretchedImages.push({ src: src, box: boxOf(img) });
  }
  out.missingAlt = out.missingAlt.slice(0, 20);
  out.blurryImages = out.blurryImages.slice(0, 10);
  out.stretchedImages = out.stretchedImages.slice(0, 10);
  out.h1Count = Array.prototype.filter.call(document.querySelectorAll('h1'), shown).length;
  return out;
})()`;

/** Total layout shift so far (Chromium only); null where the browser does not report it. */
export const LAYOUT_SHIFT_SCRIPT = String.raw`new Promise(function (resolve) {
  try {
    if (!window.PerformanceObserver || PerformanceObserver.supportedEntryTypes.indexOf('layout-shift') < 0) return resolve(null);
    var total = 0;
    var observer = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) { if (!entry.hadRecentInput) total += entry.value; });
    });
    observer.observe({ type: 'layout-shift', buffered: true });
    setTimeout(function () { observer.disconnect(); resolve(Math.round(total * 1000) / 1000); }, 300);
  } catch (e) { resolve(null); }
})`;

/** Scrolls down the page and back so lazy-loaded images are in place before the screenshot. */
export const PRELOAD_SCRIPT = String.raw`new Promise(function (resolve) {
  var y = 0, step = Math.max(400, window.innerHeight), limit = Math.min(document.documentElement.scrollHeight, 8000);
  var timer = setInterval(function () {
    y += step; window.scrollTo(0, y);
    if (y >= limit) { clearInterval(timer); window.scrollTo(0, 0); setTimeout(resolve, 400); }
  }, 120);
})`;
