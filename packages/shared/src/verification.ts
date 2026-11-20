import { promises as dns } from 'node:dns';
import { assertSafeNavigationTarget } from './ssrf.js';

/**
 * Proof that whoever configured a project controls the target domain. Required
 * before an audit may send mutating requests (FULL safety mode) to a public host.
 *
 * Either of these passes:
 *   - DNS TXT record on `_snaghunt.<host>` containing `snaghunt-verify=<token>`
 *   - `https://<host>/.well-known/snaghunt-verification.txt` containing `<token>`
 */
export interface VerificationResult {
  verified: boolean;
  method?: 'dns' | 'http';
  host: string;
  detail: string;
}

/** The product's former name, for records created before the rename. */
const LEGACY = 'testcrew';

export function verificationRecordName(host: string): string {
  return `_snaghunt.${host.replace(/:\d+$/, '')}`;
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
  const expected = `snaghunt-verify=${input.token}`;

  const resolveTxt = input.resolveTxt ?? ((name: string) => dns.resolveTxt(name));
  // The product was called TestCrew before; records set up under that name still count.
  const dnsChecks = [
    { name: verificationRecordName(hostname), value: expected },
    { name: `_${LEGACY}.${hostname.replace(/:\d+$/, '')}`, value: `${LEGACY}-verify=${input.token}` },
  ];
  for (const check of dnsChecks) {
    try {
      const records = await resolveTxt(check.name);
      if (records.some((chunks) => chunks.join('').trim() === check.value)) {
        return { verified: true, method: 'dns', host, detail: `TXT ${check.name} matched` };
      }
    } catch {
      /* try the next record, then HTTP */
    }
  }

  const fileUrl = `${parsed.protocol}//${host}/.well-known/snaghunt-verification.txt`;
  const legacyUrl = `${parsed.protocol}//${host}/.well-known/${LEGACY}-verification.txt`;
  try {
    await assertSafeNavigationTarget(fileUrl, { allowPrivate: input.allowPrivate ?? false, resolver: input.resolveHost });
    const fetchImpl = input.fetchImpl ?? fetch;
    let lastDetail = '';
    for (const url of [fileUrl, legacyUrl]) {
      const response = await fetchImpl(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
        headers: { 'user-agent': 'Snaghunt-Verifier/1.0' },
      });
      if (response.ok) {
        const body = (await response.text()).slice(0, 4096);
        if (body.split(/\s+/).includes(input.token) || body.includes(expected) || body.includes(`${LEGACY}-verify=${input.token}`)) {
          return { verified: true, method: 'http', host, detail: `${url} matched` };
        }
        lastDetail = `${url} did not contain the token`;
      } else if (!lastDetail) {
        lastDetail = `${url} returned HTTP ${response.status}`;
      }
    }
    return { verified: false, host, detail: lastDetail };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    return { verified: false, host, detail: `No DNS record and ${fileUrl} failed: ${message}` };
  }
}
