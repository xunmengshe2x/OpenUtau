import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface SegmentUpdate {
  templateName: string;
  verseNumber: number;
  startNoteIndex: number;
  endNoteIndex: number;
  audioData: ArrayBuffer;
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Updating full song segment...');
    
    const formData = await request.formData();
    const templateName = formData.get('templateName') as string;
    const verseNumber = parseInt(formData.get('verseNumber') as string);
    const startNoteIndex = parseInt(formData.get('startNoteIndex') as string);
    const endNoteIndex = parseInt(formData.get('endNoteIndex') as string);
    const audioFile = formData.get('audioData') as File;
    
    if (!templateName || !audioFile) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    console.log(`📝 Updating verse ${verseNumber} (${startNoteIndex}-${endNoteIndex}) for ${templateName}`);
    
    // Save the new segment audio
    // Fix: Use the same absolute path as openutau-mix API uses
    const segmentDir = join('/workspaces/OpenUtau', '.segment_updates', templateName);
    const segmentFile = join(segmentDir, `verse_${verseNumber}.wav`);
    
    // Create directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync(segmentDir)) {
      fs.mkdirSync(segmentDir, { recursive: true });
    }
    
    // Save the new segment
    const audioBuffer = await audioFile.arrayBuffer();
    writeFileSync(segmentFile, Buffer.from(audioBuffer));
    
    console.log(`💾 Saved updated segment: ${segmentFile} (${audioBuffer.byteLength} bytes)`);
    
    // Now we need to rebuild the full song
    // For now, we'll create a simple approach - just invalidate the current full song
    // so it gets regenerated on next request
    
    // Create a metadata file to track updates
    const metadataFile = join(segmentDir, 'updates.json');
    let updates = {};
    
    if (existsSync(metadataFile)) {
      updates = JSON.parse(readFileSync(metadataFile, 'utf8'));
    }
    
    updates[`verse_${verseNumber}`] = {
      status: 'updated',
      timestamp: Date.now(),
      startNoteIndex,
      endNoteIndex,
      audioPath: segmentFile
    };
    
    writeFileSync(metadataFile, JSON.stringify(updates, null, 2));
    
    console.log(`✅ Segment update recorded for verse ${verseNumber}`);
    
    return NextResponse.json({ 
      success: true,
      message: `Updated verse ${verseNumber}`,
      segmentFile,
      verseNumber
    });
    
  } catch (error) {
    console.error('Error updating segment:', error);
    return NextResponse.json({ 
      error: 'Failed to update segment',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}