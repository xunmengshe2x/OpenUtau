import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const template = searchParams.get('template');
    const segment = searchParams.get('segment');
    const manifest = searchParams.get('manifest');
    
    // Handle manifest request
    if (manifest) {
      console.log(`📋 Serving prerendered manifest for: ${manifest}`);
      
      const manifestPath = join(process.cwd(), '..', 'prerendered', `${manifest}_manifest.json`);
      
      if (!existsSync(manifestPath)) {
        console.log(`⚠️ Manifest not found: ${manifestPath}`);
        return NextResponse.json({ error: 'Manifest not found' }, { status: 404 });
      }
      
      const manifestData = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      console.log(`✅ Serving manifest: ${manifestData.segments?.length || 0} segments`);
      
      return NextResponse.json(manifestData, {
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    
    if (!template || !segment) {
      return NextResponse.json({ error: 'Missing template or segment parameter' }, { status: 400 });
    }
    
    console.log(`🎵 Serving prerendered segment: ${template}/${segment}`);
    
    // Build path to segment file
    const segmentPath = join(process.cwd(), '.prerendered_segments', template, `${segment}.wav`);
    
    if (!existsSync(segmentPath)) {
      console.log(`⚠️ Segment not found: ${segmentPath}`);
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
    }
    
    // Read the audio file
    const audioBuffer = readFileSync(segmentPath);
    
    console.log(`✅ Serving segment ${segment}: ${audioBuffer.length} bytes`);
    
    // Return as audio/wav
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
    
  } catch (error) {
    console.error('Error serving prerendered segment:', error);
    return NextResponse.json({ 
      error: 'Failed to serve segment',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}