import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');
    
    if (!filePath) {
      return NextResponse.json({ error: 'Missing file path' }, { status: 400 });
    }
    
    console.log(`📁 Serving segment file: ${filePath}`);
    
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'Segment file not found' }, { status: 404 });
    }
    
    // Read and serve the segment audio file
    const audioBuffer = readFileSync(filePath);
    
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
    
  } catch (error) {
    console.error('Error serving segment file:', error);
    return NextResponse.json({ 
      error: 'Failed to serve segment file',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}