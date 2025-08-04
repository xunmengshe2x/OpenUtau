import { USTXData, USTXNote, USTXVoicePart } from '@/types/openutau';
import { USTXLyricsManager } from './ustxLyricsUtils';

interface VerseUSTXData {
  verseNumber: number;
  // Minimal USTX structure containing only the verse data
  ustxData: {
    name: string;
    resolution: number;
    bpm: number;
    voice_parts: USTXVoicePart[];
  };
  // Metadata for context
  metadata: {
    originalStartNoteIndex: number;
    originalEndNoteIndex: number;
    lyrics: string;
    duration: number;
    totalNotesInOriginal: number;
    verseNoteCount: number;
  };
}

export class VerseExtractor {
  private ustxData: USTXData;
  private lyricsManager: USTXLyricsManager;

  constructor(ustxData: USTXData, phonemeData?: any[]) {
    this.ustxData = ustxData;
    this.lyricsManager = new USTXLyricsManager(ustxData, phonemeData);
  }

  /**
   * Extract USTX data for a specific verse number
   */
  async extractVerseUSTXData(verseNumber: number, singerId: string = 'fem_1_ln'): Promise<VerseUSTXData | null> {
    console.log(`Extracting USTX data for verse ${verseNumber} using CLI phrase detection...`);
    
    try {
      const verses = await this.lyricsManager.detectVersesWithCLI(singerId);
      const targetVerse = verses.find(v => v.verseNumber === verseNumber);
      
      if (!targetVerse) {
        console.warn(`CLI: Verse ${verseNumber} not found. Available verses: ${verses.map(v => v.verseNumber).join(', ')}`);
        // Fallback to old detection
        const fallbackVerses = this.lyricsManager.detectVerses();
        const fallbackVerse = fallbackVerses.find(v => v.verseNumber === verseNumber);
        if (!fallbackVerse) {
          console.warn(`Fallback: Verse ${verseNumber} also not found.`);
          return null;
        }
        return this.processVerse(fallbackVerse, verseNumber);
      }
      
      return this.processVerse(targetVerse, verseNumber);
    } catch (error) {
      console.error('Error with CLI verse extraction, falling back:', error);
      const verses = this.lyricsManager.detectVerses();
      const targetVerse = verses.find(v => v.verseNumber === verseNumber);
      
      if (!targetVerse) {
        console.warn(`Fallback: Verse ${verseNumber} not found.`);
        return null;
      }
      
      return this.processVerse(targetVerse, verseNumber);
    }
  }

  /**
   * Process a verse (either from CLI or fallback detection)
   */
  private processVerse(targetVerse: any, verseNumber: number): VerseUSTXData | null {
    console.log(`Processing verse ${verseNumber}: "${targetVerse.lyrics}"`);

    // Get the vocal part with lyrics
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.error('No vocal part found with notes');
      return null;
    }

    // Get all lyrical notes (excluding syllable extensions)
    const allLyricalNotes = vocalPart.notes.filter(note =>
      note.lyric &&
      note.lyric.trim() !== '' &&
      !note.lyric.startsWith('+')
    ).sort((a, b) => a.position - b.position);

    // Extract the specific notes for this verse
    const verseNotes = allLyricalNotes.slice(
      targetVerse.startNoteIndex,
      targetVerse.endNoteIndex + 1
    );

    if (verseNotes.length === 0) {
      console.error(`No notes found for verse ${verseNumber}`);
      return null;
    }

    console.log(`Extracted ${verseNotes.length} notes for verse ${verseNumber}`);

    // Calculate time offset to normalize the verse to start at position 0
    const verseStartPosition = verseNotes[0].position;
    const verseEndPosition = verseNotes[verseNotes.length - 1].position + verseNotes[verseNotes.length - 1].duration;

    // Create normalized notes for the verse (starting at position 0)
    const normalizedNotes: USTXNote[] = verseNotes.map(note => ({
      ...note,
      position: note.position - verseStartPosition // Normalize to start at 0
    }));

    // Create a minimal USTX structure containing only this verse
    const verseUSTXData = {
      name: `${this.ustxData.name} - Verse ${verseNumber}`,
      resolution: this.ustxData.resolution || 480,
      bpm: this.ustxData.bpm || 120,
      voice_parts: [{
        name: `Verse ${verseNumber}`,
        notes: normalizedNotes,
        // Copy other essential properties from original vocal part
        comment: `Extracted verse ${verseNumber} from original project`,
        track_no: 0
      }]
    };

    const result: VerseUSTXData = {
      verseNumber,
      ustxData: verseUSTXData,
      metadata: {
        originalStartNoteIndex: targetVerse.startNoteIndex,
        originalEndNoteIndex: targetVerse.endNoteIndex,
        lyrics: targetVerse.lyrics,
        duration: verseEndPosition - verseStartPosition,
        totalNotesInOriginal: allLyricalNotes.length,
        verseNoteCount: verseNotes.length
      }
    };

    console.log(`Created verse USTX data:`, {
      verseNumber: result.verseNumber,
      noteCount: result.ustxData.voice_parts[0].notes.length,
      lyrics: result.metadata.lyrics,
      duration: result.metadata.duration
    });

