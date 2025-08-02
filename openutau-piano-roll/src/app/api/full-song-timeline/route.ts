import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface PhonemeData {
  PartName: string;
  NoteIndex: number;
  Phoneme: string;
  TimeMs: number;
  Position: number;
  Duration: number;
  End: number;
}

interface VerseData {
  verseNumber: number;
  lyrics: string;
  startNoteIndex: number;
  endNoteIndex: number;
  wordCount: number;
  durationMs: number;
}

interface TimelineSegment {
  verseNumber: number;
  lyrics: string;
  startNoteIndex: number;
  endNoteIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  hasAudio: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateName = searchParams.get('template') || 'still_here_original';
    
    console.log(`📊 Building full song timeline for ${templateName}...`);
    
    // Load verse cache data
    const cacheFile = join(process.cwd(), `${templateName}_cache.json`);
    if (!existsSync(cacheFile)) {
      return NextResponse.json({ error: 'Cache file not found' }, { status: 404 });
    }
    
    const cacheData = JSON.parse(readFileSync(cacheFile, 'utf8'));
    const verses: VerseData[] = cacheData.verses;
    
    // Load phoneme timing data
    const phrasesFile = join(process.cwd(), `${templateName}_phrases.json`);
    if (!existsSync(phrasesFile)) {
      return NextResponse.json({ error: 'Phrases file not found' }, { status: 404 });
    }
    
    const phrasesData: PhonemeData[] = JSON.parse(readFileSync(phrasesFile, 'utf8'));
    
    console.log(`📈 Processing ${verses.length} verses with ${phrasesData.length} phonemes`);
    
    // Calculate precise timing for each verse based on phoneme data
    const timeline: TimelineSegment[] = [];
    
    for (const verse of verses) {
      // Find all phonemes for this verse
      const versePhonemes = phrasesData.filter(p => 
        p.NoteIndex >= verse.startNoteIndex && 
        p.NoteIndex <= verse.endNoteIndex
      );
      
      if (versePhonemes.length === 0) {
        console.warn(`⚠️  No phonemes found for verse ${verse.verseNumber}`);
        continue;
      }
      
      // Calculate start and end times from actual phoneme timing
      const startTimeMs = Math.min(...versePhonemes.map(p => p.TimeMs));
      
      // For end time, we need to consider the last phoneme's duration
      const lastPhoneme = versePhonemes[versePhonemes.length - 1];
      const phonemeDurationMs = (lastPhoneme.Duration / 480) * (60000 / 135); // Convert ticks to ms at 135 BPM
      const endTimeMs = lastPhoneme.TimeMs + phonemeDurationMs;
      
      // Check if pre-rendered audio exists for this verse
      const prerenderedDir = join(process.cwd(), '.prerendered_segments');
      const segmentFile = join(prerenderedDir, `${templateName}`, `${verse.startNoteIndex}.wav`);
      const hasAudio = existsSync(segmentFile);
      
      const segment: TimelineSegment = {
        verseNumber: verse.verseNumber,
        lyrics: verse.lyrics,
        startNoteIndex: verse.startNoteIndex,
        endNoteIndex: verse.endNoteIndex,
        startTimeMs,
        endTimeMs,
        durationMs: endTimeMs - startTimeMs,
        hasAudio
      };
      
      timeline.push(segment);
      
      console.log(`🎵 Verse ${verse.verseNumber}: ${startTimeMs.toFixed(1)}ms - ${endTimeMs.toFixed(1)}ms (${segment.durationMs.toFixed(1)}ms) ${hasAudio ? '✅' : '❌'}`);
    }
    
    // Calculate total duration
    const totalDurationMs = timeline.length > 0 ? 
      Math.max(...timeline.map(s => s.endTimeMs)) : 0;
    
    const result = {
      templateName,
      totalDurationMs,
      totalSegments: timeline.length,
      availableSegments: timeline.filter(s => s.hasAudio).length,
      timeline,
      generatedAt: new Date().toISOString()
    };
    
    console.log(`✅ Timeline built: ${result.availableSegments}/${result.totalSegments} segments available, ${(totalDurationMs / 1000).toFixed(1)}s total`);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Error building timeline:', error);
    return NextResponse.json({ 
      error: 'Failed to build timeline',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}