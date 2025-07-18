import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const { ustxData, singerId, qualitySettings } = await request.json();
    
    if (!ustxData || !singerId) {
      return NextResponse.json({ error: 'Missing ustxData or singerId' }, { status: 400 });
    }

    // Use the OpenUtau directory where voicebanks are located
    const openUtauDir = '/workspaces/OpenUtau';
    const tempId = uuidv4();
    const ustxPath = join(openUtauDir, `${tempId}.ustx`);
    const outputWav = join(openUtauDir, `${tempId}.wav`);
    const outputJson = join(openUtauDir, `${tempId}.json`);

    try {
      // Write USTX data to temporary file
      await writeFile(ustxPath, JSON.stringify(ustxData, null, 2));

      // Build CLI command with quality settings
      let cliCommand = `rm -rf /home/codespace/.cache/OpenUtau/* && dotnet run --project OpenUtau.Cli -- ${ustxPath} ${singerId} ${outputJson} ${outputWav} --reset-timings --preserve-silence-timing`;
      
      // Add DiffSinger quality parameters if provided
      if (qualitySettings) {
        cliCommand += ` --diffsinger-depth ${qualitySettings.diffSingerDepth}`;
        cliCommand += ` --diffsinger-steps ${qualitySettings.diffSingerSteps}`;
        cliCommand += ` --diffsinger-steps-pitch ${qualitySettings.diffSingerStepsPitch}`;
        cliCommand += ` --diffsinger-steps-variance ${qualitySettings.diffSingerStepsVariance}`;
      }

      // Clear cache and execute OpenUtau CLI
      const cliProcess = spawn('bash', [
        '-c',
        cliCommand
      ], {
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
      const wavBuffer = await readFile(outputWav);
      
      // Read the timing data (optional)
      let timingData = null;
      try {
        const jsonData = await readFile(outputJson, 'utf-8');
        timingData = JSON.parse(jsonData);
      } catch (e) {
        console.warn('Could not read timing data:', e);
      }

      // Clean up temporary files
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(outputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);

      // Return WAV file as response
      return new NextResponse(wavBuffer, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': wavBuffer.length.toString(),
          'Cache-Control': 'no-cache',
          'X-Timing-Data': timingData ? JSON.stringify(timingData) : ''
        }
      });

    } catch (error) {
      // Clean up on error
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(outputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);
      throw error;
    }

  } catch (error) {
    console.error('Render error:', error);
    return NextResponse.json({ 
      error: 'Rendering failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}