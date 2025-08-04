import { USTXData } from '@/types/openutau';

/**
 * DiffSinger-style SP phoneme insertion for phrase boundaries
 * 
 * This function automatically detects phrase boundaries in USTX data using timing gaps
 * and adds SP (Silence Phoneme) phoneme overrides at the start of each phrase.
 * This replicates DiffSinger's automatic phrase boundary detection behavior.
 * 
 * The SP phonemes are added as phoneme_overrides at index 0 (phrase start),
 * which the OpenUtau phonemizer will process during rendering.
 * 
 * @param ustxData - The original USTX data from the copilot
 * @returns Modified USTX data with SP phonemes added at phrase boundaries
 */
export function addSPPhonemesToUSTX(ustxData: USTXData): USTXData {
  const modifiedUSTX = JSON.parse(JSON.stringify(ustxData)); // Deep clone
  
  modifiedUSTX.voice_parts?.forEach((part, partIndex) => {
    if (!part.notes || part.notes.length === 0) return;
    
    // Get lyrical notes (excluding SP/AP/+ syllables)
    const lyricalNotes = part.notes
      .filter(note => 
        note.lyric && 
        note.lyric.trim() !== '' && 
        !note.lyric.startsWith('+') &&
        note.lyric !== 'SP' && 
        note.lyric !== 'AP'
      )
      .sort((a, b) => a.position - b.position);
    
    if (lyricalNotes.length === 0) return;
    
    console.log(`[SP] Processing voice part ${partIndex} with ${lyricalNotes.length} lyrical notes`);
    
    // Detect phrase boundaries using timing gaps (DiffSinger approach)
    const phraseBreaks = new Set<number>();
    
    for (let i = 1; i < lyricalNotes.length; i++) {
      const prevNote = lyricalNotes[i - 1];
      const currentNote = lyricalNotes[i];
      
      // Check for timing gap between notes (DiffSinger logic)
      const prevNoteEnd = prevNote.position + prevNote.duration;
      const currentNoteStart = currentNote.position;
      const hasTimingGap = prevNoteEnd !== currentNoteStart;
      
      if (hasTimingGap) {
        phraseBreaks.add(i); // Mark the start of new phrase
        console.log(`[SP] Phrase break detected: "${prevNote.lyric}" → "${currentNote.lyric}" (gap: ${currentNoteStart - prevNoteEnd} ticks)`);
      }
    }
    
    console.log(`[SP] Found ${phraseBreaks.size} phrase boundaries for SP insertion`);
    
    // Add SP phonemes at phrase starts
    phraseBreaks.forEach(phraseStartIndex => {
      const phraseStartNote = lyricalNotes[phraseStartIndex];
      const noteInPart = part.notes.find(n => n.position === phraseStartNote.position);
      
      if (noteInPart) {
        // Ensure phoneme_overrides array exists
        if (!noteInPart.phoneme_overrides) {
          noteInPart.phoneme_overrides = [];
        }
        
        // Add SP phoneme at the start of the phrase (index 0)
        const spOverride = {
          index: 0,
          phoneme: 'SP'
        };
        
        // Check if SP override already exists at index 0
        const existingSP = noteInPart.phoneme_overrides.find(override => 
          override.index === 0 && override.phoneme === 'SP'
        );
        
        if (!existingSP) {
          noteInPart.phoneme_overrides.unshift(spOverride);
          console.log(`[SP] Added SP phoneme to phrase start: "${phraseStartNote.lyric}"`);
        } else {
          console.log(`[SP] SP phoneme already exists at phrase start: "${phraseStartNote.lyric}"`);
        }
      }
    });
    
    // Add SP at very first note (phrase beginning)
    if (lyricalNotes.length > 0) {
      const firstNote = lyricalNotes[0];
      const firstNoteInPart = part.notes.find(n => n.position === firstNote.position);
      
      if (firstNoteInPart) {
        if (!firstNoteInPart.phoneme_overrides) {
          firstNoteInPart.phoneme_overrides = [];
        }
        
        const existingSP = firstNoteInPart.phoneme_overrides.find(override => 
          override.index === 0 && override.phoneme === 'SP'
        );
        
        if (!existingSP) {
          firstNoteInPart.phoneme_overrides.unshift({
            index: 0,
            phoneme: 'SP'
          });
          console.log(`[SP] Added SP phoneme to song beginning: "${firstNote.lyric}"`);
        }
      }
    }
  });
  
  return modifiedUSTX;
}

/**
 * Advanced SP phoneme insertion with natural language processing
 * 
 * This version uses more sophisticated heuristics to detect phrase boundaries,
 * including punctuation analysis and natural language patterns.
 * 
 * @param ustxData - The original USTX data
 * @param options - Configuration options for SP insertion
 * @returns Modified USTX data with SP phonemes
 */
