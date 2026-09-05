// Stone timbre recipes shared by the Web Audio engine and the offline audition
// renderer (experiments/audio-redesign-2026-09-03). Revision 3 (2026-09-03,
// after user feedback): each drop is ONE fused impact — every layer starts at
// the same instant and decays fast, so nothing reads as a second sound. The
// "piq" punch comes from a sub-millisecond attack and a peak near the 0.5
// ceiling (headroom for the 1.8x output boost). Low "weight" pulses exist only
// for classic/wood and are capped at ~32ms so they fuse with the click.
//
// Revision 3: black and white share IDENTICAL recipes — alternating pitch
// between moves read as "two different sounds" to the user. The engine's
// per-drop pitch jitter keeps it organic without a systematic two-tone.

export interface StonePartial {
  type: "sine" | "triangle";
  from: number;
  to?: number;
  attack: number;
  decay: number;
  peak: number;
  delay?: number;
}

export interface StoneNoiseHit {
  filterType: "bandpass" | "lowpass" | "highpass";
  frequency: number;
  q: number;
  attack: number;
  decay: number;
  peak: number;
  delay?: number;
}

export interface StoneTimbre {
  /** Loudness alignment multiplier applied to every peak (keeps A/B parity across profiles). */
  gain?: number;
  partials: StonePartial[];
  noises: StoneNoiseHit[];
}

export type SynthStoneProfile = "classic" | "wood" | "crystal";
export type StoneColor = "black" | "white";

const classicTimbre: StoneTimbre = {
  noises: [{ filterType: "bandpass", frequency: 2800, q: 1.2, attack: 0.0004, decay: 0.012, peak: 0.3 }],
  partials: [
    { type: "sine", from: 1080, to: 980, attack: 0.0008, decay: 0.055, peak: 0.34 },
    { type: "sine", from: 150, attack: 0.001, decay: 0.028, peak: 0.1 },
  ],
};

const woodTimbre: StoneTimbre = {
  noises: [{ filterType: "lowpass", frequency: 1400, q: 0.7, attack: 0.0004, decay: 0.014, peak: 0.28 }],
  partials: [
    { type: "sine", from: 760, to: 680, attack: 0.0008, decay: 0.065, peak: 0.36 },
    { type: "sine", from: 120, attack: 0.001, decay: 0.032, peak: 0.12 },
  ],
};

const crystalTimbre: StoneTimbre = {
  noises: [{ filterType: "highpass", frequency: 4200, q: 0.7, attack: 0.0004, decay: 0.008, peak: 0.22 }],
  partials: [
    { type: "sine", from: 1950, attack: 0.0008, decay: 0.038, peak: 0.3 },
  ],
};

export const STONE_TIMBRES: Record<SynthStoneProfile, Record<StoneColor, StoneTimbre>> = {
  classic: { black: classicTimbre, white: classicTimbre },
  wood: { black: woodTimbre, white: woodTimbre },
  crystal: { black: crystalTimbre, white: crystalTimbre },
};

export const timbreDuration = (timbre: StoneTimbre) => {
  const ends = [
    ...timbre.partials.map((partial) => (partial.delay ?? 0) + partial.attack + partial.decay),
    ...timbre.noises.map((noise) => (noise.delay ?? 0) + noise.attack + noise.decay),
  ];
  return Math.max(...ends);
};
