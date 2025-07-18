import { NextRequest, NextResponse } from 'next/server';
import { USTXData, USTXNote } from '@/types/openutau';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

interface SegmentRenderRequest {
  ustxData: USTXData;
  singerId: string;
  startNoteIndex: number;
  endNoteIndex: number;
  lineIndex?: number;
  qualitySettings?: {
    diffSingerDepth: number;
    diffSingerSteps: number;
    diffSingerStepsPitch: number;
    diffSingerStepsVariance: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { ustxData, singerId, startNoteIndex, endNoteIndex, lineIndex, qualitySettings }: SegmentRenderRequest = await request.json();

    if (!ustxData) {
      return NextResponse.json({ error: 'USTX data is required' }, { status: 400 });
    }

    // Create a segment USTX with only the specified notes
    const segmentUSTX = createSegmentUSTX(ustxData, startNoteIndex, endNoteIndex);
    
    // Generate temporary file paths (use OpenUtau directory like main render API)
    const openUtauDir = '/workspaces/OpenUtau';
    const tempId = uuidv4();
    const ustxPath = join(openUtauDir, `segment_${tempId}.ustx`);
    const outputWav = join(openUtauDir, `segment_${tempId}.wav`);
    const outputJson = join(openUtauDir, `segment_${tempId}.json`);

    try {
      // Write segment USTX to temporary file (as JSON like main API)
      await writeFile(ustxPath, JSON.stringify(segmentUSTX, null, 2));

      // Build CLI command with quality settings
      let cliCommand = `rm -rf /home/codespace/.cache/OpenUtau/* && dotnet run --project OpenUtau.Cli -- ${ustxPath} ${singerId} ${outputJson} ${outputWav} --reset-timings --preserve-silence-timing`;
      
      // Add DiffSinger quality parameters if provided
      if (qualitySettings) {
        cliCommand += ` --diffsinger-depth ${qualitySettings.diffSingerDepth}`;
        cliCommand += ` --diffsinger-steps ${qualitySettings.diffSingerSteps}`;
        cliCommand += ` --diffsinger-steps-pitch ${qualitySettings.diffSingerStepsPitch}`;
        cliCommand += ` --diffsinger-steps-variance ${qualitySettings.diffSingerStepsVariance}`;
      }

      // Render the segment using OpenUtau CLI
      const cliProcess = spawn('bash', [
        '-c',
        cliCommand
      ], {
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

      // Wait for rendering to complete
      await new Promise<void>((resolve, reject) => {
        cliProcess.on('close', (code) => {
          console.log('Segment render stdout:', stdout);
          console.log('Segment render stderr:', stderr);
          
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Segment rendering failed with code ${code}. Stderr: ${stderr}`));
          }
        });

        cliProcess.on('error', (error) => {
          console.error('Segment render process error:', error);
          reject(error);
        });
      });

      // Read the rendered audio file
      const audioBuffer = await readFile(outputWav);
      
      // Clean up temporary files
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(outputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);

      // Return the audio as a blob
      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': audioBuffer.length.toString(),
          'Cache-Control': 'no-cache',
          'X-Segment-Info': JSON.stringify({
            startNoteIndex,
            endNoteIndex,
            lineIndex,
            noteCount: endNoteIndex - startNoteIndex + 1
          })
        },
      });

    } catch (error) {
      // Clean up files on error
      await Promise.all([
        unlink(ustxPath).catch(() => {}),
        unlink(outputWav).catch(() => {}),
        unlink(outputJson).catch(() => {})
      ]);
      throw error;
    }

  } catch (error) {
    console.error('Segment render error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to render segment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

function createSegmentUSTX(originalUSTX: USTXData, startNoteIndex: number, endNoteIndex: number): USTXData {
  // Get all notes from all voice parts
  const allNotes: USTXNote[] = [];
  originalUSTX.voice_parts?.forEach(part => {
    part.notes?.forEach(note => {
      allNotes.push(note);
    });
  });

  // Extract the segment notes
  const segmentNotes = allNotes.slice(startNoteIndex, endNoteIndex + 1);
  
  if (segmentNotes.length === 0) {
    throw new Error('No notes in specified segment');
  }

  // Adjust positions to start from 0
  const startPosition = segmentNotes[0].position;
  const adjustedNotes = segmentNotes.map(note => ({
    ...note,
    position: note.position - startPosition
  }));

  // Create segment USTX
  const segmentUSTX: USTXData = {
    ...originalUSTX,
    name: `${originalUSTX.name} - Segment`,
    voice_parts: [
      {
        name: 'Segment',
        comment: `Notes ${startNoteIndex}-${endNoteIndex}`,
        track_no: 0,
        position: 0,
        notes: adjustedNotes
      }
    ]
  };

  return segmentUSTX;
}