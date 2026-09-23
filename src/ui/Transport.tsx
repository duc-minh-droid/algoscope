import { useRef, useState, type PointerEvent } from 'react';
import { SPEEDS, type Player } from '@/core/player';
import { IconFirst, IconKeyboard, IconLast, IconPause, IconPlay, IconStepBack, IconStepFwd } from './icons';

export interface TimelineMark {
  index: number;
  label: string;
}

export function Transport({ player, total, marks, breakIdx }: { player: Player; total: number; marks: TimelineMark[]; breakIdx: number[] }) {
  const { index, playing, speed } = player;
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const pct = total > 1 ? (index / (total - 1)) * 100 : 100;
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (total - 1));
  };
  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    player.setPlaying(false);
    player.setIndex(at(e.clientX));
  };
  const markAt = (i: number) => [...marks].reverse().find((m) => m.index <= i)?.label;

  return (
    <div className="transport">
      <div className="transport-btns">
        <button className="tbtn" onClick={() => player.step(-Infinity)} disabled={index === 0} aria-label="First step">
          <IconFirst />
        </button>
        <button className="tbtn" onClick={() => player.step(-1)} disabled={index === 0} aria-label="Previous step">
          <IconStepBack />
        </button>
        <button className={`tbtn play ${playing ? 'is-playing' : ''}`} onClick={player.toggle} aria-label={playing ? 'Pause' : 'Play'}>
          <span className="play-icons">
            <IconPlay className="i-play" width={20} height={20} />
            <IconPause className="i-pause" width={20} height={20} />
          </span>
        </button>
        <button className="tbtn" onClick={() => player.step(1)} disabled={index >= total - 1} aria-label="Next step">
          <IconStepFwd />
        </button>
        <button className="tbtn" onClick={() => player.step(Infinity)} disabled={index >= total - 1} aria-label="Last step">
          <IconLast />
        </button>
      </div>

      <div className="timeline">
        <div
          className="timeline-track"
          ref={track}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => {
            setHover(at(e.clientX));
            if (e.buttons === 1) scrub(e);
          }}
          onPointerLeave={() => setHover(null)}
          role="slider"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-label="Timeline"
        >
          <div className="timeline-rail" />
          <div className="timeline-fill" style={{ transform: `scaleX(${pct / 100})` }} />
          {marks.map((m) => (
            <i key={`m${m.index}`} className="timeline-mark" style={{ left: `${total > 1 ? (m.index / (total - 1)) * 100 : 0}%` }} title={m.label} />
          ))}
          {breakIdx.map((b) => (
            <i key={`b${b}`} className="timeline-bp" style={{ left: `${total > 1 ? (b / (total - 1)) * 100 : 0}%` }} />
          ))}
          <div className="timeline-thumb" style={{ left: `${pct}%` }} />
          {hover !== null && (
            <div className="timeline-tip" style={{ left: `${total > 1 ? (hover / (total - 1)) * 100 : 0}%` }}>
              step {hover + 1}
              {markAt(hover) ? ` · ${markAt(hover)}` : ''}
            </div>
          )}
        </div>
        <div className="timeline-meta">
          <span>
            step <b>{index + 1}</b> / {total}
          </span>
          {markAt(index) && <span className="timeline-phase">{markAt(index)}</span>}
        </div>
      </div>

      <div className="speed">
        <span className="speed-l">speed</span>
        <div className="seg seg-sm">
          {SPEEDS.map((s) => (
            <button key={s} className={`seg-btn ${speed === s ? 'on' : ''}`} onClick={() => player.setSpeed(s)}>
              {s < 1 ? `${s}`.replace('0.', '.') : s}×
            </button>
          ))}
        </div>
      </div>

      <div className="keys-wrap">
        <button className="tbtn ghost" onClick={() => setShowKeys((s) => !s)} aria-label="Keyboard shortcuts" aria-expanded={showKeys}>
          <IconKeyboard />
        </button>
        {showKeys && (
          <div className="keys-pop" onMouseLeave={() => setShowKeys(false)}>
            <div>
              <kbd>Space</kbd> play / pause
            </div>
            <div>
              <kbd>←</kbd> <kbd>→</kbd> step
            </div>
            <div>
              <kbd>Home</kbd> <kbd>End</kbd> jump
            </div>
            <div>
              <kbd>[</kbd> <kbd>]</kbd> slower / faster
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
