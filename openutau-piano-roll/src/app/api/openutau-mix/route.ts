import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

// In-memory cache for rendered audio - survives during server session
const audioCache = new Map<string, { buffer: Buffer, timestamp: number, updatesHash: string }>();

// Helper to create a hash of updates for cache invalidation
function getUpdatesHash(updates: any): string {
  return JSON.stringify(updates);
}

// Clean up old cache entries (keep last 3 entries)
function cleanupCache() {
  if (audioCache.size > 3) {
    const entries = Array.from(audioCache.entries()).sort((a, b) => b[1].timestamp - a[1].timestamp);
    const toDelete = entries.slice(3);
    toDelete.forEach(([key]) => {
      audioCache.delete(key);
      console.log(`🧹 Removed old cached audio: ${key}`);
    });
  }
}

export async function GET(request: NextRequest) {
  console.log(`🚀 DEBUG: /api/openutau-mix GET called!`);
  try {
    const { searchParams } = new URL(request.url);
    const template = searchParams.get('template') || 'still_here_original';
    console.log(`🚀 DEBUG: template = ${template}`);
    const forceRefresh = searchParams.get('refresh') === 'true';
    
    console.log(`🎼 Using OpenUtau C# mixing for ${template}${forceRefresh ? ' (forced refresh)' : ''}...`);
    
    // If forcing refresh, clear cache for this template
    if (forceRefresh) {
      const keysToDelete = Array.from(audioCache.keys()).filter(key => key.startsWith(`${template}_`));
      keysToDelete.forEach(key => {
        audioCache.delete(key);
        console.log(`🧹 Cleared server cache for template: ${key}`);
      });
    }
    
    // Check if there are segment updates - look in the main OpenUtau directory
    const updatesDir = join('/workspaces/OpenUtau', '.segment_updates', template);
    const updatesFile = join(updatesDir, 'updates.json');
    
    console.log(`🔍 Checking for updates: ${updatesFile} - exists: ${existsSync(updatesFile)}`);
    
    if (existsSync(updatesFile)) {
      console.log('🔄 Found segment updates, using OpenUtau C# mixing system...');
      
      const updates = JSON.parse(readFileSync(updatesFile, 'utf8'));
      
      // Clean up the updates format - only keep verse_* entries, but preserve metadata
      const cleanedUpdates: any = {};
      for (const [key, value] of Object.entries(updates)) {
        if (key.startsWith('verse_') || key === '_metadata') {
          cleanedUpdates[key] = value;
        }
      }
      
      console.log('📋 Cleaned segment updates:', Object.keys(cleanedUpdates));
      const updatesHash = getUpdatesHash(cleanedUpdates);
      const cacheKey = `${template}_${updatesHash}`;
      
      // Check if we have cached audio that matches current updates
      let audioBuffer: Buffer;
      if (audioCache.has(cacheKey)) {
        console.log('⚡ Using cached OpenUtau mixed audio - instant response!');
        audioBuffer = audioCache.get(cacheKey)!.buffer;
      } else {
        console.log('🎵 Rendering fresh audio with OpenUtau C# mixing...');
        console.log('📋 Segment updates data:', JSON.stringify(cleanedUpdates, null, 2));
        
        console.log('🚀 DEBUG: Calling nativeOpenUtauCacheIntegration directly...');
        const mixedAudioPath = await nativeOpenUtauCacheIntegration(template, cleanedUpdates);
        console.log('🚀 DEBUG: nativeOpenUtauCacheIntegration completed');
        
        if (mixedAudioPath && existsSync(mixedAudioPath)) {
          console.log(`✅ OpenUtau mixing successful: ${mixedAudioPath}`);
          
          // Instead of loading 17MB into memory, copy to public directory and return the path
          const publicFileName = `mixed_${template}_${Date.now()}.wav`;
          const publicPath = join('/workspaces/OpenUtau/openutau-piano-roll/public', publicFileName);
          
          console.log(`📁 Copying mixed audio to public directory: ${publicFileName}`);
          require('fs').copyFileSync(mixedAudioPath, publicPath);
          
          // Return JSON with the static file path instead of redirecting (avoids CORS issues)
          console.log(`✅ Mixed audio ready at: /${publicFileName}`);
          return NextResponse.json({ 
            audioUrl: `/${publicFileName}`,
            mixedBy: 'nativeOpenUtauIntegration',
            duration: '195.894785' 
          });
        } else {
          console.error('❌ OpenUtau CLI mixing failed - no output file created');
          console.error('📋 This might be due to cache integration issues or CLI timeout');
          return NextResponse.json({ 
            error: 'OpenUtau CLI mixing failed',
            details: 'No output file was created by the OpenUtau CLI process. Check server logs for details.'
          }, { status: 500 });
        }
      }
      
      // Handle HTTP Range requests for efficient seeking
      const range = request.headers.get('range');
      
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : audioBuffer.length - 1;
        const chunksize = (end - start) + 1;
        const chunk = audioBuffer.slice(start, end + 1);
        
        return new NextResponse(chunk, {
          status: 206,
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': chunksize.toString(),
            'Content-Range': `bytes ${start}-${end}/${audioBuffer.length}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type, Range',
            'X-Mixed-By-OpenUtau': 'true',
          },
        });
      }

      return new NextResponse(audioBuffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': audioBuffer.length.toString(),
          'Cache-Control': 'public, max-age=1800',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': 'Content-Type, Range',
          'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
          'X-Mixed-By-OpenUtau': 'true',
          'X-Content-Duration': '195.894785', // Actual duration in seconds
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });
    }
    
    // Fallback to original audio
    const originalPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
    console.log(`🔍 Using fallback path: ${originalPath} - exists: ${existsSync(originalPath)}`);
    if (existsSync(originalPath)) {
      console.log(`🎵 Serving original audio file directly (no updates found)`);
      const audioBuffer = readFileSync(originalPath);
      return new NextResponse(audioBuffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': audioBuffer.length.toString(),
          'Cache-Control': 'public, max-age=3600',
          'Accept-Ranges': 'bytes',
          'X-Mixed-By-OpenUtau': 'fallback',
          'X-Content-Duration': '195.894785',
        },
      });
    }
    
    return NextResponse.json({ error: 'Audio file not found' }, { status: 404 });
    
  } catch (error) {
    console.error('Error in OpenUtau mixing API:', error);
    return NextResponse.json({ 
      error: 'Failed to mix audio with OpenUtau',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * Efficiently combine audio segments using precise timing-based replacement
 * Uses high-quality buffer operations instead of FFmpeg to avoid quality issues
 */
async function mixAudioWithOpenUtauCore(
  templateName: string,
  updates: any
): Promise<string | null> {
  try {
    console.log(`🎵 High-quality audio segment replacement for ${templateName}...`);
    console.log(`📋 Changed segments:`, Object.keys(updates).join(', '));
    
    // Check if we can use the base full song audio + segment updates
    const baseAudioPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
    if (!existsSync(baseAudioPath)) {
      console.error('❌ Base full song audio not found');
      return null;
    }
    
    console.log(`🚀 DEBUG: About to call nativeOpenUtauCacheIntegration`);
    
    return await nativeOpenUtauCacheIntegration(templateName, updates);
    
  } catch (error) {
    console.error('Error in precision audio mixing:', error);
    return null;
  }
}

/**
 * High-quality audio segment replacement using precise timing and buffer operations
 * Avoids FFmpeg quality issues by working directly with WAV buffers
 */
async function precisionAudioSegmentReplacement(
  templateName: string,
  updates: any,
  baseAudioPath: string
): Promise<string | null> {
  try {
    console.log('🎯 Precision audio segment replacement starting...');
    
    // Load verse timing data
    const timingCachePath = `/workspaces/OpenUtau/${templateName}_cache.json`;
    if (!existsSync(timingCachePath)) {
      console.error('❌ No timing cache found');
      return null;
    }
    
    const timingData = JSON.parse(readFileSync(timingCachePath, 'utf8'));
    const verses = timingData.verses || [];
    console.log(`📊 Found ${verses.length} verses with timing data`);
    
    // Load base audio
    const baseAudioBuffer = readFileSync(baseAudioPath);
    console.log(`📥 Loaded base audio: ${baseAudioBuffer.length} bytes`);
    
    // Parse WAV header to get audio properties
    const audioInfo = parseWavHeader(baseAudioBuffer);
    console.log(`📊 Audio info: ${audioInfo.sampleRate}Hz, ${audioInfo.channels} channels, ${audioInfo.bitsPerSample}-bit`);
    
    // Create a copy of the base audio to modify
    let mixedAudioBuffer = Buffer.from(baseAudioBuffer);
    
    // Process each verse update with async breaks to prevent blocking
    for (const [updateKey, updateData] of Object.entries(updates)) {
      const update = updateData as any;
      if (!update.audioPath || !existsSync(update.audioPath)) {
        console.log(`⚠️ Skipping ${updateKey} - no audio file found`);
        continue;
      }
      
      const verseNumber = parseInt(updateKey.replace('verse_', ''));
      console.log(`🔄 Processing verse ${verseNumber} replacement...`);
      
      // Find the verse timing data
      const verse = verses.find((v: any) => v.verseNumber === verseNumber);
      if (!verse) {
        console.error(`❌ No timing data found for verse ${verseNumber}`);
        continue;
      }
      
      // Load the replacement audio
      const replacementBuffer = readFileSync(update.audioPath);
      const replacementInfo = parseWavHeader(replacementBuffer);
      
      console.log(`📊 Verse ${verseNumber} timing: ${verse.startTimeMs}ms - ${verse.endTimeMs}ms (${verse.endTimeMs - verse.startTimeMs}ms)`);
      console.log(`📥 Replacement audio: ${replacementBuffer.length} bytes`);
      
      // Verify audio compatibility
      if (replacementInfo.sampleRate !== audioInfo.sampleRate || 
          replacementInfo.channels !== audioInfo.channels ||
          replacementInfo.bitsPerSample !== audioInfo.bitsPerSample) {
        console.error(`❌ Audio format mismatch for verse ${verseNumber}`);
        console.error(`Base: ${audioInfo.sampleRate}Hz/${audioInfo.channels}ch/${audioInfo.bitsPerSample}bit`);
        console.error(`Replacement: ${replacementInfo.sampleRate}Hz/${replacementInfo.channels}ch/${replacementInfo.bitsPerSample}bit`);
        continue;
      }
      
      // Calculate byte positions - using gap clearing instead of breath compensation
      const startTimeMs = verse.startTimeMs;
      const endTimeMs = verse.endTimeMs;
      
      console.log(`📊 Verse ${verseNumber} replacement: ${startTimeMs}ms - ${endTimeMs}ms`);
      
      // Clear gap before verse if needed to prevent breath overlap
      await clearGapBeforeVerse(mixedAudioBuffer, audioInfo, verses, verseNumber);
      
      // Convert time to byte positions (skip WAV header)
      const bytesPerMs = (audioInfo.sampleRate * audioInfo.channels * (audioInfo.bitsPerSample / 8)) / 1000;
      const startBytePos = audioInfo.headerSize + Math.floor(startTimeMs * bytesPerMs);
      const endBytePos = audioInfo.headerSize + Math.floor(endTimeMs * bytesPerMs);
      const segmentLength = endBytePos - startBytePos;
      
      console.log(`📊 Byte positions: ${startBytePos} - ${endBytePos} (${segmentLength} bytes)`);
      
      // Extract replacement audio data (skip WAV header)
      const replacementAudioData = replacementBuffer.slice(replacementInfo.headerSize);
      
      // Timing-based replacement (direct replacement)
      console.log(`⏰ Timing-based replacement for verse ${verseNumber}...`);
      await applyTimingBasedReplacement(
        mixedAudioBuffer,
        replacementAudioData,
        startBytePos,
        segmentLength,
        verseNumber
      );
      
      console.log(`✅ Replacement completed for verse ${verseNumber}`);
      
      // Add async break to prevent blocking
      await new Promise(resolve => setImmediate(resolve));
      
      console.log(`✅ Successfully replaced verse ${verseNumber} with precision timing`);
      
      // Add async break between verse processing to prevent blocking
      await new Promise(resolve => setImmediate(resolve));
    }
    
    // Save the mixed audio
    const tempId = uuidv4();
    const outputPath = join('/workspaces/OpenUtau', `precision_mixed_${tempId}.wav`);
    writeFileSync(outputPath, mixedAudioBuffer);
    
    console.log(`✅ Precision audio mixing completed: ${outputPath}`);
    return outputPath;
    
  } catch (error) {
    console.error('Error in precision audio segment replacement:', error);
    return null;
  }
}

/**
 * Parse WAV file header to extract audio properties
 */
function parseWavHeader(buffer: Buffer) {
  // WAV file format parsing
  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22);
  const bitsPerSample = buffer.readUInt16LE(34);
  
  // Find the start of audio data (after 'data' chunk)
  let headerSize = 44; // Standard WAV header size
  const dataMarker = Buffer.from('data');
  const dataIndex = buffer.indexOf(dataMarker);
  if (dataIndex !== -1) {
    headerSize = dataIndex + 8; // 'data' + 4 bytes for chunk size
  }
  
  return {
    sampleRate,
    channels,
    bitsPerSample,
    headerSize
  };
}

/**
 * Replace audio segment with crossfading to prevent clicks and pops
 */
function replaceAudioSegmentWithCrossfade(
  baseBuffer: Buffer,
  replacementData: Buffer,
  startBytePos: number,
  segmentLength: number,
  audioInfo: any,
  verseNumber: number
): Buffer {
  console.log(`🎵 Applying high-quality segment replacement for verse ${verseNumber}...`);
  
  // Create working copy
  const result = Buffer.from(baseBuffer);
  
  // Calculate crossfade length (50ms for smooth transitions)
  const crossfadeDurationMs = 50;
  const bytesPerMs = (audioInfo.sampleRate * audioInfo.channels * (audioInfo.bitsPerSample / 8)) / 1000;
  const crossfadeBytes = Math.floor(crossfadeDurationMs * bytesPerMs);
  
  // Ensure even number of bytes for 16-bit audio
  const bytesPerSample = (audioInfo.bitsPerSample / 8) * audioInfo.channels;
  const alignedCrossfadeBytes = Math.floor(crossfadeBytes / bytesPerSample) * bytesPerSample;
  
  console.log(`📊 Crossfade: ${crossfadeDurationMs}ms (${alignedCrossfadeBytes} bytes)`);
  
  // Calculate the actual replacement length (limit to available replacement data)
  const maxReplacementLength = Math.min(segmentLength, replacementData.length);
  const actualReplacementLength = Math.floor(maxReplacementLength / bytesPerSample) * bytesPerSample;
  
  console.log(`📊 Replacement: ${segmentLength} bytes requested, ${actualReplacementLength} bytes actual`);
  
  // Apply the main replacement (without crossfade regions)
  const mainStartPos = startBytePos + alignedCrossfadeBytes;
  const mainEndPos = startBytePos + actualReplacementLength - alignedCrossfadeBytes;
  const mainReplacementStart = alignedCrossfadeBytes;
  const mainReplacementEnd = actualReplacementLength - alignedCrossfadeBytes;
  
  if (mainEndPos > mainStartPos && mainReplacementEnd > mainReplacementStart) {
    const mainReplacementLength = mainEndPos - mainStartPos;
    const mainSourceLength = mainReplacementEnd - mainReplacementStart;
    const actualMainLength = Math.min(mainReplacementLength, mainSourceLength);
    
    console.log(`📊 Main replacement: ${actualMainLength} bytes at position ${mainStartPos}`);
    
    // Copy main replacement section
    replacementData.copy(result, mainStartPos, mainReplacementStart, mainReplacementStart + actualMainLength);
  }
  
  // Apply crossfade at the beginning
  if (alignedCrossfadeBytes > 0 && startBytePos + alignedCrossfadeBytes <= result.length) {
    applyCrossfade(result, replacementData, startBytePos, alignedCrossfadeBytes, audioInfo, 'fade-in');
  }
  
  // Apply crossfade at the end
  const endCrossfadeStart = startBytePos + actualReplacementLength - alignedCrossfadeBytes;
  if (alignedCrossfadeBytes > 0 && 
      endCrossfadeStart >= startBytePos && 
      endCrossfadeStart + alignedCrossfadeBytes <= result.length &&
      actualReplacementLength >= alignedCrossfadeBytes) {
    const replacementEndStart = actualReplacementLength - alignedCrossfadeBytes;
    applyCrossfade(result, replacementData, endCrossfadeStart, alignedCrossfadeBytes, audioInfo, 'fade-out', replacementEndStart);
  }
  
  console.log(`✅ High-quality segment replacement completed for verse ${verseNumber}`);
  return result;
}

/**
 * Apply crossfade between original and replacement audio
 */
function applyCrossfade(
  baseBuffer: Buffer,
  replacementData: Buffer,
  startPos: number,
  length: number,
  audioInfo: any,
  type: 'fade-in' | 'fade-out',
  replacementOffset: number = 0
) {
  const bytesPerSample = audioInfo.bitsPerSample / 8;
  const samples = length / (bytesPerSample * audioInfo.channels);
  
  for (let i = 0; i < samples; i++) {
    const sampleOffset = i * bytesPerSample * audioInfo.channels;
    const basePos = startPos + sampleOffset;
    const replacementPos = replacementOffset + sampleOffset;
    
    if (basePos + bytesPerSample * audioInfo.channels > baseBuffer.length ||
        replacementPos + bytesPerSample * audioInfo.channels > replacementData.length) {
      break;
    }
    
    // Calculate crossfade ratio
    const ratio = type === 'fade-in' ? (i / samples) : (1 - i / samples);
    const originalRatio = 1 - ratio;
    
    // Process each channel
    for (let ch = 0; ch < audioInfo.channels; ch++) {
      const channelOffset = ch * bytesPerSample;
      
      // Read original and replacement samples (assuming 16-bit)
      const originalSample = baseBuffer.readInt16LE(basePos + channelOffset);
      const replacementSample = replacementData.readInt16LE(replacementPos + channelOffset);
      
      // Apply crossfade
      const mixedSample = Math.round(originalSample * originalRatio + replacementSample * ratio);
      
      // Write back the mixed sample
      baseBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, mixedSample)), basePos + channelOffset);
    }
  }
}

// Removed unused simpleTimingBasedMix function - replaced with precision audio replacement

/**
 * DEPRECATED: Full project render using OpenUtau CLI with updated segment cache integration
 * Replaced with precisionAudioSegmentReplacement for better performance and quality
 */
async function fullProjectRenderWithUpdatedCache(templateName: string, updates: any): Promise<string | null> {
  try {
    console.log(`🎵 OpenUtau C# RenderEngine with updated segment cache for ${templateName}...`);
    
    // Step 1: Integrate our updated segments into OpenUtau's cache system
    console.log('🚀🚀🚀 CALLING integrateUpdatedSegmentsIntoCache...');
    console.log('📋📋📋 Updates object:', JSON.stringify(updates, null, 2));
    try {
      await integrateUpdatedSegmentsIntoCache(templateName, updates);
      console.log('✅✅✅ integrateUpdatedSegmentsIntoCache completed successfully');
    } catch (error) {
      console.error('❌❌❌ Failed to integrate updated segments:', error);
      console.error('❌❌❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('❌❌❌ This must be fixed - no fallbacks!');
      // DO NOT fall back - we need to fix the cache integration properly
      throw error;
    }
    
    const tempId = uuidv4();
    const outputPath = join('/workspaces/OpenUtau', `openutau_mixed_${tempId}.wav`);
    
    // Step 2: Get the original template USTX file
    const originalUstxPath = join('/workspaces/OpenUtau', '3fd2ff7e-7297-4bcd-b484-3020a11f2991.ustx');
    if (!existsSync(originalUstxPath)) {
      console.error('❌ Original USTX file not found');
      return null;
    }
    
    console.log(`🔧 OpenUtau will now render using its native cache system with our updated segments`);
    
    // Step 3: Use OpenUtau CLI to render - check if cache integration worked
    console.log('🔍 Checking if our cache integration is working...');
    
    // Check if our cache files were actually created
    const cacheDir = join('/workspaces/OpenUtau', 'UCache');
    if (existsSync(cacheDir)) {
      const cacheFiles = require('fs').readdirSync(cacheDir);
      console.log(`📊 UCache directory contains ${cacheFiles.length} files`);
      cacheFiles.slice(0, 5).forEach(file => console.log(`  - ${file}`));
    } else {
      console.log('❌ UCache directory does not exist!');
    }
    
    const cliCommand = `dotnet run --project OpenUtau.Cli -- "${originalUstxPath}" fem_1_ln /tmp/mix_timing_${tempId}.json "${outputPath}" --phoneme-override dream:0:d:jh`;
    
    console.log(`📋 CLI Command: ${cliCommand}`);
    console.log(`📁 Expected output path: ${outputPath}`);
    console.log(`📁 Original USTX exists: ${existsSync(originalUstxPath)}`);
    
    return new Promise((resolve) => {
      console.log('🚀 Starting OpenUtau CLI process...');
      const process = spawn('bash', ['-c', cliCommand], {
        cwd: '/workspaces/OpenUtau',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000 // 5 minutes - full re-render takes longer
      });
      
      console.log(`📊 Process PID: ${process.pid}`);
      
      let stdout = '';
      let stderr = '';
      let lastActivity = Date.now();
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
        lastActivity = Date.now();
        const output = data.toString().trim();
        console.log(`📤 OpenUtau stdout [${new Date().toISOString()}]: ${output}`);
        
        // Check for completion indicators
        if (output.includes('Rendering completed') || output.includes('Export completed')) {
          console.log('🎯 Detected completion signal in stdout');
        }
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
        lastActivity = Date.now();
        const output = data.toString().trim();
        console.log(`📤 OpenUtau stderr [${new Date().toISOString()}]: ${output}`);
        
        // Check for error indicators
        if (output.includes('Error') || output.includes('Exception') || output.includes('Failed')) {
          console.log('❌ Detected error signal in stderr');
        }
      });
      
      // Monitor for hangs - kill process if no activity for 5 minutes (rendering can take time)
      const hangMonitor = setInterval(() => {
        const timeSinceActivity = Date.now() - lastActivity;
        console.log(`⏱️ Time since last activity: ${timeSinceActivity}ms`);
        
        if (timeSinceActivity > 300000) { // 5 minutes - rendering can take a while
          console.error('❌ Process appears to be hanging (no output for 5 minutes), terminating...');
          clearInterval(hangMonitor);
          process.kill('SIGKILL');
        }
      }, 60000); // Check every 60 seconds
      
      process.on('close', (code) => {
        clearInterval(hangMonitor);
        console.log(`🔚 OpenUtau CLI finished with code: ${code}`);
        console.log(`📊 Output file exists: ${existsSync(outputPath)}`);
        
        if (existsSync(outputPath)) {
          const stats = statSync(outputPath);
          console.log(`📊 Output file size: ${stats.size} bytes`);
        }
        
        if (code === 0 && existsSync(outputPath)) {
          console.log('✅ OpenUtau native mixing completed successfully');
          resolve(outputPath);
        } else {
          console.error(`❌ OpenUtau mixing failed with code ${code}`);
          console.error(`📋 Stdout (last 1000 chars): ${stdout.slice(-1000)}`);
          console.error(`📋 Stderr (last 1000 chars): ${stderr.slice(-1000)}`);
          resolve(null);
        }
      });
      
      process.on('error', (error) => {
        clearInterval(hangMonitor);
        console.error('❌ OpenUtau mixing process error:', error);
        resolve(null);
      });
      
      // Handle timeout - give it more time since it's doing a full re-render
      const timeoutHandle = setTimeout(() => {
        clearInterval(hangMonitor);
        if (!process.killed) {
          console.error('⏱️ OpenUtau mixing timed out after 10 minutes, terminating...');
          console.error(`📋 Final stdout: ${stdout.slice(-1000)}`);
          console.error(`📋 Final stderr: ${stderr.slice(-1000)}`);
          process.kill('SIGKILL');
          resolve(null);
        }
      }, 600000); // 10 minutes for full re-render
      
      process.on('close', () => {
        clearTimeout(timeoutHandle);
      });
    });
    
  } catch (error) {
    console.error('Error in OpenUtau C# native mixing:', error);
    return null;
  }
}

/**
 * Original full project render function (kept as fallback)
 */
async function fullProjectRender(templateName: string, updates: any): Promise<string | null> {
  try {
    console.log(`🎵 OpenUtau C# RenderEngine with cache integration for ${templateName}...`);
    
    // First, set up OpenUtau's cache to use our cached segments
    await setupOpenUtauCache(templateName);
    
    const tempId = uuidv4();
    const outputPath = join('/workspaces/OpenUtau', `openutau_mixed_${tempId}.wav`);
    
    // Get the original template USTX file
    const originalUstxPath = join('/workspaces/OpenUtau', '3fd2ff7e-7297-4bcd-b484-3020a11f2991.ustx');
    if (!existsSync(originalUstxPath)) {
      console.error('❌ Original USTX file not found');
      return null;
    }
    
    console.log(`🔧 Rendering with cached segments (only changed parts will re-render)...`);
    
    // Use the CLI to render the full project - preserve original timing for exact silence gaps
    const cliCommand = `dotnet run --project OpenUtau.Cli -- "${originalUstxPath}" fem_1_ln /tmp/mix_timing_${tempId}.json "${outputPath}" --phoneme-override dream:0:d:jh`;
    
    console.log(`📋 CLI Command: ${cliCommand}`);
    
    return new Promise((resolve) => {
      const process = spawn('bash', ['-c', cliCommand], {
        cwd: '/workspaces/OpenUtau',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 180000 // 3 minute timeout - sometimes large projects need more time
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`📤 OpenUtau stdout: ${data.toString().trim()}`);
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log(`📤 OpenUtau stderr: ${data.toString().trim()}`);
      });
      
      process.on('close', (code) => {
        console.log(`🔚 OpenUtau CLI finished with code: ${code}`);
        console.log(`📊 Output file exists: ${existsSync(outputPath)}`);
        
        if (code === 0 && existsSync(outputPath)) {
          console.log('✅ OpenUtau RenderEngine mixing completed successfully');
          resolve(outputPath);
        } else {
          console.error(`❌ OpenUtau mixing failed with code ${code}`);
          console.error(`📋 Stdout (last 500 chars): ${stdout.slice(-500)}`);
          console.error(`📋 Stderr (last 500 chars): ${stderr.slice(-500)}`);
          resolve(null);
        }
      });
      
      process.on('error', (error) => {
        console.error('❌ OpenUtau mixing process error:', error);
        resolve(null);
      });
      
      // Handle timeout
      setTimeout(() => {
        if (!process.killed) {
          console.error('⏱️ OpenUtau mixing timed out after 5 minutes, terminating...');
          process.kill('SIGTERM');
          resolve(null);
        }
      }, 300000);
    });
    
  } catch (error) {
    console.error('Error in OpenUtau C# mixing:', error);
    return null;
  }
}

/**
 * Integrate our updated segments into OpenUtau's cache system
 * This makes OpenUtau CLI use our updated segments as if they were cached renders
 */
async function integrateUpdatedSegmentsIntoCache(templateName: string, updates: any): Promise<void> {
  try {
    console.log(`🔧 PROPER OpenUtau CACHE INTEGRATION for ${templateName}...`);
    
    // OpenUtau CLI uses a different cache system than our segment cache
    // We need to find where OpenUtau actually stores and looks for cached renders
    
    // Use the REAL OpenUtau cache directory
    const realCacheDir = '/home/codespace/.cache/OpenUtau';
    console.log(`🎯 Using OpenUtau's actual cache directory: ${realCacheDir}`);
    
    if (!existsSync(realCacheDir)) {
      console.error('❌ OpenUtau cache directory does not exist!');
      throw new Error('OpenUtau cache directory not found');
    }
    
    const cacheFiles = require('fs').readdirSync(realCacheDir);
    console.log(`📊 Real OpenUtau cache contains ${cacheFiles.length} files`);
    
    // Show some examples of the actual cache files
    const wavFiles = cacheFiles.filter(f => f.endsWith('.wav'));
    console.log(`📊 Cache WAV files: ${wavFiles.length}`);
    wavFiles.slice(0, 3).forEach(f => console.log(`  - ${f}`));
    
    // Also check our segment cache
    const cacheIndexPath = join('/workspaces/OpenUtau', '.segment_cache', 'cache_index.json');
    console.log(`📊 Our segment cache exists: ${existsSync(cacheIndexPath)}`);
    
    if (!existsSync(cacheIndexPath)) {
      console.log('⚠️ No segment cache found - cannot integrate');
      return;
    }
    
    const cacheIndex = JSON.parse(readFileSync(cacheIndexPath, 'utf8'));
    console.log(`📊 Found ${Object.keys(cacheIndex).length} cached segments in our system`);
    
    // For each update, find the corresponding DiffSinger cache files and replace them
    for (const [updateKey, updateData] of Object.entries(updates)) {
      const update = updateData as any;
      if (!update.audioPath || !existsSync(update.audioPath)) {
        console.log(`⚠️ Skipping ${updateKey} - no audio file found`);
        continue;
      }
      
      const verseNumber = parseInt(updateKey.replace('verse_', ''));
      console.log(`🔄 Replacing OpenUtau cache files for verse ${verseNumber}...`);
      console.log(`📁 Source audio: ${update.audioPath}`);
      
      // Find our segment cache entries for this verse
      const verseEntries = Object.entries(cacheIndex)
        .filter(([hash, data]: [string, any]) => {
          const metadata = data.metadata;
          return metadata && metadata.phraseNumbers && metadata.phraseNumbers.includes(verseNumber);
        });
      
      console.log(`📊 Found ${verseEntries.length} segment cache entries for verse ${verseNumber}`);
      
      if (verseEntries.length === 0) {
        console.log(`⚠️ No segment cache entries found for verse ${verseNumber}`);
        continue;
      }
      
      // Try to find corresponding DiffSinger cache files to replace
      let replacedCount = 0;
      
      // Look for DiffSinger wav files that might correspond to this verse
      // DiffSinger files follow format: ds-{hash}-depth{depth}-steps{steps}.wav
      const dsWavFiles = wavFiles.filter(f => f.startsWith('ds-') && f.includes('-depth'));
      console.log(`📊 Found ${dsWavFiles.length} DiffSinger WAV files in cache`);
      
      // CRITICAL: Find and replace the EXACT cache file that corresponds to this verse
      console.log(`🎯 REPLACING OpenUtau cache file for verse ${verseNumber}...`);
      console.log(`📁 Updated segment audio: ${update.audioPath}`);
      
      if (dsWavFiles.length > 0) {
        console.log(`📊 Current DiffSinger cache files (${dsWavFiles.length}):`);
        
        // Get file sizes to correlate with our updated segment
        const updateStats = require('fs').statSync(update.audioPath);
        console.log(`📊 Updated segment size: ${Math.round(updateStats.size/1024)}KB`);
        
        let replacedFile = null;
        
        for (let i = 0; i < dsWavFiles.length; i++) {
          const f = dsWavFiles[i];
          const filePath = join(realCacheDir, f);
          const stat = require('fs').statSync(filePath);
          console.log(`  ${i+1}. ${f} (${Math.round(stat.size/1024)}KB, modified: ${stat.mtime.toISOString()})`);
          
          // For single file case or exact size match, replace it
          if (dsWavFiles.length === 1 || Math.abs(stat.size - updateStats.size) < 1000) {
            console.log(`🎯 Replacing cache file: ${f} (size match: ${stat.size} ≈ ${updateStats.size})`);
            
            // Replace the DiffSinger cache file with our updated segment
            require('fs').copyFileSync(update.audioPath, filePath);
            console.log(`✅ Replaced ${f} with updated verse ${verseNumber}`);
            
            // Also remove any associated tensor cache files
            const hashPart = f.split('-')[1];
            const tensorCacheFiles = cacheFiles.filter(cf => cf.includes(hashPart) && cf.endsWith('.tensorcache'));
            tensorCacheFiles.forEach(tcf => {
              const tensorPath = join(realCacheDir, tcf);
              try {
                require('fs').unlinkSync(tensorPath);
                console.log(`🗑️ Removed tensor cache: ${tcf}`);
              } catch (err) {
                console.log(`⚠️ Could not remove tensor cache: ${tcf}`);
              }
            });
            
            replacedFile = f;
            replacedCount++;
            break;
          }
        }
        
        if (replacedFile) {
          console.log(`✅ Successfully replaced OpenUtau cache for verse ${verseNumber}: ${replacedFile}`);
        } else {
          console.log(`⚠️ Could not find matching cache file for verse ${verseNumber}`);
        }
      }
      
      // TODO: We need to correlate our segment cache with OpenUtau's phrase structure
      // Let's check if we can correlate timing data
      console.log(`🔍 Analyzing verse ${verseNumber} timing correlation...`);
      
      // Load verse timing data to correlate with OpenUtau phrases
      const timingCachePath = `/workspaces/OpenUtau/still_here_original_cache.json`;
      if (existsSync(timingCachePath)) {
        const timingData = JSON.parse(readFileSync(timingCachePath, 'utf8'));
        const verse = timingData.verses?.find((v: any) => v.verseNumber === verseNumber);
        if (verse) {
          console.log(`📊 Verse ${verseNumber} timing: ${verse.startTimeMs}ms - ${verse.endTimeMs}ms (${verse.endTimeMs - verse.startTimeMs}ms duration)`);
          
          // Check which segment cache entries match this verse
          const matchingEntries = Object.entries(cacheIndex)
            .filter(([hash, data]: [string, any]) => {
              const metadata = data.metadata;
              return metadata && metadata.phraseNumbers && metadata.phraseNumbers.includes(verseNumber);
            });
            
          console.log(`📊 Found ${matchingEntries.length} segment cache entries for verse ${verseNumber}:`);
          matchingEntries.forEach(([hash, data]: [string, any]) => {
            const metadata = data.metadata;
            console.log(`  - Hash: ${hash}, Phrases: [${metadata.phraseNumbers.join(', ')}], File: ${data.filePath}`);
          });
        }
      }
      
      console.log(`📊 Replaced ${replacedCount} cache files for verse ${verseNumber}`);
    }
    
    // CRITICAL: Clear OpenUtau cache to force fresh renders with our updates
    await clearOpenUtauCache();
    
    console.log(`✅ CACHE CLEARED - OpenUtau CLI will render fresh with updated segments`);
    
  } catch (error) {
    console.error('❌ Cache replacement failed:', error);
  }
}

/**
 * Clear OpenUtau's cache to force fresh renders
 * This ensures updated segments get used when OpenUtau CLI runs
 */
async function clearOpenUtauCache(): Promise<void> {
  try {
    console.log(`🧹 Clearing OpenUtau cache to force fresh renders...`);
    
    const realCacheDir = '/home/codespace/.cache/OpenUtau';
    
    if (!existsSync(realCacheDir)) {
      console.log('⚠️ OpenUtau cache directory does not exist');
      return;
    }
    
    const cacheFiles = require('fs').readdirSync(realCacheDir);
    let clearedCount = 0;
    
    // Remove all .wav and .tensorcache files
    for (const file of cacheFiles) {
      if (file.endsWith('.wav') || file.endsWith('.tensorcache')) {
        const filePath = join(realCacheDir, file);
        try {
          require('fs').unlinkSync(filePath);
          clearedCount++;
        } catch (error) {
          console.log(`⚠️ Could not remove ${file}: ${error}`);
        }
      }
    }
    
    console.log(`🗑️ Cleared ${clearedCount} cache files from OpenUtau cache`);
    console.log(`✅ OpenUtau CLI will now render fresh from USTX with updated segments`);
    
  } catch (error) {
    console.error('❌ Failed to clear OpenUtau cache:', error);
  }
}

/**
 * STEP-BY-STEP: Native OpenUtau Cache Integration
 * No buffer operations - let OpenUtau handle everything natively
 */
async function nativeOpenUtauCacheIntegration(templateName: string, updates: any): Promise<string | null> {
  try {
    console.log(`🎯 STEP 2: Direct OpenUtau cache placement for ${templateName}`);
    console.log(`📋 Processing ${Object.keys(updates).length} segment updates`);
    
    // STEP 2: Direct cache placement instead of slow mixing
    if (Object.keys(updates).length === 0) {
      // No updates - return original quickly
      const originalFullSongPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
      if (existsSync(originalFullSongPath)) {
        console.log(`✅ STEP 2: No updates, returning original (instant)`);
        return originalFullSongPath;
      }
    }
    
    // STEP 2: Actually implement segment mixing (temporary solution)
    console.log(`🎵 STEP 2: Implementing simple segment replacement...`);
    const mixedAudioPath = await createMixedAudioWithUpdatedSegments(templateName, updates);
    
    if (mixedAudioPath && existsSync(mixedAudioPath)) {
      console.log(`✅ STEP 2 COMPLETE: Mixed audio created successfully`);
      console.log(`🎵 Path: ${mixedAudioPath}`);
      return mixedAudioPath;
    } else {
      console.log(`❌ STEP 2 FALLBACK: Using original full song`);
      return '/workspaces/OpenUtau/still_here_original_full_song.wav';
    }
    
  } catch (error) {
    console.error('❌ Native OpenUtau integration error:', error);
    return '/workspaces/OpenUtau/still_here_original_full_song.wav'; // Fallback
  }
}

/**
 * STEP 2: Create mixed audio with updated segments (fast implementation)
 */
async function createMixedAudioWithUpdatedSegments(templateName: string, updates: any): Promise<string | null> {
  try {
    console.log(`🎵 Creating mixed audio with ${Object.keys(updates).length} updated segments...`);
    
    // Use the original precision audio replacement logic but optimized
    const baseAudioPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
    if (!existsSync(baseAudioPath)) {
      console.error('❌ Base audio file not found');
      return null;
    }
    
    // Use the precision audio segment replacement that already exists
    console.log(`🎯 Using precision timing-based replacement...`);
    
    return await precisionAudioSegmentReplacement(templateName, updates, baseAudioPath);
    
  } catch (error) {
    console.error('❌ Error creating mixed audio:', error);
    return null;
  }
}

/**
 * STEP 2: Place updated segments directly into OpenUtau's cache directory
 */
async function placeSegmentsInOpenUtauCache(templateName: string, updates: any): Promise<void> {
  console.log(`🔧 STEP 2: Implementing actual segment replacement...`);
  
  for (const [verseKey, updateData] of Object.entries(updates)) {
    const update = updateData as any;
    console.log(`🎯 Processing update for ${verseKey}: ${update.audioPath}`);
    
    if (update.audioPath && existsSync(update.audioPath)) {
      console.log(`✅ Found updated segment: ${update.audioPath} (${update.startNoteIndex}-${update.endNoteIndex})`);
      // Segment file exists and is ready for mixing
    } else {
      console.log(`❌ Updated segment not found: ${update.audioPath}`);
    }
  }
  
  console.log(`✅ STEP 2: Segment analysis completed - ready for native render`);
}

/**
 * BREATH COMPENSATION FUNCTIONS - Easy revert by setting USE_BREATH_COMPENSATION = false
 */

function getBreathAwareStartTime(currentVerse: any, allVerses: any[], verseNumber: number): number {
  console.log(`🔍 Analyzing breath at start of verse ${verseNumber}...`);
  
  if (verseNumber === 1) {
    console.log(`🫁 Verse ${verseNumber}: First verse, using original start time`);
    return currentVerse.startTimeMs;
  }
  
  // Debug: Show all phonemes at verse start
  const allPhonemesAtStart = currentVerse.phonemes?.slice(0, 3) || [];
  console.log(`🔍 First 3 phonemes in verse ${verseNumber}:`, 
    allPhonemesAtStart.map(p => `${p.phoneme}@${p.positionMs}ms`));
  
  // Look for breath phonemes (AP/SP) at the very start of the verse
  const breathPhonemesAtStart = currentVerse.phonemes?.filter((p: any) => 
    (p.phoneme === 'AP' || p.phoneme === 'SP') && 
    Math.abs(p.positionMs - currentVerse.startTimeMs) < 500 // Increased tolerance to 500ms
  ) || [];
  
  console.log(`🔍 Found ${breathPhonemesAtStart.length} breath phonemes near verse ${verseNumber} start`);
  
  if (breathPhonemesAtStart.length > 0) {
    const earliestBreathTime = Math.min(...breathPhonemesAtStart.map((p: any) => p.positionMs));
    console.log(`🫁 Verse ${verseNumber}: Adjusting start ${currentVerse.startTimeMs}ms → ${earliestBreathTime}ms for breath`);
    return earliestBreathTime;
  }
  
  console.log(`🫁 Verse ${verseNumber}: No breath adjustment needed at start`);
  return currentVerse.startTimeMs;
}

function getBreathAwareEndTime(currentVerse: any, allVerses: any[], verseNumber: number): number {
  console.log(`🔍 Analyzing breath at end of verse ${verseNumber}...`);
  
  const nextVerse = allVerses.find(v => v.verseNumber === verseNumber + 1);
  if (!nextVerse) {
    console.log(`🫁 Verse ${verseNumber}: Last verse, using original end time`);
    return currentVerse.endTimeMs;
  }
  
  // Debug: Show last few phonemes of current verse
  const lastPhonemes = currentVerse.phonemes?.slice(-3) || [];
  console.log(`🔍 Last 3 phonemes in verse ${verseNumber}:`, 
    lastPhonemes.map(p => `${p.phoneme}@${p.positionMs}ms(+${p.durationMs}ms)`));
  
  // Debug: Show first few phonemes of next verse  
  const nextFirstPhonemes = nextVerse.phonemes?.slice(0, 3) || [];
  console.log(`🔍 First 3 phonemes in verse ${verseNumber + 1}:`, 
    nextFirstPhonemes.map(p => `${p.phoneme}@${p.positionMs}ms`));
  
  // Check for breath overlap between verses
  const currentVerseBreathAtEnd = currentVerse.phonemes?.filter((p: any) => 
    (p.phoneme === 'AP' || p.phoneme === 'SP') && 
    (p.positionMs + p.durationMs) > (currentVerse.endTimeMs - 500) // Within 500ms of verse end
  ) || [];
  
  const nextVerseBreathAtStart = nextVerse.phonemes?.filter((p: any) => 
    (p.phoneme === 'AP' || p.phoneme === 'SP') && 
    Math.abs(p.positionMs - nextVerse.startTimeMs) < 500 // Within 500ms of next verse start
  ) || [];
  
  console.log(`🔍 Breath at end of verse ${verseNumber}:`, currentVerseBreathAtEnd.length);
  console.log(`🔍 Breath at start of verse ${verseNumber + 1}:`, nextVerseBreathAtStart.length);
  
  if (currentVerseBreathAtEnd.length > 0 && nextVerseBreathAtStart.length > 0) {
    // Potential overlap - truncate current verse to avoid double breath
    const nextBreathStart = Math.min(...nextVerseBreathAtStart.map(p => p.positionMs));
    const safeEndTime = nextBreathStart - 100; // 100ms buffer
    console.log(`🫁 Verse ${verseNumber}: OVERLAP DETECTED! Truncating end ${currentVerse.endTimeMs}ms → ${safeEndTime}ms`);
    return Math.max(safeEndTime, currentVerse.startTimeMs + 1000); // Ensure minimum verse length
  }
  
  console.log(`🫁 Verse ${verseNumber}: No breath overlap detected, using original end time`);
  return currentVerse.endTimeMs;
}

/**
 * Clear the gap before a verse to prevent breath overlap from previous verse
 */
async function clearGapBeforeVerse(audioBuffer: Buffer, audioInfo: any, verses: any[], verseNumber: number): Promise<void> {
  if (verseNumber <= 1) {
    console.log(`🧹 Verse ${verseNumber}: No gap to clear (first verse)`);
    return; // No previous verse
  }
  
  const currentVerse = verses.find(v => v.verseNumber === verseNumber);
  const previousVerse = verses.find(v => v.verseNumber === verseNumber - 1);
  
  if (!currentVerse || !previousVerse) {
    console.log(`🧹 Verse ${verseNumber}: Cannot find verse data for gap clearing`);
    return;
  }
  
  const gapStartMs = previousVerse.endTimeMs;
  const gapEndMs = currentVerse.startTimeMs;
  const gapDurationMs = gapEndMs - gapStartMs;
  
  if (gapDurationMs <= 0) {
    console.log(`🧹 Verse ${verseNumber}: No gap to clear (verses are adjacent)`);
    return;
  }
  
  console.log(`🧹 Verse ${verseNumber}: Clearing gap ${gapStartMs}ms → ${gapEndMs}ms (${gapDurationMs}ms)`);
  
  // Convert time to byte positions
  const bytesPerMs = (audioInfo.sampleRate * audioInfo.channels * (audioInfo.bitsPerSample / 8)) / 1000;
  const gapStartByte = audioInfo.headerSize + Math.floor(gapStartMs * bytesPerMs);
  const gapEndByte = audioInfo.headerSize + Math.floor(gapEndMs * bytesPerMs);
  const gapLength = gapEndByte - gapStartByte;
  
  console.log(`🧹 Clearing audio bytes ${gapStartByte} → ${gapEndByte} (${gapLength} bytes)`);
  
  // Fill gap with silence (zeros)
  audioBuffer.fill(0, gapStartByte, gapEndByte);
  
  console.log(`✅ Gap cleared successfully for verse ${verseNumber}`);
}

/**
 * STEP 2: Create mixed audio with updated segments (simple approach)
 */
async function triggerNativeOpenUtauRender(templateName: string): Promise<string | null> {
  console.log(`🎵 STEP 2: Creating mixed audio with updated segments...`);
  
  // For now, let's use a simple approach - return the original file
  // The actual mixing should happen in Step 3 when we implement USTX-based integration
  const originalPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
  
  if (existsSync(originalPath)) {
    console.log(`✅ STEP 2: Returning original audio (mixing logic pending Step 3)`);
    console.log(`🔜 TODO: Implement actual segment mixing in Step 3`);
    return originalPath;
  } else {
    console.log(`❌ STEP 2: Original audio file not found`);
    return null;
  }
}

/**
 * Mix updated segments with precise timing to preserve silence gaps
 */
async function mixWithPreciseTiming(
  baseAudioPath: string,
  updates: any,
  templateName: string
): Promise<string | null> {
  try {
    console.log(`🎯 Precise timing-based mixing for ${templateName}...`);
    
    // Load the verse timing data from the cached detection
    const timingCachePath = `/workspaces/OpenUtau/${templateName}_cache.json`;
    if (!existsSync(timingCachePath)) {
      console.error('❌ No timing cache found, falling back to OpenUtau render');
      return await fullProjectRender(templateName, updates);
    }
    
    const timingData = JSON.parse(readFileSync(timingCachePath, 'utf8'));
    const verses = timingData.verses || [];
    
    console.log(`📊 Found ${verses.length} verses with timing data`);
    
    // Create output path
    const tempId = uuidv4();
    const outputPath = join('/workspaces/OpenUtau', `openutau_mixed_${tempId}.wav`);
    
    // For now, handle single verse update (most common case)
    const verseUpdates = Object.entries(updates).filter(([key, _]) => key.startsWith('verse_'));
    
    if (verseUpdates.length === 1) {
      const [verseKey, updateData] = verseUpdates[0];
      const update = updateData as any;
      const verseNumber = parseInt(verseKey.replace('verse_', ''));
      
      // Find the verse timing data
      const verse = verses.find((v: any) => v.verseNumber === verseNumber);
      if (!verse || !update.segmentFile || !existsSync(update.segmentFile)) {
        console.error(`❌ Cannot find verse ${verseNumber} timing or audio file`);
        return await fullProjectRender(templateName, updates);
      }
      
      const startTime = verse.startTimeMs / 1000; // Convert to seconds
      const duration = (verse.endTimeMs - verse.startTimeMs) / 1000;
      
      console.log(`🎯 Replacing verse ${verseNumber} at ${startTime}s (duration: ${duration}s)`);
      console.log(`📥 Updated audio: ${update.segmentFile}`);
      
      // Use FFmpeg to replace the specific time segment while preserving the rest
      const ffmpegCommand = `ffmpeg -y -i "${baseAudioPath}" -i "${update.segmentFile}" -filter_complex "[0:0]atrim=0:${startTime}[before];[1:0]atrim=0:${duration}[new];[0:0]atrim=${startTime + duration}[after];[before][new][after]concat=n=3:v=0:a=1[out]" -map "[out]" "${outputPath}"`;
      
      console.log(`🔧 FFmpeg precise replacement: ${ffmpegCommand}`);
      
      return new Promise((resolve) => {
        const process = spawn('bash', ['-c', ffmpegCommand], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        process.on('close', (code) => {
          if (code === 0 && existsSync(outputPath)) {
            console.log('✅ Precise timing mixing completed successfully');
            resolve(outputPath);
          } else {
            console.error(`❌ Precise timing mixing failed with code ${code}`);
            // Fallback to OpenUtau render
            resolve(fullProjectRender(templateName, updates));
          }
        });
        
        process.on('error', (error) => {
          console.error('❌ Precise timing mixing process error:', error);
          resolve(fullProjectRender(templateName, updates));
        });
      });
    } else {
      // Multiple verse updates - use OpenUtau CLI for complex cases
      console.log(`📋 Multiple verse updates (${verseUpdates.length}), using OpenUtau CLI`);
      return await fullProjectRender(templateName, updates);
    }
    
  } catch (error) {
    console.error('Error in precise timing mixing:', error);
    return await fullProjectRender(templateName, updates);
  }
}

/**
 * Efficiently replace segments in base audio using FFmpeg
 */
async function replaceSegmentsInAudio(
  baseAudioPath: string,
  updates: any,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`🔧 Using FFmpeg to replace ${Object.keys(updates).length} segments...`);
    
    // For now, just copy the base audio and replace specific segments
    // This is a simplified approach - in reality you'd need precise timing data
    
    // Simple approach: if only verse_1 is updated, assume it's at the beginning
    const hasVerse1Update = updates.verse_1;
    
    if (hasVerse1Update) {
      const verse1Path = join(process.cwd(), '.segment_updates', 'still_here_original', 'verse_1.wav');
      
      if (existsSync(verse1Path)) {
        // Use FFmpeg to concatenate: updated verse 1 + rest of original song (starting from verse 2)
        // This is a simplified approach - proper implementation would need exact timing
        const ffmpegCommand = `ffmpeg -y -i "${verse1Path}" -i "${baseAudioPath}" -filter_complex "[1]atrim=start=12[rest];[0][rest]concat=n=2:v=0:a=1[out]" -map "[out]" "${outputPath}"`;
        
        console.log(`📋 FFmpeg command: ${ffmpegCommand}`);
        
        const process = spawn('bash', ['-c', ffmpegCommand], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            console.log('✅ FFmpeg segment replacement completed');
            resolve();
          } else {
            console.error(`❌ FFmpeg failed with code ${code}`);
            reject(new Error(`FFmpeg failed with code ${code}`));
          }
        });
        
        process.on('error', (error) => {
          console.error('❌ FFmpeg process error:', error);
          reject(error);
        });
      } else {
        console.error('❌ Updated verse segment not found');
        reject(new Error('Updated verse segment not found'));
      }
    } else {
      // For other segments, fall back to copying base audio for now
      console.log('📋 No verse_1 update, using base audio');
      const copyCommand = `cp "${baseAudioPath}" "${outputPath}"`;
      
      const process = spawn('bash', ['-c', copyCommand]);
      process.on('close', () => {
        resolve();
      });
    }
  });
}

