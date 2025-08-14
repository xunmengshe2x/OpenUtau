import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface RenderVerseRequest {
  ustxPath: string;
  verseNumber: number;
  singerId?: string;
  depth?: number;
  steps?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RenderVerseRequest;
    const { 
      ustxPath, 
      verseNumber, 
      singerId = 'fem_1_ln',
      depth = 0.9,
      steps = 20  // Reduced from 520 for faster rendering
    } = body;

    if (!ustxPath || !verseNumber) {
      return NextResponse.json({ error: 'USTX path and verse number are required' }, { status: 400 });
    }

    // Use the most recent edited USTX file if available
    let actualUstxPath = ustxPath;
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
    
    // Convert to absolute path
    const absolutePath = path.resolve(actualUstxPath);
    
    if (!fs.existsSync(absolutePath)) {
      return NextResponse.json({ error: `USTX file not found: ${absolutePath}` }, { status: 404 });
    }

    const openUtauRoot = '/workspaces/OpenUtau';
    const outputDir = path.join(openUtauRoot, 'temp_renders');
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const outputJson = path.join(outputDir, `verse_${verseNumber}_${timestamp}.json`);
    const outputWav = path.join(outputDir, `verse_${verseNumber}_${timestamp}.wav`);
    
    // Build CLI command
    const cliArgs = [
      'run', '--project', 'OpenUtau.Cli', '--',
      absolutePath,
      singerId,
      outputJson,
      outputWav,
      '--reset-timings',
      '--preserve-silence-timing',
      '--render-phrases', verseNumber.toString(),
      '--diffsinger-depth', depth.toString(),
      '--diffsinger-steps', steps.toString(),
      '--diffsinger-steps-pitch', '10',
      '--diffsinger-steps-variance', '20'
    ];

    console.log(`🎵 Rendering verse ${verseNumber} with CLI command:`, cliArgs.join(' '));

    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';

      const childProcess = spawn('dotnet', cliArgs, {
        cwd: openUtauRoot,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      childProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      childProcess.on('close', (code) => {
        if (code !== 0) {
          console.error('❌ Render failed with code:', code);
          console.error('stderr:', errorOutput);
          resolve(NextResponse.json({ 
            error: 'Render failed', 
            stderr: errorOutput,
            stdout: output,
            code 
          }, { status: 500 }));
          return;
        }

        // Check if WAV file was created
        if (!fs.existsSync(outputWav)) {
          resolve(NextResponse.json({ 
            error: 'WAV file not created',
            stdout: output
          }, { status: 500 }));
          return;
        }

        // Read the WAV file and return it
        const audioBuffer = fs.readFileSync(outputWav);
        
        // Clean up temp files
        try {
          fs.unlinkSync(outputJson);
          fs.unlinkSync(outputWav);
        } catch (e) {
          console.warn('Failed to clean up temp files:', e);
        }

        console.log(`✅ Successfully rendered verse ${verseNumber}`);
        
        // Return the audio file
        resolve(new NextResponse(audioBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': audioBuffer.length.toString(),
          },
        }));
      });

      childProcess.on('error', (error) => {
        resolve(NextResponse.json({ 
          error: 'Failed to start render process', 
          message: error.message 
        }, { status: 500 }));
      });
    });

  } catch (error) {
    console.error('Error in render-verse API:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}