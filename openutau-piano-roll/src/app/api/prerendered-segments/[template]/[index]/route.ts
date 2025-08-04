import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ template: string; index: string }> }
) {
  try {
    const { template, index } = await params;
    const segmentIndex = parseInt(index);
    
    console.log(`🎵 Request for prerendered segment: ${template}/${segmentIndex}`);
    
    // First, try to find actual prerendered segment
    const prerenderedPaths = [
      // Check where the script now saves (from parent directory)
      join(process.cwd(), '..', 'prerendered', `${template}_segment_${segmentIndex}.wav`),
      // Check current directory as fallback
      join(process.cwd(), 'prerendered', `${template}_segment_${segmentIndex}.wav`),
      // Check other possible locations for backwards compatibility
      join(process.cwd(), '..', '.prerendered_segments', `${template}_segment_${segmentIndex}.wav`),
      join(process.cwd(), 'prerendered_segments', template, `segment_${segmentIndex}.wav`),
    ];
    
    for (const path of prerenderedPaths) {
      if (existsSync(path)) {
        console.log(`✅ Found prerendered segment: ${path}`);
        const audioBuffer = readFileSync(path);
        
        return new NextResponse(audioBuffer, {
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': audioBuffer.length.toString(),
            'Cache-Control': 'public, max-age=3600',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }
    }
    
    // If no prerendered segment found, generate silence based on template metadata
    console.log(`🔇 No prerendered segment found for ${template}/${segmentIndex}, generating silence...`);
    
    // Get verse duration from template metadata
    const templateResponse = await fetch(`http://localhost:3001/api/templates?name=${template}`);
    let verseDurationMs = 4000; // Default 4 seconds
    
    if (templateResponse.ok) {
      const templateData = await templateResponse.json();
      if (templateData.cachedVerseDetection?.verses?.[segmentIndex]) {
        const verse = templateData.cachedVerseDetection.verses[segmentIndex];
        if (verse.durationMs) {
          verseDurationMs = verse.durationMs;
        }
      }
    }
    
    // Generate silence audio (WAV format)
    const sampleRate = 44100;
    const channels = 2; // Stereo
    const durationSeconds = verseDurationMs / 1000;
    const numSamples = Math.ceil(sampleRate * durationSeconds);
    
    // Create WAV header (44 bytes)
    const wavHeaderSize = 44;
    const dataSize = numSamples * channels * 2; // 16-bit samples
    const fileSize = wavHeaderSize + dataSize - 8;
    
    const buffer = Buffer.alloc(wavHeaderSize + dataSize);
    let offset = 0;
    
    // WAV header
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // PCM format chunk size
    buffer.writeUInt16LE(1, offset); offset += 2;  // PCM format
    buffer.writeUInt16LE(channels, offset); offset += 2; // Channels
    buffer.writeUInt32LE(sampleRate, offset); offset += 4; // Sample rate
    buffer.writeUInt32LE(sampleRate * channels * 2, offset); offset += 4; // Byte rate
    buffer.writeUInt16LE(channels * 2, offset); offset += 2; // Block align
    buffer.writeUInt16LE(16, offset); offset += 2; // Bits per sample
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;
    
    // Data is already zero-filled (silence), so no need to write samples
    
    console.log(`🔇 Generated ${durationSeconds.toFixed(2)}s silence for segment ${segmentIndex}`);
    
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=300', // Shorter cache for generated silence
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Generated': 'silence', // Indicate this was generated
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