import Link from 'next/link';
import type { JSX } from 'react';

/** Landing — what Candle is, and where to start. */
export default function Home(): JSX.Element {
  return (
    <div className="py-10">
      <h1 className="text-4xl font-bold text-amber-300">Learn money, for real.</h1>
      <p className="mt-4 text-lg text-slate-300 max-w-2xl">
        Candle is a gamified way to learn personal finance from zero: short lessons, quizzes that
        actually test you, XP, streaks, and badges. No jargon walls, no tips, no hype.
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/tracks"
          className="bg-amber-400 text-slate-950 px-5 py-2.5 rounded font-medium hover:bg-amber-300"
        >
          Browse tracks
        </Link>
        <Link
          href="/register"
          className="border border-slate-600 px-5 py-2.5 rounded font-medium hover:border-slate-400"
        >
          Create account
        </Link>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          ['Short lessons', 'Bite-sized, plain-English lessons you can finish in minutes.'],
          ['Quizzes that count', 'Pass the quiz to unlock the next lesson. No skipping ahead.'],
          ['Streaks & XP', 'Daily progress builds streaks; completions earn XP and badges.'],
        ].map(([title, body]) => (
          <div key={title} className="border border-slate-800 rounded p-4 bg-slate-900/50">
            <h2 className="font-semibold text-slate-100">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
