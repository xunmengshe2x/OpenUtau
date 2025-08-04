import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { testType, ustxData, singerId } = await request.json();
    
    if (!testType || !ustxData || !singerId) {
      return NextResponse.json({ error: 'Missing testType, ustxData, or singerId' }, { status: 400 });
    }

    console.log(`🔬 Testing Modal ${testType} function...`);

    // Prepare Modal request
    const modalRequest = {
      ustxData,
      singerId,
      qualitySettings: {
        diffSingerDepth: 1000,
        diffSingerSteps: 1000,
        diffSingerStepsPitch: 5,
        diffSingerStepsVariance: 4
      }
    };

    let modalUrl: string;
    if (testType === 'phonemize') {
      modalUrl = 'https://wwatashi84--openutau-voice-synthesis-web-phonemize.modal.run';
    } else if (testType === 'render') {
      modalUrl = 'https://wwatashi84--openutau-voice-synthesis-web-render-segment.modal.run';
    } else {
      return NextResponse.json({ error: 'Invalid testType. Use "phonemize" or "render"' }, { status: 400 });
    }

    console.log(`🚀 Calling Modal at: ${modalUrl}`);

    // Call Modal function
    const modalResponse = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(modalRequest),
    });

    const modalResult = await modalResponse.json();

    console.log(`📊 Modal response status: ${modalResponse.status}`);
    console.log(`📊 Modal result:`, modalResult);

    if (!modalResponse.ok) {
      throw new Error(`Modal request failed: ${modalResult.error || modalResponse.statusText}`);
    }

    return NextResponse.json({
      success: true,
      modalResult,
      testType,
      message: `Modal ${testType} test completed successfully`
    });

  } catch (error) {
    console.error('Modal test error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Modal test failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}