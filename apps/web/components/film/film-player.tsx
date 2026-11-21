'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DemoFilm, FILM_DURATION, FILM_H, FILM_W } from './demo-film';

declare global {
  interface Window {
    __film?: { duration: number; seek: (t: number) => Promise<void> };
  }
}

/**
 * Plays the film in real time for preview, or (with ?render) waits for the
 * renderer to step it: window.__film.seek(t) draws the frame at t seconds.
 */
export function FilmPlayer() {
  const [t, setT] = useState(0);
  const [scale, setScale] = useState(1);
  const [render, setRender] = useState(false);
  const started = useRef(0);

  useEffect(() => {
    const rendering = new URLSearchParams(window.location.search).has('render');
    setRender(rendering);
    const fit = () => setScale(rendering ? 1 : Math.min(window.innerWidth / FILM_W, window.innerHeight / FILM_H));
    fit();
    window.addEventListener('resize', fit);
    window.__film = {
      duration: FILM_DURATION,
      seek: (time) =>
        new Promise((resolve) => {
          flushSync(() => setT(time));
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    };
    let frame = 0;
    if (!rendering) {
      const from = Number(new URLSearchParams(window.location.search).get('t') ?? 0);
      started.current = performance.now() - from * 1000;
      const tick = () => {
        setT(((performance.now() - started.current) / 1000) % FILM_DURATION);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
    };
  }, []);

  return (
    <div className="film-root" style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>
      <style>{`
        .film-root .film *, .film-root .film *::before, .film-root .film *::after { transition: none !important; animation: none !important; }
        nextjs-portal { display: none !important; }
        body { margin: 0; }
      `}</style>
      <div style={{ width: FILM_W, height: FILM_H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <DemoFilm t={t} />
      </div>
      {!render ? (
        <div style={{ position: 'fixed', left: 12, bottom: 8, color: '#888', font: '12px monospace' }}>{t.toFixed(2)} s</div>
      ) : null}
    </div>
  );
}
