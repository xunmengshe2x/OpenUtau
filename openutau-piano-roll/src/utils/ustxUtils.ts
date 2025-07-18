import { USTXData, USTXNote, USTXVoicePart } from '@/types/openutau';

export interface LyricsChange {
  noteIndex: number;
  oldLyric: string;
  newLyric: string;
}

export interface PitchChange {
  noteIndex: number;
  oldTone: number;
  newTone: number;
}

export interface TimingChange {
  noteIndex: number;
  oldPosition: number;
  newPosition: number;
  oldDuration: number;
  newDuration: number;
}

export interface VibratoChange {
  noteIndex: number;
  parameter: 'length' | 'period' | 'depth' | 'in' | 'out';
  oldValue: number;
  newValue: number;
}

/**
 * Parse lyrics text into individual words/syllables
 */
export function parseLyrics(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .flatMap(word => {
      // Handle multi-syllable words by splitting on common syllable boundaries
      // This is a simple heuristic - real syllable splitting would be more complex
      const syllables = word.match(/[^aeiou]*[aeiou]+[^aeiou]*|[^aeiou]+/gi) || [word];
      return syllables;
    });
}

/**
 * Apply lyrics changes to USTX data
 */
export function applyLyricsChanges(
  ustxData: USTXData,
  newLyrics: string,
  startNoteIndex: number = 0,
  endNoteIndex?: number
): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  
  // Get all notes as a flat array
  const allNotes: USTXNote[] = [];
  const notePositions: Array<{ partIndex: number; noteIndex: number }> = [];
  
  updatedData.voice_parts?.forEach((part, partIndex) => {
    part.notes?.forEach((note, noteIndex) => {
      allNotes.push(note);
      notePositions.push({ partIndex, noteIndex });
    });
  });
  
  // Parse the new lyrics
  const newLyricsSyllables = parseLyrics(newLyrics);
  
  // Determine the range of notes to update
  const endIndex = endNoteIndex ?? Math.min(
    startNoteIndex + newLyricsSyllables.length,
    allNotes.length
  );
  
  // Apply lyrics changes
  for (let i = startNoteIndex; i < endIndex; i++) {
    const syllableIndex = i - startNoteIndex;
    if (syllableIndex < newLyricsSyllables.length) {
      const { partIndex, noteIndex } = notePositions[i];
      const newLyric = newLyricsSyllables[syllableIndex];
      
      // Handle phonetic continuation
      if (syllableIndex > 0 && newLyric.length > 0) {
        updatedData.voice_parts![partIndex].notes![noteIndex].lyric = newLyric;
      } else if (syllableIndex === 0) {
        updatedData.voice_parts![partIndex].notes![noteIndex].lyric = newLyric;
      }
    }
  }
  
  return updatedData;
}

/**
 * Apply pitch changes to USTX data
 */
export function applyPitchChanges(
  ustxData: USTXData,
  changes: PitchChange[]
): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  
  // Get all notes as a flat array with their positions
  const allNotes: USTXNote[] = [];
  const notePositions: Array<{ partIndex: number; noteIndex: number }> = [];
  
  updatedData.voice_parts?.forEach((part, partIndex) => {
    part.notes?.forEach((note, noteIndex) => {
      allNotes.push(note);
      notePositions.push({ partIndex, noteIndex });
    });
  });
  
  // Apply pitch changes
  changes.forEach(change => {
    if (change.noteIndex < allNotes.length) {
      const { partIndex, noteIndex } = notePositions[change.noteIndex];
      updatedData.voice_parts![partIndex].notes![noteIndex].tone = change.newTone;
    }
  });
  
  return updatedData;
}

/**
 * Apply global pitch shift to all notes
 */
export function applyPitchShift(
  ustxData: USTXData,
  semitones: number,
  startNoteIndex: number = 0,
  endNoteIndex?: number
): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  
  // Get all notes as a flat array
  const allNotes: USTXNote[] = [];
  const notePositions: Array<{ partIndex: number; noteIndex: number }> = [];
  
  updatedData.voice_parts?.forEach((part, partIndex) => {
    part.notes?.forEach((note, noteIndex) => {
      allNotes.push(note);
      notePositions.push({ partIndex, noteIndex });
    });
  });
  
  const endIndex = endNoteIndex ?? allNotes.length;
  
  // Apply pitch shift
  for (let i = startNoteIndex; i < endIndex; i++) {
    const { partIndex, noteIndex } = notePositions[i];
    const currentTone = updatedData.voice_parts![partIndex].notes![noteIndex].tone;
    const newTone = Math.max(0, Math.min(127, currentTone + semitones));
    updatedData.voice_parts![partIndex].notes![noteIndex].tone = newTone;
  }
  
  return updatedData;
}

