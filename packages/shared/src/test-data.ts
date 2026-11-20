/**
 * Field-aware test data. Picks a realistic value for a form control from its
 * type, name, label, placeholder, autocomplete hint and HTML constraints, so
 * exploration and generated tests can get past forms that reject "sample".
 *
 * Payment fields are never filled: `valueFor` returns `null` for card numbers,
 * CVCs and similar so callers skip them instead of typing anything.
 */

export interface FieldDescriptor {
  inputType?: string | null;
  name?: string | null;
  label?: string | null;
  placeholder?: string | null;
  autocomplete?: string | null;
  required?: boolean | null;
  min?: string | null;
  max?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
  tag?: string | null;
}

export interface TestDataOptions {
  /** Short unique token mixed into free-text values so they can be found again later. */
  token?: string;
  /** Overrides keyed by lower-cased field name, label or autocomplete hint. */
  overrides?: Record<string, string>;
}

type Kind =
  | 'payment'
  | 'secret'
  | 'email'
  | 'phone'
  | 'postal'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'company'
  | 'street'
  | 'city'
  | 'state'
  | 'country'
  | 'url'
  | 'quantity'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'month'
  | 'week'
  | 'color'
  | 'range'
  | 'search'
  | 'otp'
  | 'username'
  | 'message'
  | 'text';

const PAYMENT = /\b(card ?number|cardnumber|cc-?(number|num|csc|exp)|credit ?card|debit ?card|cvv|cvc|csc|security ?code|expir(y|ation)|iban|routing|account ?number|sort ?code|upi|vpa)\b/i;
const SECRET = /\b(ssn|social ?security|passport|aadhaa?r|pan ?(number|card)|tax ?id|national ?id)\b/i;

export function classifyField(field: FieldDescriptor): Kind {
  const type = (field.inputType ?? '').toLowerCase();
  const autocomplete = (field.autocomplete ?? '').toLowerCase();
  const hay = [field.name, field.label, field.placeholder, autocomplete]
    .filter(Boolean)
    .join(' ')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

  if (autocomplete.startsWith('cc-') || PAYMENT.test(hay)) return 'payment';
  if (SECRET.test(hay)) return 'secret';
  if (type === 'password') return 'secret';
  if (type === 'email' || autocomplete === 'email' || /\be-?mail\b/.test(hay)) return 'email';
  if (type === 'tel' || autocomplete.startsWith('tel') || /\b(phone|mobile|tel|contact number|whatsapp)\b/.test(hay)) return 'phone';
  if (/\b(zip|postal|post ?code|pin ?code|pincode)\b/.test(hay) || autocomplete === 'postal-code') return 'postal';
  if (/\b(otp|one time|verification code|2fa)\b/.test(hay) || autocomplete === 'one-time-code') return 'otp';
  if (type === 'url' || /\b(website|url|homepage)\b/.test(hay)) return 'url';
  if (type === 'date') return 'date';
  if (type === 'datetime-local') return 'datetime';
  if (type === 'time') return 'time';
  if (type === 'month') return 'month';
  if (type === 'week') return 'week';
  if (type === 'color') return 'color';
  if (type === 'range') return 'range';
  if (type === 'search' || /\bsearch\b/.test(hay)) return 'search';
  if (/\b(qty|quantity)\b/.test(hay)) return 'quantity';
  if (type === 'number') return 'number';
  if (autocomplete === 'given-name' || /\bfirst ?name|given ?name|fname\b/.test(hay)) return 'firstName';
  if (autocomplete === 'family-name' || /\blast ?name|surname|family ?name|lname\b/.test(hay)) return 'lastName';
  if (autocomplete === 'organization' || /\b(company|organi[sz]ation|business)\b/.test(hay)) return 'company';
  if (autocomplete.startsWith('address-line') || autocomplete === 'street-address' || /\b(address|street|line ?1|line ?2)\b/.test(hay)) return 'street';
  if (autocomplete === 'address-level2' || /\b(city|town)\b/.test(hay)) return 'city';
  if (autocomplete === 'address-level1' || /\b(state|province|region)\b/.test(hay)) return 'state';
  if (autocomplete === 'country' || autocomplete === 'country-name' || /\bcountry\b/.test(hay)) return 'country';
  if (autocomplete === 'username' || /\b(user ?name|login|handle)\b/.test(hay)) return 'username';
  if (autocomplete === 'name' || /\b(full ?name|your name|name)\b/.test(hay)) return 'fullName';
  if (field.tag === 'textarea' || /\b(message|comment|description|notes?|feedback|bio|about)\b/.test(hay)) return 'message';
  return 'text';
}

