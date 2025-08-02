import { USTXData, PhonemeTiming, DetailedPhonemeTiming, PhonemePhrase } from '@/types/openutau';

interface VerseSegment {
  verseNumber: number;
  startNoteIndex: number;
  endNoteIndex: number;
  lyrics: string;
  duration: number;
}

export class USTXLyricsManager {
  private ustxData: USTXData;
  private phonemeData?: DetailedPhonemeTiming[];
  
  constructor(ustxData: USTXData, phonemeData?: DetailedPhonemeTiming[]) {
    this.ustxData = ustxData;
    this.phonemeData = phonemeData;
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
      .filter(note => note.lyric && note.lyric.trim() !== '' && !note.lyric.startsWith('+'))
      .map(note => note.lyric)
      .join(' ');
  }

  // Update lyrics for a specific verse
  async updateVerseLyrics(verseNumber: number, newLyrics: string, singerId: string = 'fem_1_ln'): Promise<USTXData> {
    try {
      const verses = await this.detectVersesWithCLI(singerId);
      const targetVerse = verses.find(v => v.verseNumber === verseNumber);
      
      if (!targetVerse) {
        console.warn(`CLI: Verse ${verseNumber} not found, trying fallback`);
        return this.updateVerseLyricsSync(verseNumber, newLyrics);
      }
      
      return this.applyVerseUpdate(targetVerse, newLyrics);
    } catch (error) {
      console.error('Error with CLI verse update, falling back:', error);
      return this.updateVerseLyricsSync(verseNumber, newLyrics);
    }
  }

  // Fallback synchronous version using old detection
  private updateVerseLyricsSync(verseNumber: number, newLyrics: string): USTXData {
    const verses = this.detectVerses();
    const targetVerse = verses.find(v => v.verseNumber === verseNumber);
    
    if (!targetVerse) {
      console.warn(`Verse ${verseNumber} not found, updating all lyrics`);
      return this.updateAllLyrics(newLyrics);
    }
    
    return this.applyVerseUpdate(targetVerse, newLyrics);
  }

  // Extract the verse update logic into a separate method
  private applyVerseUpdate(targetVerse: any, newLyrics: string): USTXData {

    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) return this.ustxData;