/**
 * Apply vibrato changes to USTX data
 */
export function applyVibratoChanges(
  ustxData: USTXData,
  changes: VibratoChange[]
): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  
  // Get all notes as a flat array with their positions
  const allNotes: USTXNote[] = [];
  const notePositions: Array<{ partIndex: number; noteIndex: number }> = [];
  
  updatedData.voice_parts?.forEach((part, partIndex) => {
    part.notes?.forEach((note, noteIndex) => {
      allNotes.push(note);
      notePositions.push({ partIndex, noteIndex });
    });
  });
  
  // Apply vibrato changes
  changes.forEach(change => {
    if (change.noteIndex < allNotes.length) {
      const { partIndex, noteIndex } = notePositions[change.noteIndex];
      const note = updatedData.voice_parts![partIndex].notes![noteIndex];
      
      // Ensure vibrato object exists
      if (!note.vibrato) {
        note.vibrato = {
          length: 0,
          period: 175,
          depth: 25,
          in: 10,
          out: 10,
          shift: 0,
          drift: 0
        };
      }
      
      note.vibrato[change.parameter] = change.newValue;
    }
  });
  
  return updatedData;
}

/**
 * Apply timing changes to USTX data
 */
export function applyTimingChanges(
  ustxData: USTXData,
  changes: TimingChange[]
): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  
  // Get all notes as a flat array with their positions
  const allNotes: USTXNote[] = [];
  const notePositions: Array<{ partIndex: number; noteIndex: number }> = [];
  
  updatedData.voice_parts?.forEach((part, partIndex) => {
    part.notes?.forEach((note, noteIndex) => {
      allNotes.push(note);
      notePositions.push({ partIndex, noteIndex });
    });
  });
  
  // Apply timing changes
  changes.forEach(change => {
    if (change.noteIndex < allNotes.length) {
      const { partIndex, noteIndex } = notePositions[change.noteIndex];
      const note = updatedData.voice_parts![partIndex].notes![noteIndex];
      
      note.position = change.newPosition;
      note.duration = change.newDuration;
    }
  });
  
  return updatedData;
}

/**
 * Scale tempo of the entire project
 */
export function scaleTempo(ustxData: USTXData, factor: number): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  
  // Scale BPM
  updatedData.bpm = Math.round(updatedData.bpm * factor);
  
  // Scale all note positions and durations
  updatedData.voice_parts?.forEach(part => {
    part.notes?.forEach(note => {
      note.position = Math.round(note.position / factor);
      note.duration = Math.round(note.duration / factor);
    });
  });
  
  return updatedData;
}

/**
 * Extract lyrics as plain text
 */
export function extractLyrics(ustxData: USTXData): string {
  const allNotes: USTXNote[] = [];
  
  ustxData.voice_parts?.forEach(part => {
    part.notes?.forEach(note => {
      allNotes.push(note);
    });
  });
  
  // Sort notes by position
  allNotes.sort((a, b) => a.position - b.position);
  
  // Extract lyrics, handling phonetic continuations
  return allNotes
    .map(note => note.lyric)
    .join(' ')
    .replace(/\+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find notes by lyric pattern
 */
export function findNotesByLyric(
  ustxData: USTXData,
  pattern: string | RegExp
): Array<{ note: USTXNote; flatIndex: number; partIndex: number; noteIndex: number }> {
  const results: Array<{ note: USTXNote; flatIndex: number; partIndex: number; noteIndex: number }> = [];
  let flatIndex = 0;
  
  ustxData.voice_parts?.forEach((part, partIndex) => {
    part.notes?.forEach((note, noteIndex) => {
      const matches = typeof pattern === 'string' 
        ? note.lyric.includes(pattern)
        : pattern.test(note.lyric);
      
      if (matches) {
        results.push({ note, flatIndex, partIndex, noteIndex });
      }
      
      flatIndex++;
    });
  });
  
  return results;
}

/**
 * Convert MIDI note number to note name
 */
export function midiToNoteName(midiNote: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12) - 1;
  const note = noteNames[midiNote % 12];
  return `${note}${octave}`;
}

/**
 * Convert note name to MIDI note number
 */
export function noteNameToMidi(noteName: string): number {
  const noteMap: { [key: string]: number } = {
    'C': 0, 'C#': 1, 'DB': 1, 'D': 2, 'D#': 3, 'EB': 3, 'E': 4,
    'F': 5, 'F#': 6, 'GB': 6, 'G': 7, 'G#': 8, 'AB': 8, 'A': 9,
    'A#': 10, 'BB': 10, 'B': 11
  };
  
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60; // Default to C4
  
  const note = match[1].toUpperCase();
  const octave = parseInt(match[2]);
  
  return (octave + 1) * 12 + (noteMap[note] || 0);
}