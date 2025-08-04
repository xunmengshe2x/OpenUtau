import { useState, useCallback, useRef } from 'react';
import { USTXData, PhonemeTiming, DetailedPhonemeTiming } from '@/types/openutau';

interface PhonemeProcessingResult {
  phonemeTimings: PhonemeTiming[];
  success: boolean;
  debug?: {
    stdout: string;
    stderr: string;
  };
}

interface PhonemeProcessingState {
  isProcessing: boolean;
  phonemeData: DetailedPhonemeTiming[] | null;
  error: string | null;
}

interface PhonemeCache {
  [key: string]: {
    data: DetailedPhonemeTiming[];
    timestamp: number;
  };
}

export function usePhonemeProcessing() {
  const [state, setState] = useState<PhonemeProcessingState>({
    isProcessing: false,
    phonemeData: null,
    error: null
  });
  
  // Simple in-memory cache for phoneme data
  const cacheRef = useRef<PhonemeCache>({});
  const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
  
  // Generate cache key based on USTX content and singer
  const getCacheKey = useCallback((ustxData: USTXData, singerId: string): string => {
    const vocalPart = ustxData.voice_parts?.find(part => 
      part.notes && part.notes.some(note => note.lyric && note.lyric.trim() !== '')
    );
    
    if (!vocalPart?.notes) return '';
    
    // Create a hash-like key based on lyrics and timing
    const notesKey = vocalPart.notes
      .filter(n => n.lyric && n.lyric.trim() !== '')
      .map(n => `${n.lyric}:${n.position}:${n.duration}`)
      .join('|');
    
    return `${singerId}:${notesKey.substring(0, 100)}`; // Limit length
  }, []);

  const processUSTX = useCallback(async (ustxData: USTXData, singerId: string): Promise<DetailedPhonemeTiming[] | null> => {
    // Check cache first
    const cacheKey = getCacheKey(ustxData, singerId);
    if (cacheKey) {
      const cached = cacheRef.current[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Using cached phoneme data', { cacheKey });
        setState(prev => ({ 
          ...prev, 
          phonemeData: cached.data,
          error: null 
        }));
        return cached.data;
      }
    }

    setState(prev => ({ ...prev, isProcessing: true, error: null }));

    try {
      console.log('Processing USTX for phonemes...', { singerId, cacheKey });

      const response = await fetch('/api/phonemize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData,
          singerId
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Phonemization failed');
      }

      const result: PhonemeProcessingResult = await response.json();
      
      if (!result.success || !result.phonemeTimings) {
        throw new Error('Failed to get phoneme timings');
      }

      console.log('Phoneme processing successful:', {
        phonemeCount: result.phonemeTimings.length,
        debug: result.debug
      });

      // Convert CLI format to detailed format
      const detailedPhonemes = convertToDetailedFormat(result.phonemeTimings, ustxData);
      
      // Cache the result
      if (cacheKey) {
        cacheRef.current[cacheKey] = {
          data: detailedPhonemes,
          timestamp: Date.now()
        };
      }
      
      setState(prev => ({ 
        ...prev, 
        isProcessing: false, 
        phonemeData: detailedPhonemes,
        error: null 
      }));

      return detailedPhonemes;

    } catch (error) {
      console.error('Phoneme processing failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ 
        ...prev, 
        isProcessing: false, 
        error: errorMessage 
      }));
      return null;
    }
  }, [getCacheKey]);

  const clearPhonemeData = useCallback(() => {
    setState(prev => ({ ...prev, phonemeData: null, error: null }));
    // Clear cache as well
    cacheRef.current = {};
  }, []);

  return {
    ...state,
    processUSTX,
    clearPhonemeData
  };
}

function convertToDetailedFormat(cliPhonemeData: PhonemeTiming[], ustxData: USTXData): DetailedPhonemeTiming[] {
  const vocalPart = ustxData.voice_parts?.find(part => 
    part.notes && part.notes.some(note => note.lyric && note.lyric.trim() !== '')
  );

  if (!vocalPart?.notes) return [];

  const detailed: DetailedPhonemeTiming[] = [];
  const resolution = ustxData.resolution || 480;

  for (let i = 0; i < cliPhonemeData.length; i++) {
    const phoneme = cliPhonemeData[i];
    const note = vocalPart.notes[phoneme.NoteIndex];
    if (!note) continue;

    // Convert milliseconds to ticks (approximate)
    const bpm = ustxData.bpm || 120;
    const msPerTick = (60 * 1000) / (bpm * resolution);
    const positionTicks = Math.round(phoneme.TimeMs / msPerTick);
    
    // Calculate duration based on next phoneme or default
    const nextPhoneme = cliPhonemeData[i + 1];
    let endTimeMs = phoneme.TimeMs + 100; // Default 100ms duration
    
    if (nextPhoneme) {
      endTimeMs = nextPhoneme.TimeMs;
    } else {
      // Last phoneme - estimate based on note end
      const noteEndMs = phoneme.TimeMs + ((note.duration / resolution) * (60 * 1000 / bpm));
      endTimeMs = noteEndMs;
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