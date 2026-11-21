import { notFound } from 'next/navigation';
import { FilmPlayer } from '@/components/film/film-player';

export const metadata = { title: 'Demo film', robots: { index: false } };

/** Where the "How it works" film is made. Not part of the live site. */
export default function FilmPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FilmPlayer />;
}
