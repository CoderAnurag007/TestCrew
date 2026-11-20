'use client';

import { useEffect, useRef } from 'react';

/**
 * Cross-page "open this dialog" signals. The shell either fires the event when
 * the target page is already mounted, or navigates there with a query flag the
 * page reads once on mount.
 */
export const NEW_PROJECT_EVENT = 'testcrew:new-project';
export const NEW_WORKSPACE_EVENT = 'testcrew:new-workspace';

export const NEW_PROJECT_FLAG = 'new';
export const NEW_WORKSPACE_FLAG = 'workspace';

/** Reads `?flag=1` once and removes it from the address bar. */
export function consumeQueryFlag(flag: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get(flag) !== '1') {
    return false;
  }
  url.searchParams.delete(flag);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}

/** Calls `onOpen` when the event fires, or once on mount if `?flag=1` is present. */
export function useOpenSignal(event: string, flag: string, onOpen: () => void, enabled = true) {
  const handler = useRef(onOpen);
  useEffect(() => {
    handler.current = onOpen;
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const listener = () => handler.current();
    window.addEventListener(event, listener);
    let timer: number | undefined;
    if (consumeQueryFlag(flag)) {
      timer = window.setTimeout(listener, 0);
    }
    return () => {
      window.removeEventListener(event, listener);
      if (timer) window.clearTimeout(timer);
    };
  }, [event, flag, enabled]);
}