    // Find the actual notes in the vocal part that correspond to this verse
    // Exclude syllable extensions (+) like DiffSinger does
    const lyricalNotes = vocalPart.notes.filter(note => 
      note.lyric && note.lyric.trim() !== '' && !note.lyric.startsWith('+')
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
      // Only update non-extension syllables (not starting with +)
      if (updatedNotes[i].lyric && updatedNotes[i].lyric.trim() !== '' && !updatedNotes[i].lyric.startsWith('+')) {
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

  // Update lyrics for multiple verses
  async updateMultipleVerses(verseResults: Array<{verse_number: number, new_lyrics: string}>): Promise<USTXData> {
    let updatedUSTX = this.ustxData;
    
    // Sort by verse number to maintain order
    const sortedResults = verseResults.sort((a, b) => a.verse_number - b.verse_number);
    
    // Apply each verse update sequentially
    for (const result of sortedResults) {
      const manager = new USTXLyricsManager(updatedUSTX);
      updatedUSTX = await manager.updateVerseLyrics(result.verse_number, result.new_lyrics, 'fem_1_ln');
    }
    
    console.log(`Updated ${verseResults.length} verses:`, verseResults.map(r => `Verse ${r.verse_number}`));
    return updatedUSTX;
  }

  // Update lyrics for multiple verses with streaming callback (updates UI progressively)
  async updateMultipleVersesStreaming(
    verseResults: Array<{verse_number: number, new_lyrics: string}>,
    onVerseUpdate: (updatedUSTX: USTXData, verseNumber: number, progress: {current: number, total: number}) => void
  ): Promise<USTXData> {
    let updatedUSTX = this.ustxData;
    
    // Sort by verse number to maintain order
    const sortedResults = verseResults.sort((a, b) => a.verse_number - b.verse_number);
    
    // Apply each verse update sequentially with callback
    for (let i = 0; i < sortedResults.length; i++) {
      const result = sortedResults[i];
      const manager = new USTXLyricsManager(updatedUSTX);
      updatedUSTX = await manager.updateVerseLyrics(result.verse_number, result.new_lyrics, 'fem_1_ln');
      
      // Call callback immediately after each verse update
      onVerseUpdate(updatedUSTX, result.verse_number, {
        current: i + 1,
        total: sortedResults.length
      });
      
      console.log(`Updated verse ${result.verse_number} (${i + 1}/${sortedResults.length})`);
    }
    
    console.log(`Completed streaming update of ${verseResults.length} verses`);
    return updatedUSTX;
  }

  // Convert CLI phoneme data to detailed timing format
  private convertPhonemeData(cliPhonemeData: PhonemeTiming[]): DetailedPhonemeTiming[] {
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) return [];

    const detailed: DetailedPhonemeTiming[] = [];
    const resolution = this.ustxData.resolution || 480;

    for (const phoneme of cliPhonemeData) {
      // Find the corresponding note
      const note = vocalPart.notes[phoneme.NoteIndex];
      if (!note) continue;

      // Convert milliseconds to ticks (approximate)
      const bpm = this.ustxData.bpm || 120;
      const msPerTick = (60 * 1000) / (bpm * resolution);
      const positionTicks = Math.round(phoneme.TimeMs / msPerTick);
      
      // Estimate duration based on next phoneme or note end
      const nextPhoneme = cliPhonemeData.find(p => 
        p.PartName === phoneme.PartName && 
        p.NoteIndex === phoneme.NoteIndex && 
        p.TimeMs > phoneme.TimeMs
      );
      
      let endTimeMs = phoneme.TimeMs + 100; // Default 100ms duration
      if (nextPhoneme) {
        endTimeMs = nextPhoneme.TimeMs;
      }

      detailed.push({
        partName: phoneme.PartName,
        noteIndex: phoneme.NoteIndex,
        phoneme: phoneme.Phoneme,
        position: positionTicks,
        duration: Math.round((endTimeMs - phoneme.TimeMs) / msPerTick),
        timeMs: phoneme.TimeMs,
        endTimeMs: endTimeMs,
        parentNote: {
          lyric: note.lyric,
          tone: note.tone,
          position: note.position,
          duration: note.duration
        }
      });
    }

    return detailed;
  }

  // Detect phrases using phoneme gaps (like RenderPhrase.FromPart)
  detectPhonemeBasedPhrases(): PhonemePhrase[] {
    if (!this.phonemeData || this.phonemeData.length === 0) {
      console.log('No phoneme data available for phrase detection');
      return [];
    }

    const phrases: PhonemePhrase[] = [];
    let currentPhrasePhonemes: DetailedPhonemeTiming[] = [this.phonemeData[0]];
    let phraseNumber = 1;

    for (let i = 1; i < this.phonemeData.length; i++) {
      const prevPhoneme = this.phonemeData[i - 1];
      const currentPhoneme = this.phonemeData[i];
      
      // Check for phoneme gap (exact DiffSinger logic: ANY gap)
      const gap = currentPhoneme.timeMs - prevPhoneme.endTimeMs;
      const hasGap = Math.abs(gap) > 0.1; // Allow tiny floating point errors only
      
      // Debug key transitions (like "are" to "Every")
      if (prevPhoneme.parentNote?.lyric === "are" || currentPhoneme.parentNote?.lyric === "Every") {
        console.log(`Phoneme gap: "${prevPhoneme.parentNote?.lyric}" [${prevPhoneme.phoneme}] → "${currentPhoneme.parentNote?.lyric}" [${currentPhoneme.phoneme}]`, {
          prevEndMs: prevPhoneme.endTimeMs.toFixed(2),
          currentStartMs: currentPhoneme.timeMs.toFixed(2),
          gapMs: gap.toFixed(2),
          hasGap,
          threshold: 10
        });
      }
      
      if (hasGap) {
        // End current phrase
        const phraseStartTime = currentPhrasePhonemes[0].timeMs;
        const phraseEndTime = currentPhrasePhonemes[currentPhrasePhonemes.length - 1].endTimeMs;
        
        // Collect lyrics from phonemes that represent actual lyrics (not SP/AP)
        const lyricalPhonemes = currentPhrasePhonemes.filter(p => 
          !p.phoneme.match(/^(SP|AP)$/i) && 
          p.parentNote.lyric && 
          !p.parentNote.lyric.startsWith('+')
        );
        
        const lyrics = Array.from(new Set(lyricalPhonemes.map(p => p.parentNote.lyric))).join(' ');
        
        phrases.push({
          phraseNumber,
          startNoteIndex: currentPhrasePhonemes[0].noteIndex,
          endNoteIndex: currentPhrasePhonemes[currentPhrasePhonemes.length - 1].noteIndex,
          startTimeMs: phraseStartTime,
          endTimeMs: phraseEndTime,
          lyrics,
          phonemes: [...currentPhrasePhonemes],
          gapAfterMs: gap
        });

        // Start new phrase
        currentPhrasePhonemes = [currentPhoneme];
        phraseNumber++;
      } else {
        // Continue current phrase
        currentPhrasePhonemes.push(currentPhoneme);
      }
    }

    // Add final phrase
    if (currentPhrasePhonemes.length > 0) {
      const phraseStartTime = currentPhrasePhonemes[0].timeMs;
      const phraseEndTime = currentPhrasePhonemes[currentPhrasePhonemes.length - 1].endTimeMs;
      
      const lyricalPhonemes = currentPhrasePhonemes.filter(p => 
        !p.phoneme.match(/^(SP|AP)$/i) && 
        p.parentNote.lyric && 
        !p.parentNote.lyric.startsWith('+')
      );
      
      const lyrics = Array.from(new Set(lyricalPhonemes.map(p => p.parentNote.lyric))).join(' ');
      
      phrases.push({
        phraseNumber,
        startNoteIndex: currentPhrasePhonemes[0].noteIndex,
        endNoteIndex: currentPhrasePhonemes[currentPhrasePhonemes.length - 1].noteIndex,
        startTimeMs: phraseStartTime,
        endTimeMs: phraseEndTime,
        lyrics,
        phonemes: [...currentPhrasePhonemes]
      });
    }

    console.log('Detected phoneme-based phrases:', phrases.map(p => ({
      number: p.phraseNumber,
      lyrics: p.lyrics.substring(0, 50) + '...',
      gapAfter: p.gapAfterMs
    })));

    return phrases;
  }

  // DiffSinger-style timing gap detection for phrase boundaries
  private detectTimingGapPhrases(): VerseSegment[] {
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.log('No vocal part found for timing gap detection');
      return [];
    }

    // Get all notes with lyrics (excluding syllable extensions)
    const lyricalNotes = vocalPart.notes
      .filter(note => 
        note.lyric && 
        note.lyric.trim() !== '' && 
        !note.lyric.startsWith('+')
      )
      .sort((a, b) => a.position - b.position);

    if (lyricalNotes.length === 0) {
      console.log('No lyrical notes found for timing gap detection');
      return [];
    }

    console.log('Analyzing timing gaps for phrase detection:', {
      totalLyricalNotes: lyricalNotes.length,
      firstNote: lyricalNotes[0]?.lyric,
      lastNote: lyricalNotes[lyricalNotes.length - 1]?.lyric
    });

    const phrases: VerseSegment[] = [];
    let currentPhraseNotes: typeof lyricalNotes = [lyricalNotes[0]];
    let phraseNumber = 1;

    for (let i = 1; i < lyricalNotes.length; i++) {
      const prevNote = lyricalNotes[i - 1];
      const currentNote = lyricalNotes[i];
      
      // Check for timing gap (DiffSinger logic: previous note end != current note start)
      const prevNoteEnd = prevNote.position + prevNote.duration;
      const currentNoteStart = currentNote.position;
      const hasTimingGap = prevNoteEnd !== currentNoteStart;
      
      // Debug key transitions
      if (prevNote.lyric === "here" || prevNote.lyric === "are" || currentNote.lyric === "The" || currentNote.lyric === "Every") {
        console.log(`Timing gap analysis: "${prevNote.lyric}" → "${currentNote.lyric}"`, {
          prevNoteEnd,
          currentNoteStart,
          gap: currentNoteStart - prevNoteEnd,
          hasTimingGap,
          willCreatePhraseBoundary: hasTimingGap
        });
      }
      
      if (hasTimingGap) {
        // End current phrase
        const phraseStartTime = currentPhraseNotes[0].position;
        const phraseEndTime = currentPhraseNotes[currentPhraseNotes.length - 1].position + 
                             currentPhraseNotes[currentPhraseNotes.length - 1].duration;
        
        const lyrics = currentPhraseNotes.map(n => n.lyric).join(' ');
        
        phrases.push({
          verseNumber: phraseNumber,
          startNoteIndex: lyricalNotes.indexOf(currentPhraseNotes[0]),
          endNoteIndex: lyricalNotes.indexOf(currentPhraseNotes[currentPhraseNotes.length - 1]),
          lyrics,
          duration: phraseEndTime - phraseStartTime
        });

        console.log(`Created phrase ${phraseNumber}: "${lyrics}" (gap detected after "${prevNote.lyric}")`);

        // Start new phrase
        currentPhraseNotes = [currentNote];
        phraseNumber++;
      } else {
        // Continue current phrase (notes are connected)
        currentPhraseNotes.push(currentNote);
      }
    }

    // Add final phrase
    if (currentPhraseNotes.length > 0) {
      const phraseStartTime = currentPhraseNotes[0].position;
      const phraseEndTime = currentPhraseNotes[currentPhraseNotes.length - 1].position + 
                           currentPhraseNotes[currentPhraseNotes.length - 1].duration;
      
      const lyrics = currentPhraseNotes.map(n => n.lyric).join(' ');
      
      phrases.push({
        verseNumber: phraseNumber,
        startNoteIndex: lyricalNotes.indexOf(currentPhraseNotes[0]),
        endNoteIndex: lyricalNotes.indexOf(currentPhraseNotes[currentPhraseNotes.length - 1]),
        lyrics,
        duration: phraseEndTime - phraseStartTime
      });

      console.log(`Created final phrase ${phraseNumber}: "${lyrics}"`);
    }

    console.log('Timing gap phrase detection results:', phrases.map(p => ({
      number: p.verseNumber,
      lyrics: p.lyrics.substring(0, 50) + (p.lyrics.length > 50 ? '...' : ''),
      wordCount: p.lyrics.split(' ').length
    })));

    return phrases;
  }

