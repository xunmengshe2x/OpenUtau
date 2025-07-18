// OpenUtau TypeScript interfaces based on C# data structures

export interface PitchPoint {
  x: number;  // Position in milliseconds relative to note start
  y: number;  // Pitch deviation in 0.1 semitones
  shape: PitchPointShape;
}

export enum PitchPointShape {
  io = 'io',
  l = 'l',
  i = 'i',
  o = 'o'
}

// USTX file structure
export interface USTXPitch {
  data: PitchPoint[];
  snap_first: boolean;
}

export interface USTXVibrato {
  length: number;
  period: number;
  depth: number;
  in: number;
  out: number;
  shift: number;
  drift: number;
}

export interface USTXPhonemeOverride {
  index: number;
  phoneme?: string;
  offset?: number;
}

export interface USTXNote {
  position: number;
  duration: number;
  tone: number;
  lyric: string;
  pitch: USTXPitch;
  vibrato: USTXVibrato;
  phoneme_expressions: unknown[];
  phoneme_overrides: USTXPhonemeOverride[];
}

export interface USTXVoicePart {
  name: string;
  comment: string;
  track_no: number;
  position: number;
  notes: USTXNote[];
}

export interface USTXTrack {
  singer: string;
  phonemizer: string;
  renderer_settings: unknown;
  mute: boolean;
  solo: boolean;
  volume: number;
}

export interface USTXData {
  name: string;
  comment: string;
  ustx_version: string;
  resolution: number;
  bpm: number;
  beat_per_bar: number;
  beat_unit: number;
  tracks: USTXTrack[];
  voice_parts: USTXVoicePart[];
  expressions: unknown;
  time_signatures: unknown[];
  tempos: unknown[];
}

export interface UPitch {
  data: PitchPoint[];
  snapFirst: boolean;
}

export interface UVibrato {
  length: number;   // Vibrato length as percentage of note
  period: number;   // Vibrato period in milliseconds
  depth: number;    // Vibrato depth in cents
  in: number;       // Fade in percentage
  out: number;      // Fade out percentage
  shift: number;    // Phase shift percentage
  drift: number;    // Pitch drift
  volLink: number;  // Volume linkage
}

export interface UExpression {
  abbr: string;
  value: number;
  index?: number;  // Phoneme index if applicable
}

export interface UPhonemeOverride {
  index: number;
  offset?: number;
  phoneme?: string;
  preutterDelta?: number;
  overlapDelta?: number;
}

export interface UNote {
  position: number;     // Position in ticks relative to part beginning
  duration: number;     // Duration in ticks
  tone: number;         // MIDI note number (0-127)
  lyric: string;        // Note lyric text
  pitch: UPitch;        // Pitch bend data
  vibrato: UVibrato;    // Vibrato configuration
  phonemeExpressions: UExpression[];
  phonemeOverrides: UPhonemeOverride[];
  
  // Computed properties
  end: number;          // position + duration
  selected: boolean;    // Selection state
}

export interface UPhoneme {
  position: number;     // Position in ticks
  phoneme: string;      // Phoneme symbol
  duration: number;     // Duration in ticks
  index: number;        // Index within note
  parentNote?: UNote;   // Parent note reference
}

export interface UCurve {
  xs: number[];         // X coordinates
  ys: number[];         // Y coordinates
  abbr: string;         // Expression abbreviation
}

export interface UVoicePart {
  notes: UNote[];
  curves: UCurve[];
  phonemes: UPhoneme[];
  position: number;     // Part position in ticks
  duration: number;     // Part duration
  trackNo: number;      // Track number
  displayName: string;
}

export interface UTrack {
  trackName: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
}

export interface UTimeSignature {
  barPosition: number;
  beatPerBar: number;
  beatUnit: number;
}

export interface UTempo {
  position: number;
  bpm: number;
}

export interface UProject {
  resolution: number;           // Ticks per quarter note (default 480)
  tracks: UTrack[];
  parts: UVoicePart[];
  timeSignatures: UTimeSignature[];
  tempos: UTempo[];
}

// CLI output types
export interface PhonemeTiming {
  PartName: string;
  NoteIndex: number;
  Phoneme: string;
  TimeMs: number;
}

// UI/Display types
export interface Viewport {
  startTick: number;
  endTick: number;
  startTone: number;
  endTone: number;
  tickWidth: number;    // Pixels per tick
  noteHeight: number;   // Pixels per semitone
}

export interface NoteRect {
  x: number;
  y: number;
  width: number;
  height: number;
  note: UNote;
}

export interface PitchCurvePoint {
  x: number;
  y: number;
  tick: number;
  pitch: number;  // In semitones
}

// Constants from ViewConstants.cs
export const ViewConstants = {
  PianoRollTickWidthDefault: 128.0 / 480.0,
  NoteHeightDefault: 22,
  MaxTone: 132,  // 12 * 11 octaves
  ResizeMargin: 8,
  MiddleC: 60,   // C4
} as const;

// Time conversion utilities
export interface TimeAxis {
  tickPosToMsPos(tick: number): number;
  msPosToTickPos(ms: number): number;
  tickPosToBarBeat(tick: number): { bar: number; beat: number };
  barBeatToTickPos(bar: number, beat: number): number;
}

export function createTimeAxis(project: UProject): TimeAxis {
  const resolution = project.resolution;
  
  return {
    tickPosToMsPos(tick: number): number {
      // Simple implementation - assumes constant 120 BPM
      // Real implementation would handle tempo changes
      const bpm = 120;
      const msPerTick = (60 * 1000) / (bpm * resolution);
      return tick * msPerTick;
    },
    
    msPosToTickPos(ms: number): number {
      const bpm = 120;
      const msPerTick = (60 * 1000) / (bpm * resolution);
      return ms / msPerTick;
    },
    
    tickPosToBarBeat(tick: number): { bar: number; beat: number } {
      // Simple 4/4 time signature
      const ticksPerBeat = resolution;
      const ticksPerBar = ticksPerBeat * 4;
      const bar = Math.floor(tick / ticksPerBar);
      const beat = Math.floor((tick % ticksPerBar) / ticksPerBeat);
      return { bar, beat };
    },
    
    barBeatToTickPos(bar: number, beat: number): number {
      const ticksPerBeat = resolution;
      const ticksPerBar = ticksPerBeat * 4;
      return bar * ticksPerBar + beat * ticksPerBeat;
    }
  };
}