    return result;
  }

  /**
   * Get the original baseline verse data (for reset operations)
   */
  getOriginalVerseData(verseNumber: number): any | null {
    console.log(`Getting original data for verse ${verseNumber}...`);
    
    const verses = this.lyricsManager.detectVerses();
    const targetVerse = verses.find(v => v.verseNumber === verseNumber);
    
    if (!targetVerse) {
      console.warn(`Verse ${verseNumber} not found`);
      return null;
    }

    // Get the vocal part with lyrics
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.error('No vocal part found with notes');
      return null;
    }

    // Get all lyrical notes (excluding syllable extensions)
    const allLyricalNotes = vocalPart.notes.filter(note =>
      note.lyric &&
      note.lyric.trim() !== '' &&
      !note.lyric.startsWith('+')
    ).sort((a, b) => a.position - b.position);

    // Extract the specific notes for this verse (original data)
    const verseNotes = allLyricalNotes.slice(
      targetVerse.startNoteIndex,
      targetVerse.endNoteIndex + 1
    );

    console.log(`Retrieved ${verseNotes.length} original notes for verse ${verseNumber}`);
    return { notes: verseNotes, metadata: targetVerse };
  }

  /**
   * Apply modified verse data back to the original USTX
   */
  applyVerseModifications(verseNumber: number, modifiedVerseUSTX: any): USTXData | null {
    console.log(`Applying modifications for verse ${verseNumber}...`);

    const originalExtraction = this.extractVerseUSTXData(verseNumber);
    if (!originalExtraction) {
      console.error(`Could not extract original data for verse ${verseNumber}`);
      return null;
    }

    // Validate that the modified USTX has the expected structure
    if (!modifiedVerseUSTX.voice_parts || !modifiedVerseUSTX.voice_parts[0]?.notes) {
      console.error('Modified verse USTX does not have the expected structure');
      return null;
    }

    const modifiedNotes = modifiedVerseUSTX.voice_parts[0].notes;
    
    // Ensure we have the same number of notes (for now - could be enhanced later)
    if (modifiedNotes.length !== originalExtraction.metadata.verseNoteCount) {
      console.warn(`Modified verse has ${modifiedNotes.length} notes, original had ${originalExtraction.metadata.verseNoteCount}`);
    }

    // Get the vocal part from original USTX
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.error('No vocal part found in original USTX');
      return null;
    }

    // Get all lyrical notes from original
    const allLyricalNotes = vocalPart.notes.filter(note =>
      note.lyric &&
      note.lyric.trim() !== '' &&
      !note.lyric.startsWith('+')
    ).sort((a, b) => a.position - b.position);

    // Calculate the original start position for denormalization
    const originalVerseNotes = allLyricalNotes.slice(
      originalExtraction.metadata.originalStartNoteIndex,
      originalExtraction.metadata.originalEndNoteIndex + 1
    );
    
    const originalStartPosition = originalVerseNotes[0].position;

    // Denormalize modified notes back to original timeline
    const denormalizedNotes = modifiedNotes.map((note: USTXNote, index: number) => {
      const originalNote = originalVerseNotes[index];
      return {
        ...note,
        position: note.position + originalStartPosition, // Denormalize position
        // Preserve original properties that shouldn't change
        lyric: originalNote ? originalNote.lyric : note.lyric // Keep original lyrics unless explicitly changed
      };
    });

    // Create updated USTX with modified verse
    const updatedUSTX = { ...this.ustxData };
    const updatedVoiceParts = [...updatedUSTX.voice_parts];
    const vocalPartIndex = updatedUSTX.voice_parts.findIndex(part => part === vocalPart);
    
    if (vocalPartIndex === -1) {
      console.error('Could not find vocal part index in original USTX');
      return null;
    }

    const updatedVocalPart = { ...vocalPart };
    const updatedNotes = [...vocalPart.notes];

    // Replace the verse notes in the original note array
    // Find the indices in the full note array (including + syllables, SP, AP, etc.)
    let replacedCount = 0;
    for (let i = 0; i < updatedNotes.length; i++) {
      const note = updatedNotes[i];
      
      // Check if this note matches one of our original verse notes
      const originalNoteIndex = originalVerseNotes.findIndex(original => 
        original.position === note.position && 
        original.lyric === note.lyric
      );
      
      if (originalNoteIndex !== -1 && replacedCount < denormalizedNotes.length) {
        updatedNotes[i] = denormalizedNotes[replacedCount];
        replacedCount++;
        console.log(`Replaced note at index ${i}: "${note.lyric}" -> "${updatedNotes[i].lyric}"`);
      }
    }

    updatedVocalPart.notes = updatedNotes;
    updatedVoiceParts[vocalPartIndex] = updatedVocalPart;
    updatedUSTX.voice_parts = updatedVoiceParts;

    console.log(`Applied modifications to ${replacedCount} notes in verse ${verseNumber}`);
    return updatedUSTX;
  }

  /**
   * Get available verse numbers
   */
  getAvailableVerses(): number[] {
    const verses = this.lyricsManager.detectVerses();
    return verses.map(v => v.verseNumber).sort((a, b) => a - b);
  }

  /**
   * Get verse lyrics summary
   */
  async getVerseSummary(singerId: string = 'fem_1_ln'): Promise<Array<{ verseNumber: number; lyrics: string; noteCount: number }>> {
    try {
      const verses = await this.lyricsManager.detectVersesWithCLI(singerId);
      return verses.map(verse => ({
        verseNumber: verse.verseNumber,
        lyrics: verse.lyrics,
        noteCount: verse.endNoteIndex - verse.startNoteIndex + 1
      }));
    } catch (error) {
      console.error('Error getting CLI verse summary, falling back:', error);
      const verses = this.lyricsManager.detectVerses();
      return verses.map(verse => ({
        verseNumber: verse.verseNumber,
        lyrics: verse.lyrics,
        noteCount: verse.endNoteIndex - verse.startNoteIndex + 1
      }));
    }
  }

  private getVocalPart() {
    return this.ustxData.voice_parts?.find(part => 
      part.notes && part.notes.some(note => note.lyric && note.lyric.trim() !== '')
    );
  }
}