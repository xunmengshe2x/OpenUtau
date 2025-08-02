import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { USTXLyricsManager } from '@/utils/ustxLyricsUtils';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ustxFile, singerId, character = 'Haru', renderPhrases } = body;

    if (!ustxFile || !singerId) {
      return NextResponse.json(
        { error: 'Missing required parameters: ustxFile and singerId' },
        { status: 400 }
      );
    }

    // Validate USTX file exists
    const ustxPath = path.resolve(ustxFile);
    if (!fs.existsSync(ustxPath)) {
      return NextResponse.json(
        { error: `USTX file not found: ${ustxFile}` },
        { status: 404 }
      );
    }

    // Generate output filename
    const timestamp = Date.now();
    const outputVideo = path.join(
      process.cwd(), 
      'public', 
      `karaoke_${path.basename(ustxFile, '.ustx')}_${timestamp}.mp4`
    );

    console.log(`🎬 Starting karaoke video render:`, {
      ustxFile: ustxPath,
      singerId,
      character,
      renderPhrases,
      outputVideo
    });

    // Step 1: Generate mixed audio using the working OpenUtau CLI  
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const audioFile = path.join(tempDir, `mixed_${path.basename(ustxFile, '.ustx')}_${timestamp}.wav`);
    
    // Build audio command with optional phrase selection
    let audioCommand = `dotnet run --project /workspaces/OpenUtau/OpenUtau.Cli -- "${ustxPath}" "${singerId}" "/dev/null" "${audioFile}"`;
    if (renderPhrases) {
      // Add phrase selection like: --render-phrases 1,2,3
      const phrasesStr = Array.isArray(renderPhrases) ? renderPhrases.join(',') : renderPhrases.toString();
      audioCommand += ` --render-phrases ${phrasesStr}`;
      console.log(`🎯 Rendering specific phrases: ${phrasesStr}`);
    }
    
    console.log(`🎵 Generating audio: ${audioCommand}`);
    
    try {
      const { stdout: audioStdout, stderr: audioStderr } = await execAsync(audioCommand, {
        timeout: 120000, // 2 minutes for audio generation
        cwd: '/workspaces/OpenUtau'
      });
      
      console.log('Audio generation completed:', audioStdout);
      if (audioStderr) console.log('Audio stderr:', audioStderr);
      
      if (!fs.existsSync(audioFile)) {
        throw new Error('Audio file was not generated');
      }
    } catch (audioError: any) {
      console.error('Audio generation failed:', audioError);
      return NextResponse.json(
        { 
          error: 'Failed to generate audio',
          details: audioError.message
        },
        { status: 500 }
      );
    }

    // Step 2: Generate phoneme data using the working phrases API approach
    const phrasesFile = path.join(tempDir, `phrases_${timestamp}.json`);
    const phrasesCommand = `dotnet run --project /workspaces/OpenUtau/OpenUtau.Cli -- "${ustxPath}" "${singerId}" "${phrasesFile}" "/dev/null" --phrases-only`;
    
    console.log(`📝 Generating phoneme data: ${phrasesCommand}`);
    
    try {
      const { stdout: phrasesStdout, stderr: phrasesStderr } = await execAsync(phrasesCommand, {
        timeout: 60000, // 1 minute for phrases
        cwd: '/workspaces/OpenUtau'
      });
      
      console.log('Phrases generation completed:', phrasesStdout);
      if (phrasesStderr) console.log('Phrases stderr:', phrasesStderr);
      
      if (!fs.existsSync(phrasesFile)) {
        throw new Error('Phrases file was not generated');
      }
    } catch (phrasesError: any) {
      console.error('Phrases generation failed:', phrasesError);
      return NextResponse.json(
        { 
          error: 'Failed to generate phoneme data',
          details: phrasesError.message
        },
        { status: 500 }
      );
    }

    // Step 3: Generate karaoke video using our amazing Godot system
    const generateVideoScript = '/workspaces/OpenUtau/karaoke-godot-project/generate_video.sh';
    const videoCommand = `bash "${generateVideoScript}" --audio "${audioFile}" --phonemes "${phrasesFile}" --output "${outputVideo}" --character "${character}"`;
    
    console.log(`🎮 Generating Godot karaoke video: ${videoCommand}`);
    
    const { stdout, stderr } = await execAsync(videoCommand, {
      timeout: 600000, // 10 minutes for video generation
      cwd: '/workspaces/OpenUtau',
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer to handle Godot's verbose output
    });

    console.log('Godot video generation stdout:', stdout);
    if (stderr) {
      console.log('Godot video generation stderr:', stderr);
    }

    // Step 4: Cleanup temporary files
    try {
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      if (fs.existsSync(phrasesFile)) fs.unlinkSync(phrasesFile);
    } catch (cleanupError) {
      console.log('Cleanup warning:', cleanupError);
    }

    // Check if output file was created
    if (fs.existsSync(outputVideo)) {
      const videoUrl = `/karaoke_${path.basename(ustxFile, '.ustx')}_${timestamp}.mp4`;
      
      return NextResponse.json({
        success: true,
        videoUrl,
        character,
        message: `✨ Amazing karaoke video rendered successfully with ${character}!`,
        logs: stdout
      });
    } else {
      return NextResponse.json(
        { 
          error: 'Video file was not created by Godot system',
          logs: stdout,
          stderr 
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('Karaoke render error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to render karaoke video',
        details: error.message,
        stderr: error.stderr
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check available USTX files and characters
export async function GET() {
  try {
    const rootDir = '/workspaces/OpenUtau';
    const files = fs.readdirSync(rootDir);
    const ustxFiles = files.filter(file => file.endsWith('.ustx'));
    
    // Available characters from our Godot system
    const availableCharacters = [
      'Haru', 'Hiyori', 'Mao', 'Mark', 'Natori', 'Rice', 'Wanko'
    ];
    
    return NextResponse.json({
      ustxFiles: ustxFiles.map(file => ({
        name: file,
        path: path.join(rootDir, file)
      })),
      characters: availableCharacters,
      message: '🎬 Godot karaoke system ready with amazing character selection!'
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to list USTX files', details: error.message },
      { status: 500 }
    );
  }
}