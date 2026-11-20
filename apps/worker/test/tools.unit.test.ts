import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SemanticPage } from '@auditor/shared';
import { isSkipLink } from '@auditor/test-engine';
import { detectCategory } from '../src/journeys/detect.js';
import {
  acceptAllows,
  chooseSample,
  crc32,
  docx,
  expectedOutput,
  extensionMatches,
  pdf,
  png,
  SAMPLE_KINDS,
  wav,
  xlsx,
} from '../src/journeys/sample-files.js';

const kind = (ext: string) => SAMPLE_KINDS.find((item) => item.ext === ext)!;

describe('sample files', () => {
  it('builds a PDF whose cross-reference table points at real objects', () => {
    const text = pdf(['One', 'Two']).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
    expect(text).toContain('/Count 2');
  });

  it('builds a PNG with valid chunk checksums and image data', () => {
    const image = png(20, 10);
    expect(image.subarray(1, 4).toString('ascii')).toBe('PNG');
    let at = 8;
    const types: string[] = [];
    while (at < image.length) {
      const length = image.readUInt32BE(at);
      const type = image.subarray(at + 4, at + 8);
      const data = image.subarray(at + 8, at + 8 + length);
      expect(image.readUInt32BE(at + 8 + length)).toBe(crc32(Buffer.concat([type, data])));
      if (type.toString() === 'IDAT') expect(inflateSync(data).length).toBe((20 * 4 + 1) * 10);
      types.push(type.toString());
      at += 12 + length;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('builds a WAV with a correct header', () => {
    const audio = wav(0.5, 8000);
    expect(audio.subarray(0, 4).toString()).toBe('RIFF');
    expect(audio.readUInt32LE(4)).toBe(audio.length - 8);
    expect(audio.readUInt32LE(40)).toBe(8000);
  });

  it('builds Word and Excel files as ZIP archives with the required parts', () => {
    for (const [file, part] of [
      [docx(), 'word/document.xml'],
      [xlsx(), 'xl/worksheets/sheet1.xml'],
    ] as const) {
      expect(file.readUInt32LE(0)).toBe(0x04034b50);
      expect(file.readUInt32LE(file.length - 22)).toBe(0x06054b50);
      expect(file.toString('latin1')).toContain('[Content_Types].xml');
      expect(file.toString('latin1')).toContain(part);
    }
  });
});

describe('choosing a sample for a tool', () => {
  it('reads accept attributes like the browser does', () => {
    expect(acceptAllows('', kind('pdf'))).toBe(true);
    expect(acceptAllows('.pdf,application/pdf', kind('pdf'))).toBe(true);
    expect(acceptAllows('image/*', kind('png'))).toBe(true);
    expect(acceptAllows('image/*', kind('pdf'))).toBe(false);
    expect(acceptAllows('.jpeg', kind('jpg'))).toBe(true);
    expect(acceptAllows('audio/x-wav', kind('wav'))).toBe(true);
  });

  it('uses the format named in the address, within what the input accepts', () => {
    expect(chooseSample('/pdf/word-to-pdf', '.docx')?.ext).toBe('docx');
    expect(chooseSample('/image/png-to-jpg', 'image/png')?.ext).toBe('png');
    expect(chooseSample('/image/jpg-to-png', 'image/jpeg,.jpg')?.ext).toBe('jpg');
    expect(chooseSample('/pdf/merge-pdf', 'application/pdf')?.ext).toBe('pdf');
    expect(chooseSample('/image/resize', 'image/*')?.ext).toBe('png');
    expect(chooseSample('/audio/trim', 'audio/*')?.ext).toBe('wav');
    expect(chooseSample('/pdf/excel-to-pdf', '.xlsx,.csv')?.ext).toBe('xlsx');
    // Nothing Snaghunt can make: no sample rather than a wrong one.
    expect(chooseSample('/pdf/pptx-to-pdf', '.pptx')).toBeNull();
  });

  it('knows the promised output and accepts zipped batches', () => {
    expect(expectedOutput('/image/png-to-jpeg')).toBe('jpg');
    expect(expectedOutput('/pdf/compress')).toBeNull();
    expect(expectedOutput('/pdf/pdf-to-word')).toBe('docx');
    expect(expectedOutput('/pdf/pdf-to-image')).toBeNull();
    expect(expectedOutput('/video/compress-video-to-25mb')).toBeNull();
    expect(expectedOutput('/audio/wav-to-mp3')).toBe('mp3');
    expect(extensionMatches('photo.jpeg', 'jpg')).toBe(true);
    expect(extensionMatches('files.zip', 'pdf')).toBe(true);
    expect(extensionMatches('doc.docx', 'pdf')).toBe(false);
  });
});

describe('category detection for online tools', () => {
  const page = (route: string, elements: Array<{ text: string; href?: string; inputType?: string }>): SemanticPage =>
    ({
      url: `https://tools.test${route}`,
      title: 'Tools',
      route,
      importantText: ['Free online tools. Convert, compress and merge files in your browser. Settings and dashboard.'],
      contentSignature: '',
      listItems: [],
      elements: elements.map((el) => ({ text: el.text, label: el.text, href: el.href ?? null, inputType: el.inputType ?? null })),
    }) as unknown as SemanticPage;

  it('prefers "tools" over SaaS when pages carry file pickers and converter links', () => {
    const links = ['word-to-pdf', 'png-to-jpg', 'jpg-to-png', 'pdf-to-text'].map((slug) => ({ text: slug, href: `/x/${slug}` }));
    const pages = [
      page('/', [...links, { text: 'Create', href: '/new' }]),
      page('/pdf/word-to-pdf', [{ text: 'Choose file', inputType: 'file' }]),
      page('/image/png-to-jpg', [{ text: 'Choose file', inputType: 'file' }]),
    ];
    const result = detectCategory(pages);
    expect(result.category).toBe('tools');
    expect(result.signals.join(' ')).toMatch(/file pickers/);
    // The winning type's reasons are listed first.
    expect(result.signals[0]).toMatch(/file pickers|converter|convert/);
  });
});

describe('generated tests', () => {
  it('recognises skip links', () => {
    expect(isSkipLink('Skip to content', '#main')).toBe(true);
    expect(isSkipLink('Skip navigation', null)).toBe(true);
    expect(isSkipLink('Skip to content', '/content')).toBe(false);
    expect(isSkipLink('Pricing', '#pricing')).toBe(false);
  });
});
