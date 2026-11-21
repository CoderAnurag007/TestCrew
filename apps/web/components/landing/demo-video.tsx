'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/**
 * The 40-second "how an audit runs" film, full width. It plays (muted, looped)
 * while it is on screen and pauses when scrolled away. With reduced motion it
 * waits for a click. Made by apps/web/scripts/render-film.mjs from app/film.
 */
export function DemoVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting && !userPaused) void element.play().catch(() => undefined);
        else element.pause();
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [userPaused]);

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      setUserPaused(false);
      void element.play().catch(() => undefined);
    } else {
      setUserPaused(true);
      element.pause();
    }
  };

  return (
    <figure className="relative overflow-hidden rounded-xl border border-[var(--night-line)] bg-black shadow-[0_40px_100px_-40px_rgb(0_0_0/0.9)]">
      <video
        ref={video}
        className="block aspect-video w-full cursor-pointer"
        src="/media/how-it-works.mp4?v=2"
        poster="/media/how-it-works-poster.jpg?v=2"
        muted
        loop
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onClick={toggle}
        aria-label="A 40-second film of an audit: adding a site, the live audit trying every control, tests running, a bug with its evidence and ticket, and the design review."
      />
      {!playing ? (
        <button
          type="button"
          onClick={toggle}
          className="absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--night-ink)] text-black shadow-lg transition-transform hover:scale-105"
          aria-label="Play the film"
        >
          <Play className="ml-1 size-8" fill="currentColor" />
        </button>
      ) : (
        <button
          type="button"
          onClick={toggle}
          className="absolute bottom-4 right-4 flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3.5 text-[13px] font-medium text-white backdrop-blur hover:bg-black/80"
          aria-label="Pause the film"
        >
          <Pause className="size-3.5" fill="currentColor" /> Pause
        </button>
      )}
    </figure>
  );
}
