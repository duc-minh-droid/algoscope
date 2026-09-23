import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlgorithmDef, Frame } from './types';

export const FRAME_CAP = 2500;

export interface Trace {
  frames: Frame<unknown>[];
  error?: string;
  truncated?: boolean;
}

export function collectFrames(def: AlgorithmDef, input: unknown): Trace {
  const frames: Frame<unknown>[] = [];
  try {
    for (const f of def.run(input)) {
      frames.push(f);
      if (frames.length >= FRAME_CAP) return { frames, truncated: true };
    }
  } catch (e) {
    return { frames, error: e instanceof Error ? e.message : String(e) };
  }
  return { frames };
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

/** ms between frames at a given speed. */
export const stepDelay = (speed: number) => 900 / speed;
/** ms used by visual transitions so motion finishes before the next frame. */
export const stepTransition = (speed: number) => Math.round(Math.min(620, stepDelay(speed) * 0.72));

export function usePlayer(total: number, resetKey: unknown, shouldBreak?: (index: number) => boolean) {
  const [index, setIndexRaw] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const breakRef = useRef(shouldBreak);
  breakRef.current = shouldBreak;

  useEffect(() => {
    setIndexRaw(0);
    setPlaying(false);
  }, [resetKey]);

  const setIndex = useCallback((i: number) => setIndexRaw(Math.max(0, Math.min(total - 1, i))), [total]);

  useEffect(() => {
    if (!playing) return;
    if (index >= total - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => {
      const next = index + 1;
      setIndexRaw(next);
      if (breakRef.current?.(next)) setPlaying(false);
    }, stepDelay(speed));
    return () => window.clearTimeout(t);
  }, [playing, index, speed, total]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && index >= total - 1) setIndexRaw(0);
      return !p;
    });
  }, [index, total]);

  const step = useCallback(
    (d: number) => {
      setPlaying(false);
      setIndex(index + d);
    },
    [index, setIndex],
  );

  const bumpSpeed = useCallback((d: number) => {
    setSpeed((s) => {
      const i = SPEEDS.indexOf(s as (typeof SPEEDS)[number]);
      return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + d))];
    });
  }, []);

  return useMemo(
    () => ({ index, playing, speed, setIndex, setPlaying, setSpeed, toggle, step, bumpSpeed }),
    [index, playing, speed, setIndex, toggle, step, bumpSpeed],
  );
}

export type Player = ReturnType<typeof usePlayer>;