export function isPaymentField(field: FieldDescriptor): boolean {
  const kind = classifyField(field);
  return kind === 'payment';
}

/**
 * Returns the value to type into the field, or `null` when the field must be
 * left alone (payment and identity fields).
 */
export function valueFor(field: FieldDescriptor, options: TestDataOptions = {}): string | null {
  const token = options.token ?? 'qa';
  const override = lookupOverride(field, options.overrides);
  if (override !== undefined) {
    return override;
  }
  const kind = classifyField(field);
  let value: string | null;
  switch (kind) {
    case 'payment':
    case 'secret':
      return null;
    case 'email':
      value = `snaghunt+${token}@example.com`;
      break;
    case 'phone':
      value = '5550100123';
      break;
    case 'postal':
      value = /\bpin ?code|pincode\b/i.test(`${field.name} ${field.label} ${field.placeholder}`) ? '110001' : '10001';
      break;
    case 'otp':
      value = '000000';
      break;
    case 'url':
      value = 'https://example.com';
      break;
    case 'date':
      value = clampDate(isoDate(addDays(new Date(), 7)), field.min, field.max);
      break;
    case 'datetime':
      value = `${clampDate(isoDate(addDays(new Date(), 7)), field.min?.slice(0, 10), field.max?.slice(0, 10))}T10:00`;
      break;
    case 'time':
      value = '10:00';
      break;
    case 'month':
      value = isoDate(addDays(new Date(), 31)).slice(0, 7);
      break;
    case 'week':
      value = `${new Date().getUTCFullYear()}-W10`;
      break;
    case 'color':
      value = '#3366ff';
      break;
    case 'range':
    case 'quantity':
    case 'number':
      value = String(clampNumber(kind === 'quantity' ? 1 : 2, field.min, field.max));
      break;
    case 'search':
      value = token;
      break;
    case 'firstName':
      value = 'Ada';
      break;
    case 'lastName':
      value = `Tester ${token}`;
      break;
    case 'fullName':
      value = `Ada Tester ${token}`;
      break;
    case 'company':
      value = `Snaghunt ${token}`;
      break;
    case 'street':
      value = '221 Test Street';
      break;
    case 'city':
      value = 'Springfield';
      break;
    case 'state':
      value = 'CA';
      break;
    case 'country':
      value = 'United States';
      break;
    case 'username':
      value = `snaghunt_${token}`;
      break;
    case 'message':
      value = `Automated QA check ${token}. Please ignore.`;
      break;
    default:
      value = `Test ${token}`;
  }
  return fitLength(value, field);
}

function lookupOverride(field: FieldDescriptor, overrides?: Record<string, string>): string | undefined {
  if (!overrides) return undefined;
  for (const key of [field.name, field.label, field.autocomplete, field.placeholder]) {
    if (!key) continue;
    const hit = overrides[key.trim().toLowerCase()];
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function fitLength(value: string, field: FieldDescriptor): string {
  let out = value;
  if (field.maxLength && field.maxLength > 0 && out.length > field.maxLength) {
    out = out.slice(0, field.maxLength);
  }
  if (field.minLength && out.length < field.minLength) {
    out = out.padEnd(field.minLength, 'x');
  }
  if (field.pattern) {
    try {
      const re = new RegExp(`^(?:${field.pattern})$`);
      if (!re.test(out)) {
        const digits = /^\\d|\[0-9\]|\\d\{/.test(field.pattern);
        if (digits) {
          const count = Number(field.pattern.match(/\{(\d+)\}/)?.[1] ?? 6);
          const candidate = '1234567890'.repeat(3).slice(0, count);
          if (re.test(candidate)) return candidate;
        }
      }
    } catch {
      /* invalid pattern in the page: ignore */
    }
  }
  return out;
}

function clampNumber(preferred: number, min?: string | null, max?: string | null): number {
  let value = preferred;
  const lo = min !== undefined && min !== null && min !== '' ? Number(min) : NaN;
  const hi = max !== undefined && max !== null && max !== '' ? Number(max) : NaN;
  if (!Number.isNaN(lo) && value < lo) value = lo;
  if (!Number.isNaN(hi) && value > hi) value = hi;
  return value;
}

function clampDate(value: string, min?: string | null, max?: string | null): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}
