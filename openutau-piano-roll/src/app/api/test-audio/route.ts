import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🎵 Test audio endpoint called');
    
    // Create a tiny test audio file (just some bytes)
    const testAudioData = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x24, 0x00, 0x00, 0x00, // File size
      0x57, 0x41, 0x56, 0x45, // "WAVE"
      // Minimal WAV header...
    ]);
    
    return new NextResponse(testAudioData, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': testAudioData.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
    
  } catch (error) {
    console.error('Test audio error:', error);
    return NextResponse.json({ error: 'Test failed' }, { status: 500 });
  }
}