import { AsyncLocalStorage } from 'node:async_hooks';
import { devices, type BrowserContextOptions } from 'playwright';

/**
 * The browser + screen an audit runs with. Set once per run with `runWithDevice`;
 * every BrowserManager created inside that call picks it up, so the crawler,
 * journeys, generated tests and reports all see the same device.
 */
export type AuditDevice = 'desktop' | 'phone' | 'safari' | 'iphone';

type Profile = { engine: 'chromium' | 'webkit'; mobile: boolean; context: BrowserContextOptions };

function descriptor(name: string): BrowserContextOptions {
  const found = devices[name];
  if (!found) return {};
  const { defaultBrowserType: _ignored, ...options } = found;
  return options;
}

export const DEVICE_PROFILES: Record<AuditDevice, Profile> = {
  desktop: { engine: 'chromium', mobile: false, context: {} },
  phone: { engine: 'chromium', mobile: true, context: descriptor('Pixel 7') },
  safari: {
    engine: 'webkit',
    mobile: false,
    context: { ...descriptor('Desktop Safari'), viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  },
  iphone: { engine: 'webkit', mobile: true, context: descriptor('iPhone 15') },
};

const store = new AsyncLocalStorage<AuditDevice>();

export function runWithDevice<T>(device: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const known = device && device in DEVICE_PROFILES ? (device as AuditDevice) : 'desktop';
  return store.run(known, fn);
}

export function currentDevice(): AuditDevice {
  return store.getStore() ?? 'desktop';
}

export function currentDeviceProfile(): Profile {
  return DEVICE_PROFILES[currentDevice()];
}

/**
 * Context options for the current device, merged with the caller's.
 * On a phone the device's own screen always wins: a caller asking for a
 * desktop viewport would otherwise undo the whole point of the run.
 */
export function deviceContextOptions(options: BrowserContextOptions = {}): BrowserContextOptions {
  const profile = currentDeviceProfile();
  const merged: BrowserContextOptions = { ...profile.context, ...options };
  if (profile.mobile) {
    merged.viewport = profile.context.viewport ?? null;
    merged.isMobile = true;
    merged.hasTouch = true;
  }
  if (profile.engine === 'webkit') {
    // WebKit rejects the Chromium-only option.
    delete (merged as { bypassCSP?: boolean }).bypassCSP;
  }
  return merged;
}

export class BrowserNotInstalledError extends Error {
  constructor(engine: string) {
    super(
      engine === 'webkit'
        ? 'Safari audits need the WebKit browser on the worker. Run: pnpm exec playwright install webkit'
        : `The ${engine} browser is not installed on the worker.`,
    );
    this.name = 'BrowserNotInstalledError';
  }
}
