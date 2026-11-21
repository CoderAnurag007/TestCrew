'use client';

import { useEffect, useState } from 'react';

/** How long the opening plays before the page underneath takes over (keep in step with motion.css). */
const INTRO_MS = 2900;
/** When the opening started in this page load; survives React remounting the component. */
let startedAt = 0;

function setIntro(state: 'play' | 'played' | 'done') {
  document.documentElement.setAttribute('data-intro', state);
}

/**
 * The opening on the front page, once per browser tab: the inspection frame
 * appears, its work lamp flickers on, the shift clocks in, and the night
 * opens like a shutter onto the page. A click, key or scroll skips it.
 * Whether it plays is decided before the first paint (see the root layout),
 * so the page never flashes underneath it.
 *
 * data-intro on <html>: "play" while it runs, "played" once it has (the page
 * keeps its setup timing so nothing jumps), "done" to set the page up at once.
 */
export function IntroCurtain() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const state = document.documentElement.getAttribute('data-intro');
    if (state === 'played') {
      // Back on the front page later: no opening, set up straight away.
      setIntro('done');
    }
    if (state !== 'play') {
      setVisible(false);
      return;
    }
    if (!startedAt) startedAt = performance.now();
    const left = INTRO_MS - (performance.now() - startedAt);
    if (left <= 0) {
      setVisible(false);
      return;
    }
    const skip = () => {
      setIntro('done');
      setVisible(false);
    };
    const timer = window.setTimeout(() => {
      setIntro('played');
      setVisible(false);
    }, left);
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('wheel', skip, { once: true, passive: true });
    window.addEventListener('touchmove', skip, { once: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('wheel', skip);
      window.removeEventListener('touchmove', skip);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="intro"
      aria-hidden
      onClick={() => {
        setIntro('done');
        setVisible(false);
      }}
    >
      <div className="intro-half intro-half-top" />
      <div className="intro-half intro-half-bottom" />
      <div className="intro-seam" />
      <div className="intro-core">
        <div className="intro-glow" />
        <div className="intro-frame">
          <i className="intro-corner intro-corner-tl" />
          <i className="intro-corner intro-corner-tr" />
          <i className="intro-corner intro-corner-bl" />
          <i className="intro-corner intro-corner-br" />
          <i className="intro-lamp" />
        </div>
        <div className="intro-word">
          {'SNAGHUNT'.split('').map((letter, index) => (
            <span key={index} style={{ '--i': index } as React.CSSProperties}>
              {letter}
            </span>
          ))}
        </div>
        <div className="intro-meta">
          <span>Night shift · clocking in</span>
          <span className="intro-count" />
        </div>
        <div className="intro-bar">
          <i />
        </div>
      </div>
    </div>
  );
}