  // OpenUtau export-style phrase detection (replicates RenderPhrase.FromPart logic)
  private detectOpenUtauExportPhrases(): VerseSegment[] {
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.log('No vocal part found for OpenUtau export-style detection');
      return [];
    }

    // Simulate OpenUtau's phoneme generation process
    const simulatedPhonemes = this.simulatePhonemeGeneration(vocalPart.notes);
    if (simulatedPhonemes.length === 0) {
      console.log('No phonemes generated for export-style detection');
      return [];
    }

    console.log('OpenUtau export-style phrase detection:', {
      totalPhonemes: simulatedPhonemes.length,
      firstPhoneme: simulatedPhonemes[0]?.phoneme,
      lastPhoneme: simulatedPhonemes[simulatedPhonemes.length - 1]?.phoneme
    });

    // Apply the exact RenderPhrase.FromPart algorithm:
    // "if (phonemes[i - 1].End != phonemes[i].position) { /* create new phrase */ }"
    const phrases: VerseSegment[] = [];
    let currentPhrasePhonemes: typeof simulatedPhonemes = [simulatedPhonemes[0]];
    let phraseNumber = 1;

    for (let i = 1; i < simulatedPhonemes.length; i++) {
      const prevPhoneme = simulatedPhonemes[i - 1];
      const currentPhoneme = simulatedPhonemes[i];
      
      // OpenUtau's exact gap detection: phonemes[i - 1].End != phonemes[i].position
      const prevPhonemeEnd = prevPhoneme.endTimeMs;
      const currentPhonemeStart = currentPhoneme.timeMs;
      const hasPhonemeGap = Math.abs(prevPhonemeEnd - currentPhonemeStart) > 0.1; // Allow tiny floating point errors
      
      // Debug key transitions
      if (prevPhoneme.parentNote?.lyric === "here" || currentPhoneme.parentNote?.lyric === "The" || 
          prevPhoneme.parentNote?.lyric === "are" || currentPhoneme.parentNote?.lyric === "Every") {
        console.log(`OpenUtau export gap analysis: "${prevPhoneme.parentNote?.lyric}" [${prevPhoneme.phoneme}] → "${currentPhoneme.parentNote?.lyric}" [${currentPhoneme.phoneme}]`, {
          prevPhonemeEnd: prevPhonemeEnd.toFixed(2),
          currentPhonemeStart: currentPhonemeStart.toFixed(2),
          gap: (currentPhonemeStart - prevPhonemeEnd).toFixed(2),
          hasPhonemeGap,
          willCreatePhraseBoundary: hasPhonemeGap
        });
      }
      
      if (hasPhonemeGap) {
        // End current phrase (OpenUtau: phrases.Add(new RenderPhrase(...)))
        const phraseLyrics = this.extractLyricsFromPhonemes(currentPhrasePhonemes);
        const phraseStartTime = currentPhrasePhonemes[0].timeMs;
        const phraseEndTime = currentPhrasePhonemes[currentPhrasePhonemes.length - 1].endTimeMs;
        
        phrases.push({
          verseNumber: phraseNumber,
          startNoteIndex: currentPhrasePhonemes[0].noteIndex,
          endNoteIndex: currentPhrasePhonemes[currentPhrasePhonemes.length - 1].noteIndex,
          lyrics: phraseLyrics,
          duration: phraseEndTime - phraseStartTime
        });

        console.log(`OpenUtau export phrase ${phraseNumber}: "${phraseLyrics}" (phoneme gap detected after "${prevPhoneme.parentNote?.lyric}" [${prevPhoneme.phoneme}])`);

        // Start new phrase (OpenUtau: phrasePhonemes.Clear())
        currentPhrasePhonemes = [currentPhoneme];
        phraseNumber++;
      } else {
        // Continue current phrase (OpenUtau: phrasePhonemes.Add(phonemes[i]))
        currentPhrasePhonemes.push(currentPhoneme);
      }
    }

