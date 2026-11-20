import type { CDPSession, Page } from 'playwright';

/**
 * Streams what the audit browser is showing so people can watch a run live.
 *
 * Chromium's screencast pushes a JPEG whenever the page repaints; we keep the
 * newest one and hand it to `publish` at most `fps` times a second. Every frame
 * carries the action in progress and, when known, the box of the element being
 * acted on, so the dashboard can draw a highlight and a cursor on top.
 *
 * Streaming is best effort: if the screencast cannot start (non-Chromium, page
 * closed), the audit continues without it.
 */
export interface LiveAction {
  label: string;
  kind: 'navigate' | 'click' | 'type' | 'select' | 'assert' | 'observe' | 'wait' | 'info';
  /** Element box in CSS pixels of the viewport, if the action targets an element. */
  box?: { x: number; y: number; width: number; height: number } | null;
  phase?: string;
}

export interface LiveFrame {
  seq: number;
  at: string;
  url: string;
  viewport: { width: number; height: number };
  action: LiveAction | null;
  jpeg: Buffer;
}

export class LiveStreamer {
  private session: CDPSession | null = null;
  private page: Page | null = null;
  private latest: Buffer | null = null;
  private lastShot = 0;
  private action: LiveAction | null = null;
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private publishing = false;
  private dirty = false;

  constructor(
    private readonly publish: (frame: LiveFrame) => Promise<void>,
    private readonly options: { fps?: number; quality?: number; maxWidth?: number } = {},
  ) {}

  /** Starts (or moves) the stream to `page`. Safe to call again for a new page. */
  async attach(page: Page): Promise<void> {
    if (this.page === page && this.session) return;
    await this.detachSession();
    this.page = page;
    try {
      const session = await page.context().newCDPSession(page);
      this.session = session;
      session.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
        this.latest = Buffer.from(event.data, 'base64');
        this.dirty = true;
        void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
      });
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      await session.send('Page.startScreencast', {
        format: 'jpeg',
        quality: this.options.quality ?? 60,
        maxWidth: Math.min(viewport.width, this.options.maxWidth ?? 1280),
        maxHeight: viewport.height,
        everyNthFrame: 1,
      });
    } catch {
      this.session = null;
    }
    if (!this.timer) {
      const interval = Math.round(1000 / Math.max(0.5, Math.min(this.options.fps ?? 2, 5)));
      this.timer = setInterval(() => void this.flush(), interval);
      this.timer.unref?.();
    }
  }

  /** Records the action about to happen; the next frame shows it. */
  async setAction(action: LiveAction | null): Promise<void> {
    this.action = action;
    this.dirty = true;
    if (!this.latest && this.page) {
      // No repaint yet (static page): take one frame so the action is visible.
      this.latest = await this.page.screenshot({ type: 'jpeg', quality: this.options.quality ?? 60 }).catch(() => null);
    }
    await this.flush();
  }

  /** Box of the element a locator points at, in viewport pixels, or null. */
  static async boxOf(locator: { boundingBox: (options?: { timeout?: number }) => Promise<LiveAction['box']> }): Promise<LiveAction['box']> {
    try {
      return await locator.boundingBox({ timeout: 1_000 });
    } catch {
      return null;
    }
  }

  private async flush(): Promise<void> {
    // WebKit (Safari runs) has no screencast: take a plain screenshot instead, at most once a second.
    if (!this.session && this.page && !this.publishing && Date.now() - this.lastShot > 1000) {
      this.lastShot = Date.now();
      const shot = await this.page
        .screenshot({ type: 'jpeg', quality: this.options.quality ?? 60, timeout: 2000, animations: 'allow', caret: 'initial' })
        .catch(() => null);
      if (shot) {
        this.latest = shot;
        this.dirty = true;
      }
    }
    if (!this.dirty || this.publishing || !this.latest || !this.page) return;
    this.publishing = true;
    this.dirty = false;
    try {
      this.seq += 1;
      await this.publish({
        seq: this.seq,
        at: new Date().toISOString(),
        url: safeUrl(this.page),
        viewport: this.page.viewportSize() ?? { width: 1280, height: 720 },
        action: this.action,
        jpeg: this.latest,
      });
    } catch {
      /* streaming is best effort */
    } finally {
      this.publishing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    await this.detachSession();
    this.page = null;
  }

  private async detachSession(): Promise<void> {
    if (this.session) {
      await this.session.send('Page.stopScreencast').catch(() => undefined);
      await this.session.detach().catch(() => undefined);
      this.session = null;
    }
  }
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}
