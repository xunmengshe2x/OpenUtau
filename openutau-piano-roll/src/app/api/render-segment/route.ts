import { NextRequest, NextResponse } from 'next/server';
import { USTXData } from '@/types/openutau';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { segmentCache } from '@/utils/segmentCache';

// Modal configuration - Dynamic endpoint selection based on useGPU
const MODAL_CPU_URL = 'https://wwatashi84--openutau-voice-synthesis-render-segment-cpu.modal.run';
const MODAL_GPU_URL = 'https://wwatashi84--openutau-voice-synthesis-render-segment.modal.run';
const USE_MODAL = true; // Set to false to use local CLI

interface SegmentRenderRequest {
  ustxData: USTXData;
  singerId: string;
  startNoteIndex: number;
  endNoteIndex: number;
  lineIndex?: number;
  useGPU?: boolean; // GPU toggle for faster rendering
  qualitySettings?: {
    diffSingerDepth: number;
    diffSingerSteps: number;
    diffSingerStepsPitch: number;
    diffSingerStepsVariance: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const requestBody = await request.json();
    const { ustxData, singerId, startNoteIndex, endNoteIndex, lineIndex, useGPU = false, qualitySettings }: SegmentRenderRequest = requestBody;

    if (!ustxData || !singerId || startNoteIndex == null || endNoteIndex == null) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Step 1: Get phrase data using the existing phrases API with retry logic
    console.log('Getting phrase data from existing phrases API...');
    
    let phrasesResponse: Response | null = null;
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Phrases API attempt ${attempt}/${maxRetries}...`);
        // Try both ports 3000 and 3001 since server might be on either
        const port = attempt === 1 ? 3001 : (attempt === 2 ? 3000 : 3002);
        phrasesResponse = await fetch(`http://localhost:${port}/api/phrases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ustxData, singerId }),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
        
        if (phrasesResponse.ok) {
          console.log(`Phrases API succeeded on attempt ${attempt}`);
          break;
        } else {
          console.log(`Phrases API returned status ${phrasesResponse.status} on attempt ${attempt}`);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.log(`Phrases API error on attempt ${attempt}:`, errorMessage);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          throw new Error(`Failed to connect to phrases API after ${maxRetries} attempts: ${errorMessage}`);
        }
      }
    }
    
    if (!phrasesResponse) {
      throw new Error('Phrases API returned no response after all retries');
    }

    if (!phrasesResponse.ok) {
      throw new Error('Failed to get phrases from phrases API');
    }

    const phrasesData = await phrasesResponse.json();
    console.log(`Got ${phrasesData.phrases?.length || 0} phrases from phrases API`);

    if (!phrasesData.phrases || phrasesData.phrases.length === 0) {
      throw new Error('No phrases returned from phrases API');
    }

    // Step 2: Map lineIndex to phrase numbers - render only the selected phrase
    let targetPhraseNumbers: number[] = [];
    
    if (lineIndex !== undefined && phrasesData.phrases) {
      // Map lineIndex to phrase number - render only the selected phrase
      const phraseIndex = Math.min(Math.max(0, lineIndex), phrasesData.phrases.length - 1);
      targetPhraseNumbers.push(phraseIndex + 1); // CLI uses 1-based phrase numbers
    } else {
      // Fallback: render first phrase only
      targetPhraseNumbers = [1];
    }

    // Remove duplicates and keep only valid phrase numbers
    targetPhraseNumbers = [...new Set(targetPhraseNumbers)].filter(n => n >= 1 && n <= phrasesData.phrases.length);
    
    console.log(`🎯 DEBUG: lineIndex=${lineIndex}, phraseLength=${phrasesData.phrases.length}`);
    console.log(`🎯 DEBUG: targetPhraseNumbers=${JSON.stringify(targetPhraseNumbers)}`);
    console.log(`Rendering phrases: ${targetPhraseNumbers.join(', ')} for lineIndex ${lineIndex}`);

    // Step 3: Check if segment is already cached
    const qualityMode = qualitySettings ? 'custom' : 'standard';
    const cachedSegmentPath = await segmentCache.isSegmentCached(
      ustxData, 
      targetPhraseNumbers, 
      singerId, 
      qualityMode
    );

    if (cachedSegmentPath) {
      // Return cached segment
      console.log(`🚀 Returning cached segment from ${cachedSegmentPath}`);
      const cachedAudioBuffer = await readFile(cachedSegmentPath);
      
      return new NextResponse(cachedAudioBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': cachedAudioBuffer.length.toString(),
          'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
          'X-Segment-Info': JSON.stringify({
            method: 'cached-segment',
            phrasesRendered: targetPhraseNumbers,
            totalPhrases: phrasesData.phrases.length,
            lineIndex,
            targetNotes: `${startNoteIndex}-${endNoteIndex}`,
            cached: true
          })
        },
      });
    }

    // Step 4: Try Modal first, fallback to local CLI if needed
    if (USE_MODAL) {
      try {
        // Select endpoint based on GPU preference
        const modalUrl = useGPU ? MODAL_GPU_URL : MODAL_CPU_URL;
        const endpointType = useGPU ? 'GPU (with CPU fallback)' : '8-core CPU';
        
        console.log(`🚀 Using Modal ${endpointType} for segment rendering...`);
        console.log(`🎯 DEBUG: Sending to Modal - phraseNumbers=${JSON.stringify(targetPhraseNumbers)}`);
        
        // Create payload and log it for debugging
        const requestPayload = useGPU ? {
          // GPU endpoint format - EXACT MATCH to working test script
          ustxData,
          singerId,
          phraseNumbers: targetPhraseNumbers[0] || 1,
          useGPU: true,
          qualitySettings: qualitySettings || {
            diffSingerDepth: 1000,
            diffSingerSteps: 1000,
            diffSingerStepsPitch: 5,
            diffSingerStepsVariance: 4
          }
        } : {
          // CPU endpoint format (simpler, just phraseNumbers)
          ustxData,
          singerId,
          phraseNumbers: targetPhraseNumbers[0] || 1,
          qualitySettings: qualitySettings || {
            diffSingerDepth: 1000,
            diffSingerSteps: 1000,
            diffSingerStepsPitch: 5,
            diffSingerStepsVariance: 4
          }
        };
        
        console.log(`🎯 DEBUG: useGPU=${useGPU}, modalUrl=${modalUrl}`);
        console.log(`🎯 DEBUG: targetPhraseNumbers array:`, targetPhraseNumbers);
        console.log(`🎯 DEBUG: targetPhraseNumbers[0]:`, targetPhraseNumbers[0]);
        console.log(`🎯 DEBUG: Request payload keys: ${Object.keys(requestPayload).join(', ')}`);
        console.log(`🎯 DEBUG: phraseNumbers value: ${requestPayload.phraseNumbers} (type: ${typeof requestPayload.phraseNumbers})`);
        console.log(`🎯 DEBUG: qualitySettings:`, JSON.stringify(requestPayload.qualitySettings));
        if (useGPU) {
          console.log(`🎯 DEBUG: GPU payload - minimal format like test script`);
        } else {
          console.log(`🎯 DEBUG: CPU payload format`);
        }
        
        const modalResponse = await fetch(modalUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestPayload),
        });

        const modalResult = await modalResponse.json();
        
        console.log(`🎯 DEBUG: Modal response keys: ${Object.keys(modalResult).join(', ')}`);
        console.log(`🎯 DEBUG: Modal success: ${modalResult.success}`);
        console.log(`🎯 DEBUG: Modal used_cpu_fallback: ${modalResult.used_cpu_fallback}`);
        console.log(`🎯 DEBUG: Modal cpu_cores: ${modalResult.cpu_cores}`);
        console.log(`🎯 DEBUG: Modal audio size: ${modalResult.size}`);
        
        if (modalResult.success && modalResult.audio) {
          const fallbackMsg = modalResult.used_cpu_fallback ? ' (⚠️ used CPU fallback)' : '';
          console.log(`✅ Modal ${endpointType} segment rendering successful!${fallbackMsg}`);
          
          // Decode base64 audio
          const audioBuffer = Buffer.from(modalResult.audio, 'base64');
          
          // Cache the rendered segment for future use
          await segmentCache.cacheSegment(
            ustxData,
            targetPhraseNumbers,
            singerId,
            audioBuffer,
            qualityMode,
            startNoteIndex,
            endNoteIndex
          );
          
          // Save segment for full song integration
          await saveSegmentForFullSongIntegration(audioBuffer, lineIndex ?? 0, ustxData, startNoteIndex, endNoteIndex);
          
          return new NextResponse(audioBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'audio/wav',
              'Content-Length': audioBuffer.length.toString(),
              'Cache-Control': 'public, max-age=86400',
              'X-Segment-Info': JSON.stringify({
                method: useGPU ? 'modal-gpu-render' : 'modal-8core-cpu-render',
                phrasesRendered: targetPhraseNumbers,
                totalPhrases: phrasesData.phrases.length,
                lineIndex,
                targetNotes: `${startNoteIndex}-${endNoteIndex}`,
                cached: false,
                modalRendered: true,
                endpoint: useGPU ? 'gpu-with-fallback' : '8-core-cpu',
                usedCpuFallback: modalResult.used_cpu_fallback || false
              })
            },
          });
        } else {
          console.warn(`⚠️ Modal ${endpointType} rendering failed, falling back to local CLI:`, modalResult.error);
          // Fall through to local CLI
        }
      } catch (error) {
        console.warn(`⚠️ Modal ${endpointType} request failed, falling back to local CLI:`, error);
        // Fall through to local CLI  
      }
    }

    console.log('🔄 Using local CLI for segment rendering...');

    // Step 5: Render segment if not cached (local CLI fallback)
    const openUtauDir = '/workspaces/OpenUtau';
    const tempId = uuidv4();
    const ustxPath = join(openUtauDir, `segment_${tempId}.ustx`);
    const outputWav = join(openUtauDir, `segment_${tempId}.wav`);
    const outputJson = join(openUtauDir, `segment_${tempId}.json`);

    try {
      // Write the USTX file
      await writeFile(ustxPath, JSON.stringify(ustxData, null, 2));

      // Avoid --trim-leading-silence for phrases that might have significant leading silence
      const skipTrimSilence = targetPhraseNumbers.some(p => p >= 4); // Skip for phrase 4 and later
      let renderCommand = `rm -rf /home/codespace/.cache/OpenUtau/* && dotnet run --project OpenUtau.Cli -- ${ustxPath} ${singerId} ${outputJson} ${outputWav} --reset-timings --phoneme-override dream:0:d:jh --render-phrases ${targetPhraseNumbers.join(',')}`;
      
      if (!skipTrimSilence) {
        renderCommand += ` --trim-leading-silence`;
      } else {
        console.log(`[RENDER-SEGMENT] Skipping --trim-leading-silence for phrase(s) ${targetPhraseNumbers.join(',')}`);
      }
      
      if (qualitySettings?.diffSingerDepth !== undefined) {
        renderCommand += ` --diffsinger-depth ${qualitySettings.diffSingerDepth}`;
        renderCommand += ` --diffsinger-steps ${qualitySettings.diffSingerSteps}`;
        renderCommand += ` --diffsinger-steps-pitch ${qualitySettings.diffSingerStepsPitch}`;
        renderCommand += ` --diffsinger-steps-variance ${qualitySettings.diffSingerStepsVariance}`;
      }

      console.log('Rendering specific phrases:', renderCommand);

      const renderProcess = spawn('bash', ['-c', renderCommand], {
        cwd: '/workspaces/OpenUtau'
      });

      await new Promise<void>((resolve, reject) => {
        let stderr = '';
        let stdout = '';
        renderProcess.stdout.on('data', (data) => stdout += data.toString());
        renderProcess.stderr.on('data', (data) => stderr += data.toString());
        renderProcess.on('close', (code) => {
          console.log(`[RENDER-SEGMENT] Process exited with code: ${code}`);
          console.log(`[RENDER-SEGMENT] Stdout (last 500 chars): ${stdout.slice(-500)}`);
          console.log(`[RENDER-SEGMENT] Stderr (last 500 chars): ${stderr.slice(-500)}`);
          
          // Filter out ONNX runtime warnings which are not actual errors
          const filteredStderr = stderr
            .split('\n')
            .filter(line => !line.includes('CleanUnusedInitializersAndNodeArgs'))
            .filter(line => !line.includes('onnxruntime'))
            .filter(line => !line.includes('Removing initializer'))
            .filter(line => !line.includes('OMP: Info'))
            .filter(line => !line.includes('Warning: '))
            .filter(line => line.trim().length > 0)
            .join('\n')
            .trim();
          
          console.log(`[RENDER-SEGMENT] Filtered stderr: "${filteredStderr}"`);
          console.log(`[RENDER-SEGMENT] Raw stderr (last 1000 chars): "${stderr.slice(-1000)}"`);
          console.log(`[RENDER-SEGMENT] Stdout (last 1000 chars): "${stdout.slice(-1000)}"`);
          console.log(`[RENDER-SEGMENT] Command was: ${renderCommand}`);
          
          if (code === 0) {
            console.log(`[RENDER-SEGMENT] ✅ Success - resolving`);
            resolve();
          } else {
            console.log(`[RENDER-SEGMENT] ❌ Failed with code ${code}`);
            // Provide more detailed error information
            const debugInfo = `Exit code: ${code}\nFiltered stderr: ${filteredStderr}\nRaw stderr: ${stderr.slice(-500)}\nStdout: ${stdout.slice(-500)}`;
            const errorMessage = filteredStderr || `Process exited with code ${code}`;
            reject(new Error(`Phrase rendering failed: ${errorMessage}\n\nDebug info:\n${debugInfo}`));
          }
        });
        renderProcess.on('error', reject);
      });

      // Step 6: Read rendered audio and cache it
      const audioBuffer = await readFile(outputWav);
      
      // Cache the rendered segment for future use
      await segmentCache.cacheSegment(
        ustxData,
        targetPhraseNumbers,
        singerId,
        audioBuffer,
        qualityMode,
        startNoteIndex,
        endNoteIndex
      );
      
      // IMPORTANT: Also save this segment for full song integration
      await saveSegmentForFullSongIntegration(audioBuffer, lineIndex ?? 0, ustxData, startNoteIndex, endNoteIndex);
      
      // Cleanup temporary files
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(outputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);

      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': audioBuffer.length.toString(),
          'Cache-Control': 'public, max-age=86400', // Cache for 24 hours since we have smart cache invalidation
          'X-Segment-Info': JSON.stringify({
            method: 'targeted-phrase-rendering',
            phrasesRendered: targetPhraseNumbers,
            totalPhrases: phrasesData.phrases.length,
            lineIndex,
            targetNotes: `${startNoteIndex}-${endNoteIndex}`,
            cached: false,
            freshlyRendered: true
          })
        },
      });

    } catch (error) {
      // Cleanup on error
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(outputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);
      throw error;
    }

  } catch (error) {
    console.error('Segment render error:', error);
    return NextResponse.json({ 
      error: 'Failed to render segment',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * Save the rendered segment for full song integration
 * This ensures that when the full song is played, it includes the updated segment
 */
async function saveSegmentForFullSongIntegration(
  audioBuffer: Buffer,
  lineIndex: number,
  ustxData: any,
  startNoteIndex: number,
  endNoteIndex: number
): Promise<void> {
  try {
    console.log(`💾 [SEGMENT-SAVE] Starting segment ${lineIndex} for full song integration...`);
    console.log(`💾 [SEGMENT-SAVE] Audio buffer size: ${audioBuffer.length} bytes`);
    console.log(`💾 [SEGMENT-SAVE] USTX data name: "${ustxData?.name}"`);
    
    // Determine template name from USTX data
    let templateName = 'still_here_original'; // Default fallback
    if (ustxData?.name) {
      const baseName = ustxData.name.replace(/\s+/g, '_').toLowerCase();
      console.log(`💾 [SEGMENT-SAVE] Base name from USTX: "${baseName}"`);
      // Map the USTX name to the correct template name
      if (baseName === 'still_here') {
        templateName = 'still_here_original';
      } else {
        templateName = baseName;
      }
    }
    console.log(`💾 [SEGMENT-SAVE] Using template name: "${templateName}"`);
    
    // Map lineIndex to verse number (lineIndex is 0-based, verse numbers are 1-based)
    const verseNumber = lineIndex + 1;
    console.log(`💾 [SEGMENT-SAVE] LineIndex ${lineIndex} -> Verse ${verseNumber}`);
    
    // Create the segment updates directory
    // Fix: Use the same path as openutau-mix API uses
    const segmentDir = join('/workspaces/OpenUtau', '.segment_updates', templateName);
    const segmentFile = join(segmentDir, `verse_${verseNumber}.wav`);
    console.log(`💾 [SEGMENT-SAVE] Segment directory: ${segmentDir}`);
    console.log(`💾 [SEGMENT-SAVE] Segment file: ${segmentFile}`);
    
    // Create directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync(segmentDir)) {
      console.log(`💾 [SEGMENT-SAVE] Creating directory: ${segmentDir}`);
      fs.mkdirSync(segmentDir, { recursive: true });
      console.log(`💾 [SEGMENT-SAVE] Directory created successfully`);
    } else {
      console.log(`💾 [SEGMENT-SAVE] Directory already exists: ${segmentDir}`);
    }
    
    // Verify directory was created
    if (!fs.existsSync(segmentDir)) {
      throw new Error(`Failed to create segment directory: ${segmentDir}`);
    }
    
    // Save the rendered segment
    console.log(`💾 [SEGMENT-SAVE] Writing audio file: ${segmentFile}`);
    writeFileSync(segmentFile, audioBuffer);
    
    // Verify file was written
    if (!existsSync(segmentFile)) {
      throw new Error(`Failed to write segment file: ${segmentFile}`);
    }
    
    const fileStats = fs.statSync(segmentFile);
    console.log(`💾 [SEGMENT-SAVE] ✅ Saved segment to: ${segmentFile} (${fileStats.size} bytes)`);
    
    // Update the metadata file
    const metadataFile = join(segmentDir, 'updates.json');
    console.log(`💾 [SEGMENT-SAVE] Updating metadata file: ${metadataFile}`);
    
    let updates: { [key: string]: any } = {};
    
    if (existsSync(metadataFile)) {
      console.log(`💾 [SEGMENT-SAVE] Loading existing updates.json`);
      try {
        const existingContent = readFileSync(metadataFile, 'utf8');
        updates = JSON.parse(existingContent);
        console.log(`💾 [SEGMENT-SAVE] Existing updates: ${Object.keys(updates).join(', ')}`);
      } catch (parseError) {
        console.log(`💾 [SEGMENT-SAVE] Warning: Could not parse existing updates.json, starting fresh`);
        updates = {};
      }
    } else {
      console.log(`💾 [SEGMENT-SAVE] Creating new updates.json file`);
    }
    
    // Use the format expected by openutau-mix API (verse_1, verse_2, etc.)
    const updateKey = `verse_${verseNumber}`;
    updates[updateKey] = {
      status: 'updated',
      timestamp: Date.now(),
      startNoteIndex,
      endNoteIndex,
      audioPath: segmentFile,
      lineIndex // Store original lineIndex for reference
    };
    
    // Store metadata
    updates._metadata = {
      lastUpdated: Date.now()
    };
    
    console.log(`💾 [SEGMENT-SAVE] Adding update for key: ${updateKey}`);
    console.log(`💾 [SEGMENT-SAVE] Update data:`, JSON.stringify(updates[updateKey], null, 2));
    
    const updatesJson = JSON.stringify(updates, null, 2);
    writeFileSync(metadataFile, updatesJson);
    
    // Verify metadata file was written
    if (!existsSync(metadataFile)) {
      throw new Error(`Failed to write metadata file: ${metadataFile}`);
    }
    
    const metadataStats = fs.statSync(metadataFile);
    console.log(`💾 [SEGMENT-SAVE] ✅ Metadata file written: ${metadataFile} (${metadataStats.size} bytes)`);
    
    // Final verification
    console.log(`💾 [SEGMENT-SAVE] Final verification:`);
    console.log(`💾 [SEGMENT-SAVE] - Segment file exists: ${existsSync(segmentFile)}`);
    console.log(`💾 [SEGMENT-SAVE] - Metadata file exists: ${existsSync(metadataFile)}`);
    console.log(`💾 [SEGMENT-SAVE] - Updates in metadata: ${Object.keys(updates).join(', ')}`);
    
    console.log(`💾 [SEGMENT-SAVE] ✅ SUCCESS: Segment integration saved: verse ${verseNumber} for template ${templateName}`);
    
  } catch (error) {
    console.error('💾 [SEGMENT-SAVE] ❌ ERROR saving segment for full song integration:', error);
    console.error('💾 [SEGMENT-SAVE] ❌ Error stack:', error instanceof Error ? error.stack : 'No stack available');
    // Don't throw - this shouldn't break the main render flow, but log the full error details
  }
}