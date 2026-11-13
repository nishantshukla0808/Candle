'use client';

import type { JSX } from 'react';
import { DuelPlay } from '../duel-play';

/** Async Daily Duel — 5 questions, the same set for everyone today, rated. */
export default function DailyDuelPage(): JSX.Element {
  return (
    <DuelPlay
      kind="daily"
      title="Daily Duel"
      blurb="5 questions, the same set for everyone today. Rated — one per day. You are paired with another player in order of finishing."
    />
  );
}
