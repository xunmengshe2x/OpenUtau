import { NextRequest, NextResponse } from 'next/server';
import { USTXData } from '@/types/openutau';

// Modal configuration - phonemize endpoint
const MODAL_PHONEMIZE_URL = 'https://wwatashi84--openutau-voice-synthesis-web-phonemize.modal.run';

interface PhonemeTimingData {
  PartName: string;
  NoteIndex: number;
  Phoneme: string;
  TimeMs: number;
}

export async function POST(request: NextRequest) {
  try {
    const { ustxData, singerId } = await request.json();
    
    if (!ustxData || !singerId) {
      return NextResponse.json({ error: 'Missing ustxData or singerId' }, { status: 400 });
    }

    console.log('🚀 Using Modal for phonemization...');
    
    try {
      // Call Modal endpoint
      const modalResponse = await fetch(MODAL_PHONEMIZE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData,
          singerId
        }),
      });

      if (!modalResponse.ok) {
        throw new Error(`Modal phonemize request failed: ${modalResponse.status} ${modalResponse.statusText}`);
      }

      const modalResult = await modalResponse.json();
      
      if (modalResult.success) {
        console.log(`✅ Modal phonemization successful! ${modalResult.total_phonemes} phonemes processed`);
        
        return NextResponse.json({
          success: true,
          phonemes: modalResult.phonemes,
          debug: {
            source: 'modal',
            totalPhonemes: modalResult.total_phonemes,
            silencePhonemes: modalResult.phonemes.filter((p: PhonemeTimingData) => 
              p.Phoneme.toUpperCase() === 'SP' || p.Phoneme.toUpperCase() === 'AP'
            ).length
          }
        });
      } else {
        throw new Error(modalResult.error || 'Modal phonemization returned unsuccessful result');
      }
    } catch (error) {
      console.error('❌ Modal phonemization failed:', error);
      return NextResponse.json({
        success: false,
        error: 'Phonemization failed',
        details: error instanceof Error ? error.message : 'Unknown Modal error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Phonemize API error:', error);
    return NextResponse.json({ 
      error: 'Failed to process phonemization request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const maxDuration = 60; // Modal calls can take some time