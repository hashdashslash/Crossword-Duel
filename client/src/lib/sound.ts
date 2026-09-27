/**
 * Light sound effects, synthesised with the Web Audio API (no audio files).
 * Muting is remembered on this device.
 */
import { useEffect, useState } from 'react';
import { local } from './storage';

const KEY = 'cd.muted';
let ctx: AudioContext | null = null;
let muted = local.get(KEY) === '1';
const listeners = new Set<(m: boolean) => void>();

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  tap: () => tone(660, 0, 0.08, 'sine', 0.05),
  step: () => tone(520, 0, 0.18, 'triangle', 0.08),
  warn: () => { tone(440, 0, 0.12, 'sine', 0.07); tone(392, 0.1, 0.16, 'sine', 0.07); },
  solved: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.1)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, i === 3 ? 0.7 : 0.25, 'triangle', 0.12)),
  lose: () => { tone(196, 0, 0.45, 'sine', 0.14); tone(147, 0.18, 0.6, 'sine', 0.12); },
  draw: () => { tone(440, 0, 0.3, 'triangle', 0.1); tone(440, 0.25, 0.3, 'triangle', 0.1); },
};

export function setMuted(m: boolean) {
  muted = m;
  local.set(KEY, m ? '1' : '0');
  listeners.forEach((fn) => fn(m));
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, setM] = useState(muted);
  useEffect(() => {
    listeners.add(setM);
    return () => { listeners.delete(setM); };
  }, []);
  return [m, setMuted];
}
