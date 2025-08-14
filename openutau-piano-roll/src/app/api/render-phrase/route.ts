import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface RenderPhraseRequest {
  ustxPath: string;
  singerPath: string;
  outputWavPath?: string;
  outputJsonPath?: string;
  phraseNumber?: number;
  renderPhrases?: string; // e.g., "1,2,3" or "1-5"
  resetTimings?: boolean;
  preserveSilenceTiming?: boolean;
  forceOriginalFile?: boolean; // Force using the original file instead of edited versions
  phonemeOverrides?: Array<{
    word: string;
    position: number;
    phoneme: string;
    language: string;
  }>;
  diffsingerDepth?: number;
  diffsingerSteps?: number;
  diffsingerStepsPitch?: number;
  diffsingerStepsVariance?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RenderPhraseRequest;
    const { 
      ustxPath, 
      singerPath, 
      outputWavPath,
      outputJsonPath,
      phraseNumber,
      renderPhrases,
      resetTimings = true,
      preserveSilenceTiming = true,
      forceOriginalFile = false,
      phonemeOverrides = [],
      diffsingerDepth = 0.9,
      diffsingerSteps = 20,
      diffsingerStepsPitch = 10,
      diffsingerStepsVariance = 20
    } = body;

    if (!ustxPath || !singerPath) {
      return NextResponse.json({ 
        error: 'USTX path and singer path are required' 
      }, { status: 400 });
    }

    // Use the most recent edited USTX file if available (unless forceOriginalFile is true)
    let actualUstxPath = ustxPath;
    
    if (!forceOriginalFile) {
      const currentPathFile = '/workspaces/OpenUtau/.current_ustx_path';
      
      try {
        if (fs.existsSync(currentPathFile)) {
          const recentPath = fs.readFileSync(currentPathFile, 'utf8').trim();
          if (fs.existsSync(recentPath)) {
            actualUstxPath = recentPath;
            console.log(`📝 Using most recent edited file: ${path.basename(recentPath)}`);
          }
        }
      } catch (error) {
        console.warn('Could not read current USTX path, using original:', error);
      }
    } else {
      console.log(`🔒 Force original file mode: Using ${path.basename(ustxPath)}`);
    }
    
    // Convert to absolute paths
    const absoluteUstxPath = path.resolve(actualUstxPath);
    const absoluteSingerPath = path.resolve(singerPath);
    
    if (!fs.existsSync(absoluteUstxPath)) {
      return NextResponse.json({ 
        error: `USTX file not found: ${absoluteUstxPath}` 
      }, { status: 404 });
    }
    
    if (!fs.existsSync(absoluteSingerPath)) {
      return NextResponse.json({ 
        error: `Singer not found: ${absoluteSingerPath}` 
      }, { status: 404 });
    }

    // Generate output paths if not provided
    const timestamp = Date.now();
    const finalOutputWav = outputWavPath || `/workspaces/OpenUtau/openutau-piano-roll/public/rendered_${timestamp}.wav`;
    const finalOutputJson = outputJsonPath || `/workspaces/OpenUtau/openutau-piano-roll/public/metadata_${timestamp}.json`;

    const openUtauRoot = '/workspaces/OpenUtau';
    const cliArgs = [
      'run', '--project', 'OpenUtau.Cli', '--',
      absoluteUstxPath,
      absoluteSingerPath,
      finalOutputJson,
      finalOutputWav
    ];

    // Add optional parameters
    if (resetTimings) {
      cliArgs.push('--reset-timings');
    }
    
    if (preserveSilenceTiming) {
      cliArgs.push('--preserve-silence-timing');
    }

    // Add phoneme overrides
    for (const override of phonemeOverrides) {
      cliArgs.push('--phoneme-override', 
        `${override.word}:${override.position}:${override.phoneme}:${override.language}`);
    }

    // Add render phrases specification
    if (renderPhrases) {
      cliArgs.push('--render-phrases', renderPhrases);
    } else if (phraseNumber) {
      cliArgs.push('--render-phrases', phraseNumber.toString());
    }

    // Add DiffSinger parameters
    cliArgs.push('--diffsinger-depth', diffsingerDepth.toString());
    cliArgs.push('--diffsinger-steps', diffsingerSteps.toString());
    cliArgs.push('--diffsinger-steps-pitch', diffsingerStepsPitch.toString());
    cliArgs.push('--diffsinger-steps-variance', diffsingerStepsVariance.toString());

    console.log('🎵 Starting render with command:', cliArgs.join(' '));

    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';
      const startTime = Date.now();

      const process = spawn('dotnet', cliArgs, {
        cwd: openUtauRoot,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      process.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        console.log('STDOUT:', chunk);
      });

      process.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        console.log('STDERR:', chunk);
      });

      process.on('close', (code) => {
        const endTime = Date.now();
        const renderTime = (endTime - startTime) / 1000;
        
        console.log(`🏁 Render process completed with code ${code} in ${renderTime}s`);

        if (code !== 0) {
          resolve(NextResponse.json({ 
            error: 'Render failed', 
            stderr: errorOutput,
            stdout: output,
            code,
            renderTime
          }, { status: 500 }));
          return;
        }

        // Check if output files were created
        const wavExists = fs.existsSync(finalOutputWav);
        const jsonExists = fs.existsSync(finalOutputJson);
        
        let metadata = null;
        if (jsonExists) {
          try {
            metadata = JSON.parse(fs.readFileSync(finalOutputJson, 'utf8'));
          } catch (e) {
            console.warn('Could not parse metadata JSON:', e);
          }
        }

        // Get relative paths for client
        const relativeWavPath = wavExists ? path.relative('/workspaces/OpenUtau/openutau-piano-roll/public', finalOutputWav) : null;
        const relativeJsonPath = jsonExists ? path.relative('/workspaces/OpenUtau/openutau-piano-roll/public', finalOutputJson) : null;

        resolve(NextResponse.json({
          success: true,
          renderTime,
          output,
          files: {
            wav: wavExists ? `/${relativeWavPath}` : null,
            json: jsonExists ? `/${relativeJsonPath}` : null
          },
          metadata,
          command: cliArgs.join(' ')
        }));
      });

      process.on('error', (error) => {
        console.error('Process error:', error);
        resolve(NextResponse.json({ 
          error: 'Failed to start render process', 
          message: error.message 
        }, { status: 500 }));
      });

      // Set a timeout for long-running renders
      setTimeout(() => {
        if (!process.killed) {
          process.kill();
          resolve(NextResponse.json({ 
            error: 'Render timeout', 
            message: 'Render process took too long (>5 minutes)' 
          }, { status: 408 }));
        }
      }, 5 * 60 * 1000); // 5 minutes
    });

  } catch (error) {
    console.error('Error in render-phrase API:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}