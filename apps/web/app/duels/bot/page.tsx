'use client';

import type { JSX } from 'react';
import { DuelPlay } from '../duel-play';

/** Bot Duel vs Mira — 7 questions, practice only, no Rating change. */
export default function BotDuelPage(): JSX.Element {
  return (
    <DuelPlay
      kind="bot"
      title="Bot Duel vs Mira"
      blurb="7 questions, 15 seconds each. Practice only — your Rating never changes. Mira adapts to your Learning Rating."
    />
  );
}