export function addAdvancedSPPhonemes(
  ustxData: USTXData, 
  options: {
    useTimingGaps: boolean;
    usePunctuation: boolean;
    usePhraseEnders: boolean;
    minGapTicks: number;
  } = {
    useTimingGaps: true,
    usePunctuation: true,
    usePhraseEnders: true,
    minGapTicks: 0
  }
): USTXData {
  const modifiedUSTX = JSON.parse(JSON.stringify(ustxData));
  
  modifiedUSTX.voice_parts?.forEach((part, partIndex) => {
    if (!part.notes || part.notes.length === 0) return;
    
    const lyricalNotes = part.notes
      .filter(note => 
        note.lyric && 
        note.lyric.trim() !== '' && 
        !note.lyric.startsWith('+') &&
        note.lyric !== 'SP' && 
        note.lyric !== 'AP'
      )
      .sort((a, b) => a.position - b.position);
    
    if (lyricalNotes.length === 0) return;
    
    const phraseBreaks = new Set<number>();
    
    // Natural phrase ending words
    const phraseEnders = ['here', 'there', 'are', 'away', 'day', 'say', 'clear', 'now', 'down'];
    const phraseStarters = ['The', 'I', 'Every', 'With', 'A', 'But', 'And', 'When', 'Where'];
    
    for (let i = 1; i < lyricalNotes.length; i++) {
      const prevNote = lyricalNotes[i - 1];
      const currentNote = lyricalNotes[i];
      let shouldBreak = false;
      
      // Timing gap detection
      if (options.useTimingGaps) {
        const prevNoteEnd = prevNote.position + prevNote.duration;
        const currentNoteStart = currentNote.position;
        const gap = currentNoteStart - prevNoteEnd;
        
        if (gap > options.minGapTicks) {
          shouldBreak = true;
          console.log(`[SP-ADV] Timing gap break: "${prevNote.lyric}" → "${currentNote.lyric}" (${gap} ticks)`);
        }
      }
      
      // Punctuation detection
      if (options.usePunctuation && prevNote.lyric) {
        const hasPunctuation = /[.!?,:;]/.test(prevNote.lyric);
        if (hasPunctuation) {
          shouldBreak = true;
          console.log(`[SP-ADV] Punctuation break: "${prevNote.lyric}" → "${currentNote.lyric}"`);
        }
      }
      
      // Natural phrase boundaries
      if (options.usePhraseEnders) {
        const prevIsEnder = phraseEnders.some(ender => 
          prevNote.lyric.toLowerCase().includes(ender.toLowerCase())
        );
        const currentIsStarter = phraseStarters.some(starter => 
          currentNote.lyric.includes(starter)
        );
        
        if (prevIsEnder || currentIsStarter) {
          shouldBreak = true;
          console.log(`[SP-ADV] Natural break: "${prevNote.lyric}" → "${currentNote.lyric}" (ender=${prevIsEnder}, starter=${currentIsStarter})`);
        }
      }
      
      if (shouldBreak) {
        phraseBreaks.add(i);
      }
    }
    
    // Apply SP phonemes using the same logic as basic version
    phraseBreaks.forEach(phraseStartIndex => {
      const phraseStartNote = lyricalNotes[phraseStartIndex];
      const noteInPart = part.notes.find(n => n.position === phraseStartNote.position);
      
      if (noteInPart) {
        if (!noteInPart.phoneme_overrides) {
          noteInPart.phoneme_overrides = [];
        }
        
        const existingSP = noteInPart.phoneme_overrides.find(override => 
          override.index === 0 && override.phoneme === 'SP'
        );
        
        if (!existingSP) {
          noteInPart.phoneme_overrides.unshift({
            index: 0,
            phoneme: 'SP'
          });
          console.log(`[SP-ADV] Added advanced SP phoneme to: "${phraseStartNote.lyric}"`);
        }
      }
    });
    
    // Always add SP to first note
    if (lyricalNotes.length > 0) {
      const firstNote = lyricalNotes[0];
      const firstNoteInPart = part.notes.find(n => n.position === firstNote.position);
      
      if (firstNoteInPart) {
        if (!firstNoteInPart.phoneme_overrides) {
          firstNoteInPart.phoneme_overrides = [];
        }
        
        const existingSP = firstNoteInPart.phoneme_overrides.find(override => 
          override.index === 0 && override.phoneme === 'SP'
        );
        
        if (!existingSP) {
          firstNoteInPart.phoneme_overrides.unshift({
            index: 0,
            phoneme: 'SP'
          });
          console.log(`[SP-ADV] Added SP to song beginning: "${firstNote.lyric}"`);
        }
      }
    }
    
    console.log(`[SP-ADV] Part ${partIndex}: Added SP phonemes to ${phraseBreaks.size} phrase boundaries`);
  });
  
  return modifiedUSTX;
}