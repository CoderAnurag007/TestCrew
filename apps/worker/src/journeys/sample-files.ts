import { deflateSync } from 'node:zlib';

/**
 * Small, valid sample files for testing online file tools. Everything is
 * generated in code (nothing is downloaded), so the audit never hands a
 * stranger's site a file it did not write itself. Formats that are easiest to
 * produce in a real browser (JPEG, WebP, WebM) are made there instead; see
 * BROWSER_SAMPLE_SCRIPT.
 */

export interface SampleFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/* ------------------------------- helpers ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with stored (uncompressed) entries: enough for DOCX and XLSX. */
export function zip(entries: Array<{ name: string; data: string | Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/* -------------------------------- images -------------------------------- */

/** A 160×120 PNG: a light background, a dark block and a coloured stripe, so image tools have content to work on. */
export function png(width = 160, height = 120): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = row + 1 + x * 4;
      const block = x > width * 0.25 && x < width * 0.6 && y > height * 0.3 && y < height * 0.75;
      const stripe = y > height * 0.82;
      raw[i] = block ? 30 : stripe ? 36 : 236 - Math.round((x / width) * 40);
      raw[i + 1] = block ? 64 : stripe ? 120 : 238;
      raw[i + 2] = block ? 96 : stripe ? 214 : 240 - Math.round((y / height) * 30);
      raw[i + 3] = 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 1×1 GIF. */
export const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

export const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" fill="#eef0f2"/><rect x="40" y="36" width="56" height="54" fill="#1e4060"/><text x="10" y="112" font-family="Arial" font-size="12">TestCrew sample</text></svg>`;

/* --------------------------------- PDF ---------------------------------- */

/** A text PDF with the given pages (Helvetica, Latin-1 only). */
export function pdf(pages: string[] = ['TestCrew sample document', 'Second page']): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, index) => {
    const pageId = pageIds[index]!;
    const stream = `BT /F1 24 Tf 72 720 Td (${escape(text)}) Tj ET\nBT /F1 12 Tf 72 690 Td (Page ${index + 1} of ${pages.length}. Generated by TestCrew to test this tool.) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/* -------------------------------- audio --------------------------------- */

/** One second of a 440 Hz tone, 16-bit mono WAV. */
export function wav(seconds = 1, rate = 16_000): Buffer {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3 * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/* ---------------------------- office documents ---------------------------- */

export function docx(): Buffer {
  const paragraph = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  return zip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph('TestCrew sample document', 'Heading1')}${paragraph('This document was generated by TestCrew to check that the tool converts a simple Word file.')}${paragraph('Second paragraph with plain text.')}</w:body></w:document>`,
    },
  ]);
}

