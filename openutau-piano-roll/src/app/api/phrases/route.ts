import { NextRequest, NextResponse } from 'next/server';

// Modal phonemize endpoint
const MODAL_PHONEMIZE_URL = 'https://wwatashi84--openutau-voice-synthesis-web-phonemize.modal.run';

export async function POST(request: NextRequest) {
  try {
    const { ustxData, singerId } = await request.json();
    
    if (!ustxData || !singerId) {
      return NextResponse.json(
        { error: 'Missing ustxData or singerId' },
        { status: 400 }
      );
    }

    console.log('[PHRASES-API] Starting phrase generation via Modal for singer:', singerId);

    try {
      // Call Modal's phonemize endpoint
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
        throw new Error(`Modal phonemize failed: ${modalResponse.status} ${modalResponse.statusText}`);
      }

      const modalResult = await modalResponse.json();
      
      if (!modalResult.success) {
        throw new Error(modalResult.error || 'Modal phonemize returned unsuccessful result');
      }

      console.log(`[PHRASES-API] ✅ Modal phonemize successful - got ${modalResult.total_phonemes} phonemes`);

      // Convert Modal's phoneme data to the expected phrases format
      // Modal returns: { success: true, phonemes: [...], total_phonemes: N }
      // We need to return: { phrases: [...] }
      
      const phrases = modalResult.phonemes || [];
      
      return NextResponse.json({
        success: true,
        phrases: phrases,
        totalPhrases: phrases.length,
        method: 'modal-phonemize',
        singerId: singerId
      });

    } catch (modalError) {
      console.error('[PHRASES-API] ❌ Modal phonemize failed:', modalError);
      
      // Return error but don't crash the API
      return NextResponse.json({
        error: 'Phrase generation failed',
        details: modalError instanceof Error ? modalError.message : 'Unknown Modal error',
        method: 'modal-phonemize-failed'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[PHRASES-API] ❌ Request processing failed:', error);
    return NextResponse.json({
      error: 'Failed to process phrases request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const maxDuration = 60; // Modal calls can take some time