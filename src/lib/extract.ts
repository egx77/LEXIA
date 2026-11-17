import JSZip from 'jszip';

/**
 * Pilot upload allowlist (DEV-203 pending — values are placeholders for review).
 * PDF text extraction/OCR provider is not selected: PDFs are stored as originals only.
 */
export const UPLOAD_ALLOWLIST: Record<string, string> = {
  'text/plain': '.txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/pdf': '.pdf',
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function mimeFor(filename: string, declared?: string): string | null {
  const lower = filename.toLowerCase();
  for (const [mime, ext] of Object.entries(UPLOAD_ALLOWLIST)) {
    if (lower.endsWith(ext)) return mime;
  }
  return declared && UPLOAD_ALLOWLIST[declared] ? declared : null;
}

/** Basic content sniffing so an extension alone cannot smuggle another file type. */
export function sniffOk(mime: string, bytes: Uint8Array): boolean {
  const head = Array.from(bytes.slice(0, 5));
  if (mime === 'application/pdf') return String.fromCharCode(...head) === '%PDF-';
  if (mime.includes('wordprocessingml')) return head[0] === 0x50 && head[1] === 0x4b; // PK zip
  if (mime === 'text/plain') return !bytes.slice(0, 4096).includes(0);
  return false;
}

export async function extractText(mime: string, bytes: Uint8Array): Promise<{ text: string | null; status: 'ok' | 'failed' | 'not_supported' }> {
  try {
    if (mime === 'text/plain') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\r\n/g, '\n');
      return text.trim() ? { text, status: 'ok' } : { text: null, status: 'failed' };
    }
    if (mime.includes('wordprocessingml')) {
      const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file('word/document.xml')?.async('string');
      if (!xml) return { text: null, status: 'failed' };
      const paras = xml.split(/<\/w:p>/).map((p) =>
        Array.from(p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)).map((m) => decodeXml(m[1])).join(''));
      const text = paras.filter((p) => p.trim()).join('\n\n');
      return text.trim() ? { text, status: 'ok' } : { text: null, status: 'failed' };
    }
    return { text: null, status: 'not_supported' };
  } catch {
    return { text: null, status: 'failed' };
  }
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
