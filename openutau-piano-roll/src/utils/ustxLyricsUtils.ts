import { USTXData } from '@/types/openutau';

interface VerseSegment {
  verseNumber: number;
  startNoteIndex: number;
  endNoteIndex: number;
  lyrics: string;
  duration: number;
}

export class USTXLyricsManager {
  private ustxData: USTXData;
  
  constructor(ustxData: USTXData) {
    this.ustxData = ustxData;
  }

  // Find vocal part with lyrics (USTX uses voice_parts, not tracks)
  private getVocalPart() {
    console.log('Looking for vocal part in USTX:', {
      hasVoiceParts: !!this.ustxData.voice_parts,
      voicePartsCount: this.ustxData.voice_parts?.length,
      partDetails: this.ustxData.voice_parts?.map((part, i) => ({
        index: i,
        name: part.name,
        hasNotes: !!part.notes,
        notesCount: part.notes?.length,
        firstFewNotes: part.notes?.slice(0, 5).map(note => ({
          lyric: note.lyric,
          position: note.position,
          duration: note.duration
        }))
      }))
    });

    const vocalPart = this.ustxData.voice_parts?.find(part => 
      part.notes && part.notes.some(note => note.lyric && note.lyric.trim() !== '')
    );

    console.log('Found vocal part:', {
      found: !!vocalPart,
      name: vocalPart?.name,
      notesWithLyrics: vocalPart?.notes?.filter(note => note.lyric && note.lyric.trim() !== '').length
    });

    return vocalPart;
  }

  // Analyze USTX structure to detect verse boundaries
  detectVerses(): VerseSegment[] {
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.log('No vocal part found for verse detection');
      return [];
    }

    const lyricalNotes = vocalPart.notes.filter(note => 
      note.lyric && note.lyric.trim() !== ''
    );

    console.log('Lyrical notes for verse detection:', {
      totalNotes: vocalPart.notes.length,
      lyricalNotesCount: lyricalNotes.length,
      firstFewLyrics: lyricalNotes.slice(0, 10).map(n => n.lyric)
    });

    if (lyricalNotes.length === 0) {
      console.log('No lyrical notes found');
      return [];
    }

    // Simple verse detection: group by silence gaps or musical phrases
    const verses: VerseSegment[] = [];
    let currentVerseStart = 0;
    let currentVerseLyrics: string[] = [];
    let verseNumber = 1;

    for (let i = 0; i < lyricalNotes.length; i++) {
      const note = lyricalNotes[i];
      const nextNote = lyricalNotes[i + 1];
      
      currentVerseLyrics.push(note.lyric || '');

      // Detect verse boundary by:
      // 1. Large time gap to next note (silence/pause)
      // 2. End of track
      // 3. Repeating lyrical patterns
      const isVerseEnd = !nextNote || 
        (nextNote.position - (note.position + note.duration) > 480) || // > 1 beat gap
        this.detectLyricalBreak(note.lyric, nextNote?.lyric);

      if (isVerseEnd) {
        verses.push({
          verseNumber,
          startNoteIndex: currentVerseStart,
          endNoteIndex: i,
          lyrics: currentVerseLyrics.join(' '),
          duration: (note.position + note.duration) - lyricalNotes[currentVerseStart].position
        });

        currentVerseStart = i + 1;
        currentVerseLyrics = [];
        verseNumber++;
      }
    }

    console.log('Detected verses:', verses.map(v => ({
      number: v.verseNumber,
      lyrics: v.lyrics.substring(0, 50) + '...',
      wordCount: v.lyrics.split(' ').length
    })));

    return verses;
  }

  // Simple heuristic to detect lyrical breaks (verse boundaries)
  private detectLyricalBreak(currentLyric?: string, nextLyric?: string): boolean {
    if (!currentLyric || !nextLyric) return false;
    
    // Look for sentence endings
    const sentenceEnders = ['.', '!', '?'];
    return sentenceEnders.some(ender => currentLyric.includes(ender));
  }

  // Get lyrics for a specific verse number
  getVerseLyrics(verseNumber: number): string | null {
    const verses = this.detectVerses();
    const verse = verses.find(v => v.verseNumber === verseNumber);
    return verse?.lyrics || null;
  }

  // Get all lyrics as fallback
  getAllLyrics(): string {
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) return '';

    return vocalPart.notes
      .filter(note => note.lyric && note.lyric.trim() !== '')
      .map(note => note.lyric)
      .join(' ');
  }

  // Update lyrics for a specific verse
  updateVerseLyrics(verseNumber: number, newLyrics: string): USTXData {
    const verses = this.detectVerses();
    const targetVerse = verses.find(v => v.verseNumber === verseNumber);
    
    if (!targetVerse) {
      console.warn(`Verse ${verseNumber} not found, updating all lyrics`);
      return this.updateAllLyrics(newLyrics);
    }

    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) return this.ustxData;

    // Find the actual notes in the vocal part that correspond to this verse
    const lyricalNotes = vocalPart.notes.filter(note => 
      note.lyric && note.lyric.trim() !== ''
    );

    const verseNotes = lyricalNotes.slice(targetVerse.startNoteIndex, targetVerse.endNoteIndex + 1);
    const newWords = newLyrics.split(' ').filter(word => word.trim() !== '');

    // Update the USTX data
    const updatedVoiceParts = [...this.ustxData.voice_parts];
    const partIndex = this.ustxData.voice_parts.findIndex(p => p === vocalPart);
    const updatedPart = { ...vocalPart };
    const updatedNotes = [...vocalPart.notes];

    // Map new words to verse notes
    verseNotes.forEach((note, index) => {
      if (index < newWords.length) {
        const noteIndex = vocalPart.notes.indexOf(note);
        updatedNotes[noteIndex] = { ...note, lyric: newWords[index] };
      }
    });

    updatedPart.notes = updatedNotes;
    updatedVoiceParts[partIndex] = updatedPart;

    return {
      ...this.ustxData,
      voice_parts: updatedVoiceParts
    };
  }

  // Fallback: update all lyrics
  private updateAllLyrics(newLyrics: string): USTXData {
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) return this.ustxData;

    const newWords = newLyrics.split(' ').filter(word => word.trim() !== '');
    const updatedVoiceParts = [...this.ustxData.voice_parts];
    const partIndex = this.ustxData.voice_parts.findIndex(p => p === vocalPart);
    const updatedPart = { ...vocalPart };
    const updatedNotes = [...vocalPart.notes];

    let wordIndex = 0;
    for (let i = 0; i < updatedNotes.length && wordIndex < newWords.length; i++) {
      if (updatedNotes[i].lyric && updatedNotes[i].lyric.trim() !== '') {
        updatedNotes[i] = { ...updatedNotes[i], lyric: newWords[wordIndex] };
        wordIndex++;
      }
    }

    updatedPart.notes = updatedNotes;
    updatedVoiceParts[partIndex] = updatedPart;

    return {
      ...this.ustxData,
      voice_parts: updatedVoiceParts
    };
  }

  // Get metadata for API (without sending full USTX)
  getLyricsMetadata() {
    console.log('Getting lyrics metadata...');
    const verses = this.detectVerses();
    const allLyrics = this.getAllLyrics();
    
    const metadata = {
      totalVerses: verses.length,
      hasLyrics: allLyrics.length > 0,
      allLyrics: allLyrics,
      verses: verses.map(v => ({
        number: v.verseNumber,
        lyrics: v.lyrics,
        wordCount: v.lyrics.split(' ').length
      }))
    };

    console.log('Generated lyrics metadata:', metadata);
    return metadata;
  }
}