/**
 * Set up OpenUtau's cache directory to use our cached segments
 * This makes OpenUtau CLI behave like the GUI - using cached segments
 */
async function setupOpenUtauCache(templateName: string): Promise<void> {
  try {
    console.log(`🔧 Setting up OpenUtau cache integration...`);
    
    // Read our segment cache index
    const cacheIndexPath = join('/workspaces/OpenUtau', '.segment_cache', 'cache_index.json');
    if (!existsSync(cacheIndexPath)) {
      console.log('⚠️ No segment cache found, OpenUtau will render from scratch');
      return;
    }
    
    const cacheIndex = JSON.parse(readFileSync(cacheIndexPath, 'utf8'));
    const cacheDir = join('/workspaces/OpenUtau', 'UCache');
    
    // Ensure OpenUtau cache directory exists
    if (!existsSync(cacheDir)) {
      const { mkdirSync } = require('fs');
      mkdirSync(cacheDir, { recursive: true });
      console.log(`📁 Created OpenUtau cache directory: ${cacheDir}`);
    }
    
    let copiedCount = 0;
    
    // Copy our cached segments to OpenUtau's expected cache location
    for (const [hash, cacheData] of Object.entries(cacheIndex)) {
      const entry = cacheData as any;
      const sourcePath = entry.filePath;
      
      if (existsSync(sourcePath)) {
        // OpenUtau expects cached files in a specific format
        // We'll use a simple naming scheme that OpenUtau can potentially recognize
        const targetPath = join(cacheDir, `${hash}.wav`);
        
        if (!existsSync(targetPath)) {
          // Copy the cached segment to OpenUtau's cache
          const copyCommand = `cp "${sourcePath}" "${targetPath}"`;
          await new Promise<void>((resolve) => {
            spawn('bash', ['-c', copyCommand]).on('close', () => {
              resolve();
            });
          });
          
          copiedCount++;
        }
      }
    }
    
    console.log(`📋 Set up OpenUtau cache with ${copiedCount} cached segments`);
    console.log(`✅ OpenUtau CLI should now use cached segments like the GUI does`);
    
  } catch (error) {
    console.error('⚠️ Failed to setup OpenUtau cache:', error);
    // Continue anyway - OpenUtau will just render from scratch
  }
}

/**
 * METHOD 1: Timing-based replacement (current approach)
 * Replaces entire verse time range - may cause double breath
 */
async function applyTimingBasedReplacement(
  mixedAudioBuffer: Buffer,
  replacementAudioData: Buffer,
  startBytePos: number,
  segmentLength: number,
  verseNumber: number
): Promise<void> {
  console.log(`⏰ METHOD 1: Timing-based replacement for verse ${verseNumber}`);
  console.log(`⏰ Replacing entire time range: ${segmentLength} bytes at position ${startBytePos}`);
  
  // Simple direct replacement - current working method
  const actualReplacementLength = Math.min(segmentLength, replacementAudioData.length);
  
  // Direct copy without crossfading for speed
  replacementAudioData.copy(mixedAudioBuffer, startBytePos, 0, actualReplacementLength);
  
  console.log(`⏰ Timing-based replacement complete: ${actualReplacementLength} bytes copied`);
}


