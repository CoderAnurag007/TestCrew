import { promises as dns } from 'node:dns';
import { assertSafeNavigationTarget } from './ssrf.js';

/**
 * Proof that whoever configured a project controls the target domain. Required
 * before an audit may send mutating requests (FULL safety mode) to a public host.
 *
 * Either of these passes:
 *   - DNS TXT record on `_testcrew.<host>` containing `testcrew-verify=<token>`
 *   - `https://<host>/.well-known/testcrew-verification.txt` containing `<token>`
 */
export interface VerificationResult {
  verified: boolean;
  method?: 'dns' | 'http';
  host: string;
  detail: string;
}

export function verificationRecordName(host: string): string {
  return `_testcrew.${host.replace(/:\d+$/, '')}`;
}

export async function verifyDomainOwnership(input: {
  baseUrl: string;
  token: string;
  allowPrivate?: boolean;
  resolveTxt?: (name: string) => Promise<string[][]>;
  fetchImpl?: typeof fetch;
  /** Address lookup used by the SSRF check before fetching the file; tests inject a fake. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}): Promise<VerificationResult> {
  const parsed = new URL(input.baseUrl);
  const host = parsed.host.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const expected = `testcrew-verify=${input.token}`;

  const resolveTxt = input.resolveTxt ?? ((name: string) => dns.resolveTxt(name));
  try {
    const records = await resolveTxt(verificationRecordName(hostname));
    if (records.some((chunks) => chunks.join('').trim() === expected)) {
      return { verified: true, method: 'dns', host, detail: `TXT ${verificationRecordName(hostname)} matched` };
    }
  } catch {
    /* fall through to HTTP */
  }

  const fileUrl = `${parsed.protocol}//${host}/.well-known/testcrew-verification.txt`;
  try {
    await assertSafeNavigationTarget(fileUrl, { allowPrivate: input.allowPrivate ?? false, resolver: input.resolveHost });
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(fileUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: { 'user-agent': 'TestCrew-Verifier/1.0' },
    });
    if (response.ok) {
      const body = (await response.text()).slice(0, 4096);
      if (body.split(/\s+/).includes(input.token) || body.includes(expected)) {
        return { verified: true, method: 'http', host, detail: `${fileUrl} matched` };
      }
      return { verified: false, host, detail: `${fileUrl} did not contain the token` };
    }
    return { verified: false, host, detail: `${fileUrl} returned HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    return { verified: false, host, detail: `No DNS record and ${fileUrl} failed: ${message}` };
  }
}
