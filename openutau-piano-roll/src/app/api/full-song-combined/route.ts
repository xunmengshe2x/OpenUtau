import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const template = searchParams.get('template') || 'still_here_original';
    
    console.log(`🎼 Serving combined full song for ${template}...`);
    
    // Check if there are segment updates first (highest priority)
    const updatesDir = join(process.cwd(), '.segment_updates', template);
    const updatesFile = join(updatesDir, 'updates.json');
    
    console.log(`🔍 Checking for segment updates: ${updatesFile}`);
    console.log(`📁 Updates file exists: ${existsSync(updatesFile)}`);
    
    if (existsSync(updatesFile)) {
      console.log('🔄 Found segment updates, using FFmpeg segment combination...');
      
      // Use FFmpeg to combine original audio with updated segments
      const updates = JSON.parse(readFileSync(updatesFile, 'utf8'));
      
      const combinedAudioPath = await rebuildFullSongWithReplacements(template, '/workspaces/OpenUtau/still_here_original_full_song.wav', updatesFile);
      
      if (combinedAudioPath && existsSync(combinedAudioPath)) {
        console.log(`✅ Segment combination successful: ${combinedAudioPath}`);
        const combinedBuffer = readFileSync(combinedAudioPath);
        
        // Handle HTTP Range requests for better seeking performance
        const range = request.headers.get('range');
        
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : combinedBuffer.length - 1;
          const chunksize = (end - start) + 1;
          const chunk = combinedBuffer.slice(start, end + 1);
          
          return new NextResponse(chunk, {
            status: 206, // Partial Content
            headers: {
              'Content-Type': 'audio/wav',
              'Content-Length': chunksize.toString(),
              'Content-Range': `bytes ${start}-${end}/${combinedBuffer.length}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=3600', // Cache chunks for better performance
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET',
              'Access-Control-Allow-Headers': 'Content-Type, Range',
              'X-Combined-With-Updates': 'true',
            },
          });
        }

        return new NextResponse(combinedBuffer, {
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': combinedBuffer.length.toString(),
            'Cache-Control': 'public, max-age=1800', // Cache for 30 minutes
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type, Range',
            'X-Combined-With-Updates': 'true', // Indicate this includes updates
          },
        });
      }
      
      console.log('⚠️ Falling back to original audio file');
    }
    
    // Fallback to original audio file
    const originalPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
    if (existsSync(originalPath)) {
      const audioBuffer = readFileSync(originalPath);
      
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
    
    return NextResponse.json({ error: 'Audio file not found' }, { status: 404 });
    
  } catch (error) {
    console.error('Error serving combined full song audio:', error);
    return NextResponse.json({ 
      error: 'Failed to serve combined full song audio',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * Rebuild full song with segment replacements using FFmpeg audio splicing
 */
async function rebuildFullSongWithReplacements(
  templateName: string, 
  originalAudioPath: string, 
  updatesFile: string
): Promise<string | null> {
  try {
    const { spawn } = require('child_process');
    const { readFileSync, existsSync, writeFileSync } = require('fs');
    const { join } = require('path');
    
    console.log(`🔧 Rebuilding full song for ${templateName} with proper audio splicing...`);
    
    // Read the updates metadata
    const updates = JSON.parse(readFileSync(updatesFile, 'utf8'));
    console.log(`📝 Processing ${Object.keys(updates).length} segment updates`);
    
    // For now, let's use a simple approach - just replace verse 1 at the beginning
    const verse1Update = updates['1'];
    if (!verse1Update || !existsSync(verse1Update.segmentFile)) {
      console.log('⚠️ No valid verse 1 update found');
      return null;
    }
    
    // Create output path for rebuilt song
    const outputPath = join(process.cwd(), `.segment_updates/${templateName}/rebuilt_full_song.wav`);
    
    console.log(`🎵 Replacing verse 1 with proper timing: ${verse1Update.segmentFile}`);
    
    // Use actual timing data from cache: verse 1 ends at 8000ms, verse 2 starts at 11555.56ms
    // This gives us a 3.56 second gap that we need to preserve
    const verse1EndSeconds = 8.0;           // 8000ms
    const verse2StartSeconds = 11.556;      // 11555.56ms  
    const gapDuration = verse2StartSeconds - verse1EndSeconds; // 3.556 seconds
    
    const ffmpegArgs = [
      '-i', originalAudioPath,           // Input original file
      '-i', verse1Update.segmentFile,   // Input replacement segment
      '-filter_complex', 
      // Minimal processing to preserve original audio quality
      `[1:a]volume=1.0,afade=t=out:st=7.8:d=0.1[verse1_updated];` +
      `[0:a]atrim=start=${verse1EndSeconds}:end=${verse2StartSeconds}[gap];` +
      `[0:a]atrim=start=${verse2StartSeconds},afade=t=in:st=0:d=0.1[rest];` +
      `[verse1_updated][gap][rest]concat=n=3:v=0:a=1[out]`,
      '-map', '[out]',              // Use the concatenated output
      '-c:a', 'pcm_f32le',          // 32-bit float PCM for maximum quality
      '-ar', '48000',               // Higher sample rate for better quality
      '-ac', '2',                   // Stereo
      '-y',                         // Overwrite output file
      outputPath
    ];
    
    console.log(`🔧 Running FFmpeg:`, 'ffmpeg', ffmpegArgs.join(' '));
    
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          console.log('✅ FFmpeg segment replacement successful');
          resolve(outputPath);
        } else {
          console.error(`❌ FFmpeg failed with code ${code}`);
          console.error('FFmpeg stderr:', stderr.slice(-500));
          resolve(null);
        }
      });
      
      ffmpeg.on('error', (error) => {
        console.error('❌ FFmpeg spawn error:', error);
        resolve(null);
      });
    });
    
  } catch (error) {
    console.error('Error rebuilding full song:', error);
    return null;
  }
}