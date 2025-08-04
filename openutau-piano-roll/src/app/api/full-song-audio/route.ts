import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const template = searchParams.get('template') || 'still_here_original';
    const forceOriginal = searchParams.get('original') === 'true'; // Add flag to bypass updates
    
    console.log(`🎼 API REQUEST: Serving full song audio for ${template}...`);
    console.log(`🔍 Process working directory: ${process.cwd()}`);
    
    // Try to find pre-rendered full song file - check both current dir and parent dir
    const possiblePaths = [
      join(process.cwd(), `${template}_full_song.wav`),
      join(process.cwd(), 'still_here_original_full_song.wav'),
      join(process.cwd(), '..', `${template}_full_song.wav`), // Check parent directory
      join(process.cwd(), '..', 'still_here_original_full_song.wav'), // Parent dir
      join(process.cwd(), 'still_here_full_song.wav'),
      join(process.cwd(), 'output.wav'), // fallback to any existing rendered audio
      // Also check if we're in the piano-roll subdirectory
      join('/workspaces/OpenUtau', `${template}_full_song.wav`),
      join('/workspaces/OpenUtau', 'still_here_original_full_song.wav'),
      join('/workspaces/OpenUtau', 'output.wav'),
    ];
    
    let audioPath = null;
    console.log('🔍 Searching for audio files...');
    for (const path of possiblePaths) {
      console.log(`  Checking: ${path} - exists: ${existsSync(path)}`);
      if (existsSync(path)) {
        audioPath = path;
        console.log(`✅ Found audio file: ${audioPath}`);
        break;
      }
    }
    
    if (!audioPath) {
      console.log('⚠️ No pre-rendered full song found, will render on demand...');
      
      // For now, return error - in production this would trigger rendering
      return NextResponse.json({ 
        error: 'Full song not pre-rendered',
        message: 'Please run the pre-rendering script first',
        debug: {
          template,
          possiblePaths,
          cwd: process.cwd()
        }
      }, { status: 404 });
    }
    
    // Check if there are segment updates first (highest priority)
    const updatesDir = join(process.cwd(), '.segment_updates', template);
    const updatesFile = join(updatesDir, 'updates.json');
    
    console.log(`🔍 Checking for segment updates: ${updatesFile}`);
    console.log(`📁 Updates file exists: ${existsSync(updatesFile)}`);
    console.log(`🏠 Current working directory: ${process.cwd()}`);
    
    if (existsSync(updatesFile) && !forceOriginal) {
      console.log('🔄 Found segment updates, using FFmpeg segment combination...');
      
      // Use FFmpeg to combine original audio with updated segments
      const updates = JSON.parse(readFileSync(updatesFile, 'utf8'));
      
      const combinedAudioPath = await rebuildFullSongWithReplacements(template, audioPath, updatesFile);
      
      if (combinedAudioPath && existsSync(combinedAudioPath)) {
        console.log(`✅ Segment combination successful: ${combinedAudioPath}`);
        const combinedBuffer = readFileSync(combinedAudioPath);
        
        return new NextResponse(combinedBuffer, {
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': combinedBuffer.length.toString(),
            'Cache-Control': 'no-cache', // Don't cache combined files
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'X-Combined-With-Updates': 'true', // Indicate this includes updates
          },
        });
      }
      
      console.log('⚠️ Falling back to original audio file');
    }
    
    // Check for prerendered segments (secondary priority)
    const prerenderedDir = join(process.cwd(), '..', 'prerendered');
    const prerenderedManifest = join(prerenderedDir, `${template}_manifest.json`);
    
    if (existsSync(prerenderedManifest) && !forceOriginal) {
      console.log('🎵 Found prerendered segments, using sequential playback...');
      
      const manifest = JSON.parse(readFileSync(prerenderedManifest, 'utf8'));
      console.log(`📋 Returning prerendered segment metadata for ${manifest.segments.length} segments`);
      
      const segmentMetadata = {
        hasPrerendered: true,
        originalPath: audioPath,
        segments: manifest.segments,
        template: template,
        totalSegments: manifest.segments.length
      };
      
      return NextResponse.json(segmentMetadata, {
        headers: {
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type',
          'X-Prerendered-Segments': 'true', // Indicate this uses prerendered segments
        },
      });
    }
    
    // Read and serve the original audio file
    const audioBuffer = readFileSync(audioPath);
    
    console.log(`✅ Serving full song: ${audioPath} (${audioBuffer.length} bytes)`);
    
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
    
  } catch (error) {
    console.error('Error serving full song audio:', error);
    return NextResponse.json({ 
      error: 'Failed to serve full song audio',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * Rebuild full song with segment replacements using OpenUtau CLI
 */
async function rebuildFullSongWithOpenUtauCli(
  templateName: string,
  originalAudioPath: string,
  updates: any
): Promise<string | null> {
  try {
    console.log(`🎼 Rebuilding full song for ${templateName} using segment combination...`);
    
    const outputPath = join(process.cwd(), `.segment_updates/${templateName}/cli_combined_full_song.wav`);
    
    // Use a Node.js-based approach to combine prerendered segments with updates
    const success = await combineSegmentsWithNodeJS(templateName, updates, outputPath);
    
    if (success && existsSync(outputPath)) {
      console.log(`✅ Segment combination successful: ${outputPath}`);
      return outputPath;
    }
    
    // Fallback: use the first updated segment as placeholder
    const firstUpdate = Object.values(updates)[0] as any;
    if (firstUpdate && existsSync(firstUpdate.segmentFile)) {
      console.log(`🔄 Fallback: using first updated segment as placeholder`);
      
      const fs = require('fs');
      fs.copyFileSync(firstUpdate.segmentFile, outputPath);
      
      console.log(`✅ Placeholder combination complete: ${outputPath}`);
      return outputPath;
    }
    
    return null;
    
  } catch (error) {
    console.error('Error rebuilding with OpenUtau CLI:', error);
    return null;
  }
}

/**
 * Combine prerendered segments with updated segments using FFmpeg
 */
async function combineSegmentsWithNodeJS(
  templateName: string,
  updates: any,
  outputPath: string
): Promise<boolean> {
  try {
    console.log(`🎼 Combining segments for ${templateName}...`);
    
    // Get the list of prerendered segments (first 8 segments)
    const prerenderedDir = join(process.cwd(), '..', 'prerendered');
    const segmentFiles: string[] = [];
    
    for (let i = 0; i < 8; i++) {
      const originalSegmentPath = join(prerenderedDir, `${templateName}_segment_${i}.wav`);
      
      // Check if there's an update for this segment
      const verseNumber = i + 1;
      const updateInfo = updates[verseNumber.toString()];
      
      if (updateInfo && existsSync(updateInfo.segmentFile)) {
        // Use the updated segment
        segmentFiles.push(updateInfo.segmentFile);
        console.log(`🔄 Using updated segment ${i}: ${updateInfo.segmentFile}`);
      } else if (existsSync(originalSegmentPath)) {
        // Use the original prerendered segment
        segmentFiles.push(originalSegmentPath);
        console.log(`📦 Using original segment ${i}: ${originalSegmentPath}`);
      } else {
        console.warn(`⚠️ Missing segment ${i}, skipping`);
      }
    }
    
    if (segmentFiles.length === 0) {
      console.error('❌ No segments found to combine');
      return false;
    }
    
    console.log(`🎯 Combining ${segmentFiles.length} segments with FFmpeg...`);
    
    // Create FFmpeg concat file
    const concatFilePath = join(process.cwd(), `.segment_updates/${templateName}/concat_list.txt`);
    const concatContent = segmentFiles.map(file => `file '${file}'`).join('\n');
    writeFileSync(concatFilePath, concatContent);
    
    // Use FFmpeg to concatenate the segments
    const ffmpegArgs = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFilePath,
      '-c', 'copy',
      '-y',
      outputPath
    ];
    
    console.log(`🔧 Running: ffmpeg ${ffmpegArgs.join(' ')}`);
    
    return new Promise((resolve) => {
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
      
      let stderr = '';
      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpegProcess.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          console.log(`✅ FFmpeg combination successful: ${outputPath}`);
          
          // Clean up concat file
          try {
            require('fs').unlinkSync(concatFilePath);
          } catch (e) {}
          
          resolve(true);
        } else {
          console.error(`❌ FFmpeg failed with code ${code}`);
          console.error('FFmpeg stderr:', stderr.slice(-300));
          resolve(false);
        }
      });
      
      ffmpegProcess.on('error', (error) => {
        console.error('❌ FFmpeg spawn error:', error);
        resolve(false);
      });
    });
    
  } catch (error) {
    console.error('Error in combineSegmentsWithNodeJS:', error);
    return false;
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
    console.log(`🔧 Rebuilding full song for ${templateName} with proper audio splicing...`);
    
    // Read the updates metadata
    const updates = JSON.parse(readFileSync(updatesFile, 'utf8'));
    console.log(`📝 Processing ${Object.keys(updates).length} segment updates`);
    
    // Get verse timing information from the template
    const verseTimings = await getVerseTimings(templateName);
    if (!verseTimings) {
      console.warn('⚠️ Could not get verse timings, falling back to original');
      return null;
    }
    
    // Create output path for rebuilt song
    const outputPath = join(process.cwd(), `.segment_updates/${templateName}/rebuilt_full_song.wav`);
    
    // Handle multiple verse replacements by processing them in order
    let currentAudioPath = originalAudioPath;
    let hasReplacements = false;
    
    // Sort updates by verse number to process in order
    const sortedUpdates = Object.entries(updates)
      .map(([verseNum, updateInfo]) => ({ verseNumber: parseInt(verseNum), updateInfo }))
      .sort((a, b) => a.verseNumber - b.verseNumber);
      
    console.log(`🔄 Processing ${sortedUpdates.length} verse updates in order...`);
    
    for (let i = 0; i < sortedUpdates.length; i++) {
      const { verseNumber, updateInfo } = sortedUpdates[i];
      const segmentFile = (updateInfo as any).segmentFile;
      
      if (!existsSync(segmentFile)) {
        console.warn(`⚠️ Segment file not found for verse ${verseNumber}: ${segmentFile}`);
        continue;
      }
      
      const verseTiming = verseTimings.find(v => v.verseNumber === verseNumber);
      if (!verseTiming) {
        console.warn(`⚠️ No timing found for verse ${verseNumber}`);
        continue;
      }
      
      // Create unique output path for each step
      const stepOutputPath = join(process.cwd(), `.segment_updates/${templateName}/rebuilt_step_${i}.wav`);
      
      console.log(`🎵 Replacing verse ${verseNumber} at ${verseTiming.startTime}s-${verseTiming.endTime}s`);
      
      const success = await replaceAudioSegment(
        currentAudioPath,
        segmentFile,
        stepOutputPath,
        verseTiming.startTime,
        verseTiming.endTime
      );
      
      if (success && existsSync(stepOutputPath)) {
        currentAudioPath = stepOutputPath; // Use this as input for next replacement
        hasReplacements = true;
        console.log(`✅ Step ${i + 1} completed: verse ${verseNumber} replaced`);
      } else {
        console.error(`❌ Failed to replace verse ${verseNumber}`);
        break;
      }
    }
    
    if (hasReplacements) {
      // Copy final result to the main output path
      const fs = require('fs');
      fs.copyFileSync(currentAudioPath, outputPath);
      console.log('✅ Successfully rebuilt full song with all verse replacements');
      return outputPath;
    }
    
    // If FFmpeg approach fails, fallback to serving just the segment
    // This ensures something plays even if audio splicing fails
    for (const [verseNum, updateInfo] of Object.entries(updates)) {
      const segmentFile = (updateInfo as any).segmentFile;
      if (existsSync(segmentFile)) {
        console.log(`🎵 Fallback: serving updated verse ${verseNum} only`);
        return segmentFile;
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('Error rebuilding full song:', error);
    return null;
  }
}

/**
 * Get verse timings for a template using actual segment data
 */
async function getVerseTimings(templateName: string): Promise<Array<{verseNumber: number, startTime: number, endTime: number}> | null> {
  try {
    // Try to get precise timing from the template API
    const response = await fetch(`http://localhost:3001/api/templates?name=${templateName}`);
    if (response.ok) {
      const result = await response.json();
      if (result.cachedVerseDetection?.verses) {
        const verses = result.cachedVerseDetection.verses;
        const timings = [];
        
        for (let i = 0; i < verses.length; i++) {
          const verse = verses[i];
          // Use actual timing data if available, with some padding for smooth transitions
          const startTime = verse.startTimeMs ? verse.startTimeMs / 1000 : i * 12;
          const endTime = verse.endTimeMs ? verse.endTimeMs / 1000 : (i + 1) * 12;
          
          timings.push({
            verseNumber: verse.verseNumber || (i + 1),
            startTime: Math.max(0, startTime), // No padding for precise timing
            endTime: endTime // No padding for precise timing
          });
          
          console.log(`📍 Verse ${verse.verseNumber || (i + 1)}: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);
        }
        
        return timings;
      }
    }
    
    // Fallback to approximate timings for still_here_original
    if (templateName === 'still_here_original') {
      console.log('⚠️ Using fallback timings for still_here_original');
      return [
        { verseNumber: 1, startTime: 0, endTime: 12 },      // Shorter, more precise
        { verseNumber: 2, startTime: 12, endTime: 24 },     
        { verseNumber: 3, startTime: 24, endTime: 36 },     
        { verseNumber: 4, startTime: 36, endTime: 48 },     
      ];
    }
    
    return null;
  } catch (error) {
    console.error('Error getting verse timings:', error);
    return null;
  }
}

/**
 * Get template USTX data using the same approach as the templates API
 */
async function getTemplateUstxData(templateName: string): Promise<any | null> {
  try {
    console.log(`📋 Loading USTX data for template: ${templateName}`);
    
    const templatesPath = '/workspaces/OpenUtau';
    
    const templates = [
      {
        name: 'still_here_original',
        displayName: 'Still Here (Original)',
        description: 'Original melancholic version',
        file: '3fd2ff7e-7297-4bcd-b484-3020a11f2991.ustx'
      },
      {
        name: 'still_here_happy_verse1',
        displayName: 'Still Here (Happy Verse 1)',
        description: 'Verse 1 made "way more happy" with raised pitch (+4 semitones) and lively vibrato',
        file: 'still_here_happy_verse1.ustx'
      }
    ];

    const template = templates.find(t => t.name === templateName);
    if (!template) {
      console.error(`❌ Template not found: ${templateName}`);
      return null;
    }

    const filePath = join(templatesPath, template.file);
    
    if (!existsSync(filePath)) {
      console.error(`❌ Template file not found: ${filePath}`);
      return null;
    }

    const ustxData = JSON.parse(readFileSync(filePath, 'utf-8'));
    console.log(`✅ Loaded USTX data for ${templateName}: ${ustxData.tracks?.length || 0} tracks`);
    
    return ustxData;
  } catch (error) {
    console.error(`❌ Error loading template USTX data for ${templateName}:`, error);
    return null;
  }
}

/**
 * Apply segment updates to USTX data (placeholder for now - may not be needed)
 */
async function applySegmentUpdatesToUstx(ustxData: any, updates: any): Promise<any> {
  try {
    console.log(`🔄 Applying segment updates to USTX data...`);
    
    // For now, just return the original USTX data
    // The segment updates are handled by the segment cache system
    // and the OpenUtau CLI will render the full song with all current data
    console.log(`📋 Updates found for verses: ${Object.keys(updates).join(', ')}`);
    
    return ustxData;
  } catch (error) {
    console.error('❌ Error applying segment updates to USTX:', error);
    return ustxData; // Return original on error
  }
}

/**
 * Render USTX data using OpenUtau CLI (same approach as existing render API)
 */
async function renderUstxWithCli(ustxData: any, singerId: string): Promise<Buffer | null> {
  try {
    console.log(`🎼 Rendering USTX with OpenUtau CLI using singer: ${singerId}`);
    
    const openUtauDir = '/workspaces/OpenUtau';
    const tempId = require('uuid').v4();
    const ustxPath = join(openUtauDir, `full_song_${tempId}.ustx`);
    const outputWav = join(openUtauDir, `full_song_${tempId}.wav`);
    const outputJson = join(openUtauDir, `full_song_${tempId}.json`);

    try {
      // Write USTX data to temporary file
      writeFileSync(ustxPath, JSON.stringify(ustxData, null, 2));

      // Build CLI command (same as render API)
      let cliCommand = `rm -rf /home/codespace/.cache/OpenUtau/* && dotnet run --project OpenUtau.Cli -- ${ustxPath} ${singerId} ${outputJson} ${outputWav} --reset-timings --phoneme-override dream:0:d:jh`;

      console.log(`🔧 Running OpenUtau CLI: ${cliCommand}`);

      // Execute OpenUtau CLI
      const cliProcess = spawn('bash', ['-c', cliCommand], {
        cwd: '/workspaces/OpenUtau'
      });

      // Capture output
      let stdout = '';
      let stderr = '';
      
      cliProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      cliProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for process to complete
      await new Promise<void>((resolve, reject) => {
        cliProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`CLI exited with code ${code}. stderr: ${stderr}`));
          }
        });
        
        cliProcess.on('error', reject);
      });

      // Read the generated WAV file
      const wavBuffer = readFileSync(outputWav);
      console.log(`✅ OpenUtau CLI render successful: ${wavBuffer.length} bytes`);

      // Clean up temporary files
      try {
        require('fs').unlinkSync(ustxPath);
        require('fs').unlinkSync(outputWav);
        require('fs').unlinkSync(outputJson);
      } catch (e) {
        // Ignore cleanup errors
      }

      return wavBuffer;

    } catch (error) {
      // Clean up on error
      try {
        require('fs').unlinkSync(ustxPath);
        require('fs').unlinkSync(outputWav);
        require('fs').unlinkSync(outputJson);
      } catch (e) {
        // Ignore cleanup errors
      }
      throw error;
    }

  } catch (error) {
    console.error('❌ Error rendering USTX with CLI:', error);
    return null;
  }
}

/**
 * Replace a segment in an audio file using FFmpeg
 */
async function replaceAudioSegment(
  originalFile: string,
  replacementFile: string, 
  outputFile: string,
  startTime: number,
  endTime: number
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      console.log(`🔧 FFmpeg: Replacing ${startTime}s-${endTime}s in ${originalFile}`);
      
      // Aggressive breath removal approach:
      // Since both segments likely have similar breath timing, we'll be more aggressive
      const ffmpegArgs = [
        '-i', originalFile,           // Input original file
        '-i', replacementFile,        // Input replacement segment
        '-filter_complex', 
        // Much more aggressive silence removal from replacement
        `[1:a]silenceremove=start_periods=1:start_silence=0.5:start_threshold=-25dB[replacement_trimmed];` +
        
        // Also trim a small amount from the start of replacement (assume 200ms breath overlap)
        `[replacement_trimmed]atrim=start=0.2[replacement_clean];` +
        
        // Get parts of original song
        `[0:a]atrim=end=${startTime}[before];` +                    // Before segment (includes original breath)
        `[replacement_clean]aformat=sample_rates=44100,volume=1[replacement];` +  // Clean replacement 
        `[0:a]atrim=start=${endTime}[after];` +                     // After segment  
        
        // Simple concatenation without crossfade to avoid timing issues
        `[before][replacement][after]concat=n=3:v=0:a=1[out]`,
        
        '-map', '[out]',              // Use the concatenated output
        '-c:a', 'pcm_s16le',          // Use uncompressed PCM for quality
        '-ar', '44100',               // Standard sample rate
        '-ac', '2',                   // Stereo
        '-y',                         // Overwrite output file
        outputFile
      ];
      
      console.log(`🔧 Running FFmpeg:`, 'ffmpeg', ffmpegArgs.join(' '));
      
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log('✅ FFmpeg segment replacement successful');
          resolve(true);
        } else {
          console.error(`❌ FFmpeg failed with code ${code}`);
          console.error('FFmpeg stderr:', stderr);
          resolve(false);
        }
      });
      
      ffmpeg.on('error', (error) => {
        console.error('❌ FFmpeg spawn error:', error);
        resolve(false);
      });
      
    } catch (error) {
      console.error('❌ Error in replaceAudioSegment:', error);
      resolve(false);
    }
  });
}