    // Add final phrase (OpenUtau: if (phrasePhonemes.Count > 0) { phrases.Add(...) })
    if (currentPhrasePhonemes.length > 0) {
      const phraseLyrics = this.extractLyricsFromPhonemes(currentPhrasePhonemes);
      const phraseStartTime = currentPhrasePhonemes[0].timeMs;
      const phraseEndTime = currentPhrasePhonemes[currentPhrasePhonemes.length - 1].endTimeMs;
      
      phrases.push({
        verseNumber: phraseNumber,
        startNoteIndex: currentPhrasePhonemes[0].noteIndex,
        endNoteIndex: currentPhrasePhonemes[currentPhrasePhonemes.length - 1].noteIndex,
        lyrics: phraseLyrics,
        duration: phraseEndTime - phraseStartTime
      });

      console.log(`OpenUtau export final phrase ${phraseNumber}: "${phraseLyrics}"`);
    }

    console.log('OpenUtau export-style phrase detection results:', phrases.map(p => ({
      number: p.verseNumber,
      lyrics: p.lyrics.substring(0, 50) + (p.lyrics.length > 50 ? '...' : ''),
      wordCount: p.lyrics.split(' ').filter(w => w.trim()).length
    })));

    return phrases;
  }

  // Extract unique lyrics from phonemes (excluding SP/AP)
  private extractLyricsFromPhonemes(phonemes: DetailedPhonemeTiming[]): string {
    const lyricalPhonemes = phonemes.filter(p => 
      !p.phoneme.match(/^(SP|AP)$/i) && 
      p.parentNote.lyric && 
      !p.parentNote.lyric.startsWith('+')
    );
    
    const uniqueLyrics = Array.from(new Set(lyricalPhonemes.map(p => p.parentNote.lyric)));
    return uniqueLyrics.join(' ');
  }

  // Simulate OpenUtau's phoneme generation (like enuenuenglish.onnx would do)
  private simulatePhonemeGeneration(notes: any[]): DetailedPhonemeTiming[] {
    const lyricalNotes = notes
      .filter(note => 
        note.lyric && 
        note.lyric.trim() !== '' && 
        !note.lyric.startsWith('+')
      )
      .sort((a, b) => a.position - b.position);

    if (lyricalNotes.length === 0) return [];

    const phonemes: DetailedPhonemeTiming[] = [];
    const bpm = this.ustxData.bpm || 120;
    const resolution = this.ustxData.resolution || 480;
    const msPerTick = (60 * 1000) / (bpm * resolution);

    // Start with SP (like OpenUtau's automatic leading SP)
    phonemes.push({
      partName: 'Vocal',
      noteIndex: 0,
      phoneme: 'SP',
      position: lyricalNotes[0].position - 240, // SP before first note
      duration: 240,
      timeMs: (lyricalNotes[0].position - 240) * msPerTick,
      endTimeMs: lyricalNotes[0].position * msPerTick,
      parentNote: {
        lyric: 'SP',
        tone: lyricalNotes[0].tone,
        position: lyricalNotes[0].position - 240,
        duration: 240
      }
    });

    for (let i = 0; i < lyricalNotes.length; i++) {
      const note = lyricalNotes[i];
      const nextNote = lyricalNotes[i + 1];
      
      // Simple phoneme simulation for common English words
      const notePhonemes = this.simulateWordPhonemes(note.lyric);
      const phonemeDuration = note.duration / notePhonemes.length;
      
      for (let j = 0; j < notePhonemes.length; j++) {
        const phonemePosition = note.position + (j * phonemeDuration);
        const phonemeTimeMs = phonemePosition * msPerTick;
        
        phonemes.push({
          partName: 'Vocal',
          noteIndex: i,
          phoneme: notePhonemes[j],
          position: phonemePosition,
          duration: phonemeDuration,
          timeMs: phonemeTimeMs,
          endTimeMs: phonemeTimeMs + (phonemeDuration * msPerTick),
          parentNote: {
            lyric: note.lyric,
            tone: note.tone,
            position: note.position,
            duration: note.duration
          }
        });
      }

      // Check if we need SP between notes (simulate enuenuenglish.onnx logic)
      if (nextNote) {
        const currentNoteEnd = note.position + note.duration;
        const nextNoteStart = nextNote.position;
        
        // Insert SP only if there's an actual timing gap (like OpenUtau does)
        const needsSP = currentNoteEnd !== nextNoteStart;
        
        if (needsSP) {
          const spPosition = currentNoteEnd;
          const spDuration = nextNoteStart - currentNoteEnd || 240; // Default SP duration
          const spTimeMs = spPosition * msPerTick;
          
          phonemes.push({
            partName: 'Vocal',
            noteIndex: i,
            phoneme: 'SP',
            position: spPosition,
            duration: spDuration,
            timeMs: spTimeMs,
            endTimeMs: spTimeMs + (spDuration * msPerTick),
            parentNote: {
              lyric: 'SP',
              tone: note.tone,
              position: spPosition,
              duration: spDuration
            }
          });

          console.log(`Simulated SP insertion after "${note.lyric}" (timing gap: ${spDuration} ticks)`);
        }
      }
    }

    // End with SP (like OpenUtau's automatic trailing SP)
    const lastNote = lyricalNotes[lyricalNotes.length - 1];
    const finalSpPosition = lastNote.position + lastNote.duration;
    const finalSpTimeMs = finalSpPosition * msPerTick;
    
    phonemes.push({
      partName: 'Vocal',
      noteIndex: lyricalNotes.length - 1,
      phoneme: 'SP',
      position: finalSpPosition,
      duration: 240,
      timeMs: finalSpTimeMs,
      endTimeMs: finalSpTimeMs + (240 * msPerTick),
      parentNote: {
        lyric: 'SP',
        tone: lastNote.tone,
        position: finalSpPosition,
        duration: 240
      }
    });

    return phonemes.sort((a, b) => a.timeMs - b.timeMs);
  }

  // Simple phoneme simulation for common English words
  private simulateWordPhonemes(word: string): string[] {
    const phoneMap: Record<string, string[]> = {
      'here': ['h', 'ih', 'r'],
      'there': ['dh', 'eh', 'r'],
      'where': ['w', 'eh', 'r'],
      'are': ['aa', 'r'],
      'you': ['y', 'uw'],
      'I': ['ay'],
      'the': ['dh', 'ax'],
      'and': ['ax', 'n', 'd'],
      'dream': ['d', 'r', 'iy', 'm'],
      'still': ['s', 't', 'ih', 'l'],
      'ghost': ['g', 'ow', 's', 't'],
      'side': ['s', 'ay', 'd'],
      'my': ['m', 'ay'],
      'by': ['b', 'ay'],
      'a': ['ax'],
      'The': ['dh', 'ax']
    };
    
    return phoneMap[word] || [word.toLowerCase()]; // Fallback to word itself
  }

  // Simulate enuenuenglish.onnx's phrase boundary detection
  private isNaturalPhraseBoundary(currentWord: string, nextWord: string): boolean {
    // Words that commonly end phrases
    const phraseEnders = ['here', 'there', 'are', 'away', 'day', 'say', 'clear'];
    
    // Words that commonly start new phrases  
    const phraseStarters = ['The', 'I', 'Every', 'With', 'A'];
    
    const isCurrentEnder = phraseEnders.includes(currentWord);
    const isNextStarter = phraseStarters.includes(nextWord);
    
    // Debug key transitions
    if (currentWord === 'here' && nextWord === 'The') {
      console.log(`Natural phrase boundary detected: "${currentWord}" → "${nextWord}" (phrase ender + starter)`);
      return true;
    }
    
    return isCurrentEnder || isNextStarter;
  }

  // Enhanced verse detection - DiffSinger script approach
  async detectVersesWithPhonemizer(singerId: string = 'fem_1_ln'): Promise<VerseSegment[]> {
    console.log('[DIFFSTYLE-VERSES] Using DiffSinger-style phoneme processing for verse detection');
    
    try {
      // Call the phonemize API exactly like DiffSinger script does
      const response = await fetch('/api/phonemize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData: this.ustxData,
          singerId: singerId
        })
      });

      if (!response.ok) {
        console.error('[DIFFSTYLE-VERSES] Phonemize API failed:', response.status);
        return this.detectVerses(); // Fallback
      }

      const result = await response.json();
      const phonemes = result.phonemes || [];
      
      console.log(`[DIFFSTYLE-VERSES] Received ${phonemes.length} processed phonemes`);
      console.log(`[DIFFSTYLE-VERSES] SP phonemes found: ${result.debug.silencePhonemes}`);

      // Process phonemes to create verses exactly like DiffSinger would
      return this.createVersesFromProcessedPhonemes(phonemes);

    } catch (error) {
      console.error('[DIFFSTYLE-VERSES] Error processing phonemes:', error);
      return this.detectVerses(); // Fallback
    }
  }

  // Create verses using exact RenderPhrase.FromPart logic with phoneme timings
  private createVersesFromProcessedPhonemes(phonemes: any[]): VerseSegment[] {
    if (!phonemes || phonemes.length === 0) {
      return [];
    }

    console.log(`[PHONEME-VERSES] Using exact RenderPhrase.FromPart logic with ${phonemes.length} phonemes`);

    // Sort phonemes by timing (exactly like RenderPhrase.FromPart does with phonemes)
    const sortedPhonemes = phonemes
      .sort((a, b) => a.TimeMs - b.TimeMs);

    if (sortedPhonemes.length === 0) {
      return [];
    }

    // Group phonemes into phrases using RenderPhrase.FromPart line 501 logic:
    // if (phonemes[i - 1].End != phonemes[i].position)
    const phrases: any[][] = [];
    let currentPhrase: any[] = [sortedPhonemes[0]];

    for (let i = 1; i < sortedPhonemes.length; i++) {
      const prevPhoneme = sortedPhonemes[i - 1];
      const currPhoneme = sortedPhonemes[i];
      
      // Use EXACT RenderPhrase.FromPart logic: if (phonemes[i - 1].End != phonemes[i].position)
      const prevEnd = prevPhoneme.End || 0;
      const currPosition = currPhoneme.Position || 0;
      
      // Exact comparison - no tolerance (just like RenderPhrase.FromPart line 501)
      const hasGap = prevEnd !== currPosition;
      
      if (hasGap) {
        // End current phrase
        phrases.push(currentPhrase);
        console.log(`[PHONEME-VERSES] Phrase boundary at gap: ${prevEnd} → ${currPosition} (${currentPhrase.length} phonemes)`);
        
        // Start new phrase
        currentPhrase = [currPhoneme];
      } else {
        // Continue current phrase
        currentPhrase.push(currPhoneme);
      }
    }
    
    // Add final phrase
    if (currentPhrase.length > 0) {
      phrases.push(currentPhrase);
      console.log(`[PHONEME-VERSES] Final phrase: ${currentPhrase.length} phonemes`);
    }

    console.log(`[PHONEME-VERSES] Split into ${phrases.length} phrases`);

    // Convert phrases to verses
    const verses: VerseSegment[] = [];

    for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex++) {
      const phrasePhonemes = phrases[phraseIndex];
      
      if (phrasePhonemes.length === 0) continue;

      const phraseStartTime = phrasePhonemes[0].TimeMs;
      const phraseEndTime = phrasePhonemes[phrasePhonemes.length - 1].TimeMs;

      // Get the notes that correspond to this phrase timeframe
      const vocalPart = this.getVocalPart();
      if (!vocalPart?.notes) continue;

      const lyricalNotes = vocalPart.notes
        .filter(note => note.lyric && !note.lyric.startsWith('+') && 
                       note.lyric !== 'SP' && note.lyric !== 'AP')
        .sort((a, b) => a.position - b.position);

      // Map phonemes back to notes by note index
      const phraseNoteIndices = new Set<number>();
      phrasePhonemes.forEach(phoneme => {
        if (typeof phoneme.NoteIndex === 'number' && phoneme.NoteIndex >= 0 && phoneme.NoteIndex < lyricalNotes.length) {
          phraseNoteIndices.add(phoneme.NoteIndex);
        }
      });

      const phraseNoteIndicesArray = Array.from(phraseNoteIndices).sort((a, b) => a - b);
      
      if (phraseNoteIndicesArray.length === 0) continue;

      const startNoteIndex = phraseNoteIndicesArray[0];
      const endNoteIndex = phraseNoteIndicesArray[phraseNoteIndicesArray.length - 1];
      
      // Get lyrics from the notes in this phrase
      const phraseNotes = phraseNoteIndicesArray.map(idx => lyricalNotes[idx]);
      const verseLyrics = phraseNotes.map(note => note.lyric).join(' ');

      // Add SP like DiffSinger script (.Prepend("SP").Append("SP"))
      const finalLyrics = verseLyrics + ' SP';

      verses.push({
        verseNumber: phraseIndex + 1,
        startNoteIndex,
        endNoteIndex,
        lyrics: finalLyrics,
        duration: phraseNotes[phraseNotes.length - 1].position + phraseNotes[phraseNotes.length - 1].duration - phraseNotes[0].position
      });

      console.log(`[PHONEME-VERSES] Verse ${phraseIndex + 1}: "${finalLyrics}" (notes ${startNoteIndex}-${endNoteIndex})`);
    }

    return verses;
  }

  // CLI-style verse detection (primary method)
  detectVerses(): VerseSegment[] {
    // First try to use the CLI phrase generation API (most accurate)
    console.log('Attempting CLI phrase generation API for exact phrase detection');
    // Note: This will be called asynchronously via detectVersesWithCLI()
    
    // Fallback to timing gap detection
    console.log('Using CLI-style timing gap detection as fallback (matching RenderPhrase.FromPart logic)');
    const timingGapPhrases = this.detectTimingGapPhrases();
    if (timingGapPhrases.length > 0) {
      console.log(`CLI-style detection found ${timingGapPhrases.length} phrases`);
      return timingGapPhrases;
    }

    // Use phoneme-based detection if available (accounts for phoneme overrides)
    if (this.phonemeData && this.phonemeData.length > 0) {
      console.log('Using phoneme-based phrase detection (includes phoneme override processing)');
      console.log('Sample phoneme data:', this.phonemeData.slice(0, 10).map(p => ({
        phoneme: p.phoneme,
        timeMs: p.timeMs,
        endTimeMs: p.endTimeMs,
        parentLyric: p.parentNote?.lyric
      })));
      const phonemePhrases = this.detectPhonemeBasedPhrases();
      
      // Convert phoneme phrases to verse segments
      return phonemePhrases.map(phrase => ({
        verseNumber: phrase.phraseNumber,
        startNoteIndex: phrase.startNoteIndex,
        endNoteIndex: phrase.endNoteIndex,
        lyrics: phrase.lyrics,
        duration: phrase.endTimeMs - phrase.startTimeMs
      }));
    }
    
    // Fallback to AP phoneme override detection
    const apBasedPhrases = this.detectNoteBasedVerses();
    if (apBasedPhrases.length > 0) {
      console.log('Fallback: Using AP phoneme override detection');
      return apBasedPhrases;
    }

    console.log('No phrases detected by any method');
    return [];
  }

  // Original note-based detection (renamed)
  private detectNoteBasedVerses(): VerseSegment[] {
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.log('No vocal part found for verse detection');
      return [];
    }

    // Get ALL notes (including SP/AP) for proper phrase boundary detection
    const allNotes = vocalPart.notes.filter(note => 
      note.lyric && note.lyric.trim() !== ''
    );

    console.log('All notes for verse detection:', {
      totalNotes: vocalPart.notes.length,
      filteredNotesCount: allNotes.length,
      firstFewLyrics: allNotes.slice(0, 10).map(n => n.lyric)
    });

    if (allNotes.length === 0) {
      console.log('No notes found');
      return [];
    }

    // AP-based verse detection using phoneme overrides
    const verses: VerseSegment[] = [];
    let currentVerseLyrics: string[] = [];
    let currentVerseStart = 0;
    let verseNumber = 1;

    // Filter to only actual lyrical notes (no + syllables)
    const lyricalNotes = allNotes.filter(note => 
      !note.lyric.startsWith('+') && note.lyric !== 'SP' && note.lyric !== 'AP'
    );

    // Collect all AP and SP phoneme override positions
    const phraseBreakPositions = new Set<number>();
    this.ustxData.voice_parts?.forEach(part => {
      part.notes?.forEach(note => {
        note.phoneme_overrides?.forEach(override => {
          if (override.phoneme === 'AP' || override.phoneme === 'SP') {
            phraseBreakPositions.add(note.position);
            console.log(`Found ${override.phoneme} override at position ${note.position}, note: "${note.lyric}"`);
          }
        });
      });
    });

    console.log(`Found ${phraseBreakPositions.size} AP/SP positions for phrase boundaries`);

    for (let i = 0; i < lyricalNotes.length; i++) {
      const note = lyricalNotes[i];
      const nextNote = lyricalNotes[i + 1];
      
      // Check if current note has AP or SP phoneme override (indicates new line starts here)
      const hasPhraseBreakOverride = phraseBreakPositions.has(note.position);
      
      // Special case: Don't treat SP override at the very last note as a new verse
      // (it's just ending silence that belongs to the previous verse)
      const isLastNote = i === lyricalNotes.length - 1;
      const isEndingSP = isLastNote && note.phoneme_overrides?.some(override => override.phoneme === 'SP');
      
      // If this note has AP/SP and it's not the first note, end the previous verse first
      // But skip if it's an ending SP override on the last note
      if (hasPhraseBreakOverride && i > 0 && !isEndingSP) {
        console.log(`Phrase break override at "${note.lyric}" - ending previous line and starting new line`);
        
        // End the previous verse (without including current note)
        const prevNoteEnd = lyricalNotes[i - 1].position + lyricalNotes[i - 1].duration;
        verses.push({
          verseNumber,
          startNoteIndex: currentVerseStart,
          endNoteIndex: i - 1,
          lyrics: currentVerseLyrics.join(' '),
          duration: prevNoteEnd - lyricalNotes[currentVerseStart].position
        });

        console.log(`Created verse ${verseNumber}: "${currentVerseLyrics.join(' ')}" (ended before phrase break at "${note.lyric}")`);

        // Start new verse with current note
        currentVerseStart = i;
        currentVerseLyrics = [];
        verseNumber++;
      }
      
      // Add current note to current verse
      currentVerseLyrics.push(note.lyric || '');

      // End verse if this is the last note
      if (!nextNote) {
        const noteEnd = note.position + note.duration;
        verses.push({
          verseNumber,
          startNoteIndex: currentVerseStart,
          endNoteIndex: i,
          lyrics: currentVerseLyrics.join(' '),
          duration: noteEnd - lyricalNotes[currentVerseStart].position
        });

        console.log(`Created final verse ${verseNumber}: "${currentVerseLyrics.join(' ')}"`);
      }
    }

    console.log('Detected verses:', verses.map(v => ({
      number: v.verseNumber,
      lyrics: v.lyrics.substring(0, 50) + '...',
      wordCount: v.lyrics.split(' ').length
    })));

    return verses;
  }

  // Set phoneme data for enhanced phrase detection
  setPhonemeData(phonemeData: DetailedPhonemeTiming[]) {
    this.phonemeData = phonemeData;
  }

  // Set phoneme data from CLI output
  setPhonemeDataFromCLI(cliPhonemeData: PhonemeTiming[]) {
    this.phonemeData = this.convertPhonemeData(cliPhonemeData);
  }

  // CLI-based phrase detection using actual OpenUtau CLI
  async detectVersesWithCLI(singerId: string = 'fem_1_ln'): Promise<VerseSegment[]> {
    console.log('[CLI-PHRASES] Using actual OpenUtau CLI for phrase detection');
    
    try {
      // Call the phrases API
      const response = await fetch('/api/phrases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData: this.ustxData,
          singerId: singerId
        })
      });

      if (!response.ok) {
        console.error('[CLI-PHRASES] Phrases API failed:', response.status);
        return this.detectVerses(); // Fallback
      }

      const result = await response.json();
      console.log(`[CLI-PHRASES] CLI generated ${result.totalPhrases} phrases`);
      
      // Map CLI phrases to note indices using timing information
      // IMPORTANT: Use the same note filtering as applyVerseUpdate() to ensure consistent indexing
      const vocalPart = this.getVocalPart();
      if (!vocalPart?.notes) return [];
      
      // Filter to only lyrical notes (same as applyVerseUpdate method)
      const lyricalNotes = vocalPart.notes.filter(note => 
        note.lyric && note.lyric.trim() !== '' && !note.lyric.startsWith('+')
      );
      
      const msPerTick = 60000 / (this.ustxData.bpm * this.ustxData.resolution);

      // Convert CLI phrases to verse segments
      const verses: VerseSegment[] = result.phrases.map((phrase: any) => {
        // Find lyrical notes that overlap with this phrase's timing
        const phraseStartMs = phrase.startTimeMs;
        const phraseEndMs = phrase.endTimeMs;
        
        let startNoteIndex = -1;
        let endNoteIndex = -1;
        
        // Map timing to lyrical note indices (consistent with applyVerseUpdate)
        for (let i = 0; i < lyricalNotes.length; i++) {
          const note = lyricalNotes[i];
          const noteStartMs = note.position * msPerTick;
          const noteEndMs = (note.position + note.duration) * msPerTick;
          
          // Find first lyrical note that overlaps with phrase start
          if (startNoteIndex === -1 && noteEndMs > phraseStartMs) {
            startNoteIndex = i;
          }
          
          // Find last lyrical note that starts within this phrase
          if (noteStartMs >= phraseStartMs && noteStartMs < phraseEndMs) {
            endNoteIndex = i;
          }
        }
        
        // Debug: show what lyrical notes are in this range
        const rangeNotes = lyricalNotes.slice(startNoteIndex, endNoteIndex + 1);
        const rangeNoteTexts = rangeNotes.map(n => n.lyric).join(' ');
        console.log(`[CLI-PHRASES] Phrase ${phrase.phraseNumber}: "${phrase.lyrics}"`);
        console.log(`  → lyrical notes ${startNoteIndex}-${endNoteIndex} (${phraseStartMs.toFixed(0)}-${phraseEndMs.toFixed(0)}ms)`);
        console.log(`  → actual lyrical notes: "${rangeNoteTexts}"`);
        
        return {
          verseNumber: phrase.phraseNumber,
          startNoteIndex: Math.max(0, startNoteIndex),
          endNoteIndex: Math.max(0, endNoteIndex),
          lyrics: phrase.lyrics,
          duration: phrase.durationMs
        };
      });

      console.log(`[CLI-PHRASES] Converted to ${verses.length} verse segments`);
      return verses;

    } catch (error) {
      console.error('[CLI-PHRASES] Error calling CLI phrases API:', error);
      return this.detectVerses(); // Fallback
    }
  }

  // Simple direct verse detection that groups consecutive lyrical notes
  detectVersesSimple(): VerseSegment[] {
    console.log('Using simple direct verse detection (grouping consecutive notes)');
    
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.log('No vocal part found');
      return [];
    }

    // Get all lyrical notes (excluding + syllables, SP, AP)
    const lyricalNotes = vocalPart.notes
      .filter(note => 
        note.lyric && 
        note.lyric.trim() !== '' && 
        !note.lyric.startsWith('+') &&
        note.lyric !== 'SP' && 
        note.lyric !== 'AP'
      )
      .sort((a, b) => a.position - b.position);

    console.log('Simple detection - lyrical notes:', lyricalNotes.map(n => n.lyric));

    if (lyricalNotes.length === 0) {
      return [];
    }

    // Simple approach: group notes into verses of approximately 8-12 words each
    const verses: VerseSegment[] = [];
    const wordsPerVerse = 10; // Target words per verse
    let currentVerseStart = 0;
    let currentWordCount = 0;
    let verseNumber = 1;

    for (let i = 0; i < lyricalNotes.length; i++) {
      currentWordCount++;
      
      // End verse when we hit target word count OR at the last note
      const shouldEndVerse = currentWordCount >= wordsPerVerse || i === lyricalNotes.length - 1;
      
      if (shouldEndVerse) {
        const verseNotes = lyricalNotes.slice(currentVerseStart, i + 1);
        const verseLyrics = verseNotes.map(note => note.lyric).join(' ');
        
        verses.push({
          verseNumber: verseNumber,
          startNoteIndex: currentVerseStart,
          endNoteIndex: i,
          lyrics: verseLyrics,
          duration: verseNotes[verseNotes.length - 1].position + verseNotes[verseNotes.length - 1].duration - verseNotes[0].position
        });

        console.log(`Simple detection - Verse ${verseNumber}: "${verseLyrics}"`);
        
        // Start next verse
        currentVerseStart = i + 1;
        currentWordCount = 0;
        verseNumber++;
      }
    }

    return verses;
  }

  // Get metadata for API (without sending full USTX)
  async getLyricsMetadata(singerId: string = 'fem_1_ln') {
    console.log('Getting lyrics metadata using SIMPLE direct detection...');
    
    // Use simple direct detection instead of complex CLI/timing methods
    const verses = this.detectVersesSimple();
    const allLyrics = this.getAllLyrics();
    
    const metadata = {
      totalVerses: verses.length,
      hasLyrics: allLyrics.length > 0,
      allLyrics: allLyrics,
      verses: verses.map(v => ({
        number: v.verseNumber,
        lyrics: v.lyrics,
        wordCount: v.lyrics.split(' ').length
      })),
      hasPhonemeData: !!this.phonemeData && this.phonemeData.length > 0,
      detectionMethod: 'simple-direct'
    };

    console.log('Generated SIMPLE lyrics metadata:', metadata);
    return metadata;
  }
}