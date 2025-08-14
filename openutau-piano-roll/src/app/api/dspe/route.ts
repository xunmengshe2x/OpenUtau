import { NextRequest, NextResponse } from 'next/server';

// Modal ds_phrase_extractor endpoint for DiffSinger phrase boundaries
const MODAL_DS_EXTRACTOR_URL = 'https://wwatashi84--openutau-voice-synthesis-ds-phrase-extractor.modal.run';

export async function POST(request: NextRequest) {
  try {
    const { ustxData, singerId } = await request.json();
    
    if (!ustxData || !singerId) {
      return NextResponse.json(
        { error: 'Missing ustxData or singerId' },
        { status: 400 }
      );
    }

    console.log('[DSPE-API] Starting DiffSinger phrase extraction via Modal for singer:', singerId);

    try {
      // Call Modal's ds_phrase_extractor endpoint for DiffSinger phrase boundaries
      const modalResponse = await fetch(MODAL_DS_EXTRACTOR_URL, {
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
        throw new Error(`Modal DS extractor failed: ${modalResponse.status} ${modalResponse.statusText}`);
      }

      const modalResult = await modalResponse.json();
      
      if (!modalResult.success) {
        throw new Error(modalResult.error || 'Modal DS extractor returned unsuccessful result');
      }

      console.log(`[DSPE-API] ✅ Modal DS extractor successful - got ${modalResult.phrases?.length || 0} phrases`);

      // Modal DS extractor returns: { success: true, phrases: [...] }
      // Format: phrases with startNoteIndex/endNoteIndex but NO startTimeMs/endTimeMs
      
      const phrases = modalResult.phrases || [];
      
      return NextResponse.json({
        success: true,
        phrases: phrases,
        totalPhrases: phrases.length,
        method: 'modal-ds-extractor',
        singerId: singerId,
        note: 'This endpoint returns DiffSinger format (startNoteIndex/endNoteIndex). For timing-based phrases, use /api/phrases'
      });

    } catch (modalError) {
      console.error('[DSPE-API] ❌ Modal DS extractor failed:', modalError);
      
      return NextResponse.json({
        error: 'DiffSinger phrase extraction failed',
        details: modalError instanceof Error ? modalError.message : 'Unknown Modal error',
        method: 'modal-ds-extractor-failed'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[DSPE-API] ❌ Request processing failed:', error);
    return NextResponse.json({
      error: 'Failed to process DiffSinger phrase extraction request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const maxDuration = 60; // Modal calls can take some time