export function xlsx(): Buffer {
  const cell = (ref: string, value: string | number) =>
    typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const rows = [
    ['Item', 'Quantity', 'Price'],
    ['Sample A', 2, 4.5],
    ['Sample B', 1, 12],
  ]
    .map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cell(`${String.fromCharCode(65 + c)}${r + 1}`, value)).join('')}</row>`)
    .join('');
  return zip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    },
  ]);
}

/* ------------------------------ catalogue ------------------------------- */

export interface SampleKind {
  /** File extension without the dot. */
  ext: string;
  mimeType: string;
  /** Words in a tool's address that ask for this kind ("word-to-pdf" → docx). */
  keywords: RegExp;
  /** Made by the browser (canvas / MediaRecorder) rather than in Node. */
  browser?: 'image/jpeg' | 'image/webp' | 'video/webm';
  make?: () => Buffer;
}

export const SAMPLE_KINDS: SampleKind[] = [
  { ext: 'pdf', mimeType: 'application/pdf', keywords: /\bpdf\b/, make: () => pdf() },
  { ext: 'png', mimeType: 'image/png', keywords: /\bpng\b|\bimage\b/, make: () => png() },
  { ext: 'jpg', mimeType: 'image/jpeg', keywords: /\bjpe?g\b|\bphoto\b/, browser: 'image/jpeg' },
  { ext: 'webp', mimeType: 'image/webp', keywords: /\bwebp\b/, browser: 'image/webp' },
  { ext: 'gif', mimeType: 'image/gif', keywords: /\bgif\b/, make: () => GIF },
  { ext: 'svg', mimeType: 'image/svg+xml', keywords: /\bsvg\b/, make: () => Buffer.from(SVG) },
  { ext: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', keywords: /\b(word|docx?)\b/, make: () => docx() },
  { ext: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', keywords: /\b(excel|xlsx?|spreadsheet)\b/, make: () => xlsx() },
  { ext: 'csv', mimeType: 'text/csv', keywords: /\bcsv\b/, make: () => Buffer.from('item,quantity,price\nSample A,2,4.50\nSample B,1,12.00\n') },
  { ext: 'json', mimeType: 'application/json', keywords: /\bjson\b/, make: () => Buffer.from(JSON.stringify({ name: 'TestCrew sample', items: [{ id: 1, qty: 2 }, { id: 2, qty: 1 }] }, null, 2)) },
  { ext: 'html', mimeType: 'text/html', keywords: /\bhtml?\b/, make: () => Buffer.from('<!doctype html><html><body><h1>TestCrew sample</h1><p>Generated to test this tool.</p></body></html>') },
  { ext: 'md', mimeType: 'text/markdown', keywords: /\b(markdown|md)\b/, make: () => Buffer.from('# TestCrew sample\n\nGenerated to test this tool.\n\n- one\n- two\n') },
  { ext: 'xml', mimeType: 'application/xml', keywords: /\bxml\b/, make: () => Buffer.from('<?xml version="1.0"?><sample><name>TestCrew</name></sample>') },
  { ext: 'txt', mimeType: 'text/plain', keywords: /\b(txt|text)\b/, make: () => Buffer.from('TestCrew sample text.\nSecond line of the sample.\n') },
  { ext: 'wav', mimeType: 'audio/wav', keywords: /\b(wav|audio|sound|mp3|voice)\b/, make: () => wav() },
  { ext: 'webm', mimeType: 'video/webm', keywords: /\b(webm|video|mp4|movie|clip)\b/, browser: 'video/webm' },
];

/** Does an `accept` attribute allow this kind? An empty accept allows anything. */
export function acceptAllows(accept: string, kind: Pick<SampleKind, 'ext' | 'mimeType'>): boolean {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  const exts = kind.ext === 'jpg' ? ['.jpg', '.jpeg'] : kind.ext === 'md' ? ['.md', '.markdown'] : [`.${kind.ext}`];
  return tokens.some((token) => {
    if (token.startsWith('.')) return exts.includes(token);
    if (token.endsWith('/*')) return kind.mimeType.startsWith(token.slice(0, -1));
    return token === kind.mimeType || (kind.ext === 'wav' && /^audio\/(x-)?wav(e)?$/.test(token));
  });
}

/**
 * The sample to use for a tool: the format named in its address (the part
 * before "-to-" when there is one), else the section's usual format, as long
 * as the input's `accept` allows it.
 */
export function chooseSample(path: string, accept: string): SampleKind | null {
  const slug = (path.split('/').filter(Boolean).pop() ?? '').toLowerCase().replace(/[-_]/g, ' ');
  const section = (path.split('/').filter(Boolean)[0] ?? '').toLowerCase();
  const source = slug.includes(' to ') ? slug.split(' to ')[0]! : slug;
  const allowed = SAMPLE_KINDS.filter((kind) => acceptAllows(accept, kind));
  return (
    allowed.find((kind) => kind.keywords.test(source)) ??
    allowed.find((kind) => kind.keywords.test(section)) ??
    allowed.find((kind) => kind.keywords.test(slug)) ??
    (accept.trim() ? allowed[0] ?? null : null)
  );
}

/** The output format a tool promises in its address ("png-to-jpg" → jpg), if any. */
export function expectedOutput(path: string): string | null {
  const slug = (path.split('/').filter(Boolean).pop() ?? '').toLowerCase();
  const match = /-to-([a-z0-9]+)/.exec(slug);
  if (!match) return null;
  const target = match[1]!;
  // Format names in addresses are often words, not extensions ("pdf-to-word").
  const named: Record<string, string | null> = {
    jpeg: 'jpg',
    word: 'docx',
    doc: 'docx',
    excel: 'xlsx',
    xls: 'xlsx',
    powerpoint: 'pptx',
    ppt: 'pptx',
    text: 'txt',
    markdown: 'md',
    htm: 'html',
    // Too broad to name one extension.
    image: null,
    images: null,
    audio: null,
    video: null,
  };
  if (target in named) return named[target]!;
  // Only real formats: "compress-video-to-25mb" names a size, not a file type.
  return KNOWN_FORMATS.has(target) ? target : null;
}

const KNOWN_FORMATS = new Set([
  'pdf', 'jpg', 'png', 'webp', 'gif', 'svg', 'bmp', 'tiff', 'tif', 'ico', 'avif', 'heic',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'rtf', 'epub',
  'txt', 'csv', 'json', 'xml', 'html', 'md', 'yaml', 'yml', 'sql', 'base64',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'wma',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'zip',
]);

export function extensionMatches(fileName: string, expected: string): boolean {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const same = (a: string) => (a === 'jpeg' ? 'jpg' : a === 'htm' ? 'html' : a === 'markdown' ? 'md' : a);
  // Multi-file outputs often arrive as a ZIP of the converted files.
  return same(ext) === same(expected) || ext === 'zip';
}

/** Runs in the page: draws a sample and returns it as base64 in the requested type. */
export const BROWSER_SAMPLE_SCRIPT = `async (type) => {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 120;
  const g = canvas.getContext('2d');
  const paint = (t) => {
    g.fillStyle = '#eef0f2'; g.fillRect(0, 0, 160, 120);
    g.fillStyle = '#1e4060'; g.fillRect(40 + (t % 40), 36, 56, 54);
    g.fillStyle = '#2478d6'; g.fillRect(0, 100, 160, 20);
  };
  paint(0);
  const toBase64 = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob); });
  if (type === 'video/webm') {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('video/webm')) return null;
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    let t = 0;
    const timer = setInterval(() => paint((t += 4)), 60);
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start(200);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    recorder.stop();
    await done;
    clearInterval(timer);
    return toBase64(new Blob(chunks, { type: 'video/webm' }));
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  return blob ? toBase64(blob) : null;
}`;
