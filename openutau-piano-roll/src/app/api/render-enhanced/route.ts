import { NextRequest, NextResponse } from 'next/server';
import { USTXData } from '@/types/openutau';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getQualitySettings } from '@/utils/qualitySettings';
import { generateAudioEnhancementCommand, AudioEnhancementSettings } from '@/utils/audioEnhancement';

interface EnhancedRenderRequest {
  ustxData: USTXData;
  singerId: string;
  qualityMode: 'preview' | 'standard' | 'high' | 'super' | 'studio';
  enhancementSettings: AudioEnhancementSettings;
}

export async function POST(request: NextRequest) {
  console.log('🎙️ Enhanced render API called');
  
  try {
    const { ustxData, singerId, qualityMode = 'standard', enhancementSettings }: EnhancedRenderRequest = await request.json();

    if (!ustxData) {
      return NextResponse.json({ error: 'USTX data is required' }, { status: 400 });
    }

    // Generate temporary file paths
    const openUtauDir = '/workspaces/OpenUtau';
    const tempId = uuidv4();
    const ustxPath = join(openUtauDir, `${tempId}.ustx`);
    const rawOutputWav = join(openUtauDir, `${tempId}_raw.wav`);
    const enhancedOutputWav = join(openUtauDir, `${tempId}_enhanced.wav`);
    const outputJson = join(openUtauDir, `${tempId}.json`);

    try {
      // Write USTX to temporary file
      await writeFile(ustxPath, JSON.stringify(ustxData, null, 2));

      // Get quality settings (use studio if requested)
      const effectiveQualityMode = enhancementSettings.useStudioQuality ? 'studio' : qualityMode;
      const qualitySettings = getQualitySettings(effectiveQualityMode);

      console.log(`🎚️ Using quality mode: ${effectiveQualityMode}`);
      console.log(`🔧 Quality settings:`, qualitySettings);

      // Build CLI command with quality parameters and phoneme overrides
      let cliCommand = `rm -rf /home/codespace/.cache/OpenUtau/* && dotnet run --project OpenUtau.Cli -- ${ustxPath} ${singerId} ${outputJson} ${rawOutputWav} --reset-timings --phoneme-override dream:0:d:jh`;
      
      // Add DiffSinger quality parameters
      cliCommand += ` --diffsinger-depth ${qualitySettings.diffSingerDepth}`;
      cliCommand += ` --diffsinger-steps ${qualitySettings.diffSingerSteps}`;
      cliCommand += ` --diffsinger-steps-pitch ${qualitySettings.diffSingerStepsPitch}`;
      cliCommand += ` --diffsinger-steps-variance ${qualitySettings.diffSingerStepsVariance}`;

      console.log('🚀 Executing OpenUtau CLI command:', cliCommand);

      // Execute OpenUtau CLI rendering
      const cliProcess = spawn('bash', ['-c', cliCommand], {
        cwd: '/workspaces/OpenUtau'
      });

      let stdout = '';
      let stderr = '';

      cliProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      cliProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for initial rendering to complete
      await new Promise<void>((resolve, reject) => {
        cliProcess.on('close', (code) => {
          console.log('OpenUtau render stdout:', stdout);
          console.log('OpenUtau render stderr:', stderr);
          
          if (code === 0) {
            console.log('✅ OpenUtau rendering completed successfully');
            resolve();
          } else {
            reject(new Error(`OpenUtau rendering failed with code ${code}. Stderr: ${stderr}`));
          }
        });

        cliProcess.on('error', (error) => {
          console.error('OpenUtau render process error:', error);
          reject(error);
        });
      });

      // Apply audio enhancement post-processing
      let finalAudioPath = rawOutputWav;

      if (enhancementSettings.enableNormalization || 
          enhancementSettings.enableNoiseReduction || 
          enhancementSettings.enableReverb || 
          enhancementSettings.enableCompressor ||
          enhancementSettings.sampleRate !== 44100 ||
          enhancementSettings.bitDepth !== 16) {
        
        console.log('🎛️ Applying audio enhancements...');
        
        // Check if ffmpeg is available
        try {
          await new Promise<void>((resolve, reject) => {
            const ffmpegCheck = spawn('which', ['ffmpeg']);
            ffmpegCheck.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error('FFmpeg not available'));
            });
          });

          // Generate enhancement command
          const enhanceCommand = generateAudioEnhancementCommand(
            rawOutputWav, 
            enhancedOutputWav, 
            enhancementSettings
          );

          console.log('🔧 Enhancement command:', enhanceCommand);

          // Execute enhancement
          const enhanceProcess = spawn('bash', ['-c', enhanceCommand]);
          
          let enhanceStdout = '';
          let enhanceStderr = '';

          enhanceProcess.stdout.on('data', (data) => {
            enhanceStdout += data.toString();
          });

          enhanceProcess.stderr.on('data', (data) => {
            enhanceStderr += data.toString();
          });

          await new Promise<void>((resolve, reject) => {
            enhanceProcess.on('close', (code) => {
              console.log('Enhancement stdout:', enhanceStdout);
              console.log('Enhancement stderr:', enhanceStderr);
              
              if (code === 0) {
                console.log('✅ Audio enhancement completed');
                finalAudioPath = enhancedOutputWav;
                resolve();
              } else {
                console.warn('⚠️ Enhancement failed, using raw audio:', enhanceStderr);
                resolve(); // Continue with raw audio
              }
            });

            enhanceProcess.on('error', (error) => {
              console.warn('Enhancement process error, using raw audio:', error);
              resolve(); // Continue with raw audio
            });
          });

        } catch (ffmpegError) {
          console.warn('⚠️ FFmpeg not available, skipping enhancements:', ffmpegError);
        }
      }

      // Read the final audio file
      console.log(`📁 Reading final audio from: ${finalAudioPath}`);
      const audioBuffer = await readFile(finalAudioPath);
      
      console.log(`🎵 Audio file size: ${audioBuffer.length} bytes`);

      // Clean up temporary files
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(rawOutputWav).catch(() => {}),
        unlink(enhancedOutputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);

      // Return enhanced audio
      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': audioBuffer.length.toString(),
          'Cache-Control': 'no-cache',
          'X-Quality-Mode': effectiveQualityMode,
          'X-Enhancement-Applied': (finalAudioPath === enhancedOutputWav).toString(),
          'X-Audio-Info': JSON.stringify({
            qualityMode: effectiveQualityMode,
            enhancementsApplied: finalAudioPath === enhancedOutputWav,
            sampleRate: enhancementSettings.sampleRate,
            bitDepth: enhancementSettings.bitDepth,
            estimatedSpeedMultiplier: qualitySettings.estimatedSpeedMultiplier
          })
        },
      });

    } catch (error) {
      // Clean up files on error
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(rawOutputWav).catch(() => {}),
        unlink(enhancedOutputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);
      throw error;
    }

  } catch (error) {
    console.error('Enhanced render error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to render with enhancements',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Export configuration
export const maxDuration = 600; // 10 minutes for studio quality renders
export const runtime = 'nodejs';