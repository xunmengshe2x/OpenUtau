import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateName = 'still_here_original', singerId = 'fem_1_ln' } = body;

    // Use the existing template system - leverage the full song audio that already exists
    const audioPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
    
    // Validate audio file exists
    if (!fs.existsSync(audioPath)) {
      return NextResponse.json(
        { error: `Template audio not found: ${audioPath}` },
        { status: 404 }
      );
    }

    // Load template data for verse detection
    const templateResponse = await fetch(`http://localhost:3000/api/templates?name=${templateName}`);
    const templateData = await templateResponse.json();
    
    if (!templateData.success) {
      return NextResponse.json(
        { error: 'Failed to load template data' },
        { status: 500 }
      );
    }

    console.log(`Creating karaoke video for template: ${templateName}`);

    // Generate output filename
    const timestamp = Date.now();
    const outputVideo = path.join(
      process.cwd(), 
      'public', 
      `karaoke_${templateName}_${timestamp}.mp4`
    );

    // Create karaoke video using the template system
    await createKaraokeVideoFromTemplate(
      templateData.ustxData,
      templateData.verses || [],
      audioPath,
      outputVideo,
      singerId
    );

    // Check if output file was created
    if (fs.existsSync(outputVideo)) {
      const videoUrl = `/karaoke_${templateName}_${timestamp}.mp4`;
      
      return NextResponse.json({
        success: true,
        videoUrl,
        message: 'Karaoke video created from template',
        templateName,
        versesCount: templateData.verses?.length || 0
      });
    } else {
      return NextResponse.json(
        { error: 'Video file was not created' },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('Karaoke template render error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to render karaoke video from template',
        details: error.message
      },
      { status: 500 }
    );
  }
}

async function createKaraokeVideoFromTemplate(
  ustxData: any,
  verses: any[],
  audioPath: string,
  outputVideo: string,
  singerId: string
) {
  console.log(`Creating karaoke video with ${verses.length} verses`);
  
  // Generate lip sync data with Rhubarb
  const rhubarbPath = "/workspaces/OpenUtau/Rhubarb-Lip-Sync-1.14.0-Linux/rhubarb";
  const tempJsonFile = path.join('/tmp', `rhubarb_${Date.now()}.json`);
  
  const rhubarbCommand = `${rhubarbPath} -f json -o "${tempJsonFile}" "${audioPath}"`;
  console.log('Running Rhubarb:', rhubarbCommand);
  
  await execAsync(rhubarbCommand);
  
  let lipSyncData = [];
  if (fs.existsSync(tempJsonFile)) {
    const rhubarbOutput = JSON.parse(fs.readFileSync(tempJsonFile, 'utf8'));
    lipSyncData = rhubarbOutput.mouthCues || [];
    fs.unlinkSync(tempJsonFile);
  }

  // Create video frames directory
  const frameDir = path.join('/tmp', `frames_${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });

  try {
    // Calculate video duration from audio
    const audioInfo = await execAsync(`ffprobe -v quiet -print_format json -show_format "${audioPath}"`);
    const audioData = JSON.parse(audioInfo.stdout);
    const duration = parseFloat(audioData.format.duration);
    
    const frameRate = 30;
    const totalFrames = Math.ceil(duration * frameRate);
    const width = 1920;
    const height = 1080;

    console.log(`Generating ${totalFrames} frames for ${duration}s video`);

    // Generate frames using Node.js canvas (simpler than C# SkiaSharp for now)
    await generateKaraokeFrames(
      frameDir,
      totalFrames,
      duration,
      width,
      height,
      verses,
      ustxData,
      lipSyncData
    );

    // Combine frames with audio using FFmpeg
    const ffmpegCommand = `ffmpeg -y -framerate ${frameRate} -i "${frameDir}/frame_%06d.png" -i "${audioPath}" -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest "${outputVideo}"`;
    
    console.log('Running FFmpeg:', ffmpegCommand);
    await execAsync(ffmpegCommand);

  } finally {
    // Cleanup temp directory
    if (fs.existsSync(frameDir)) {
      fs.rmSync(frameDir, { recursive: true, force: true });
    }
  }
}

async function generateKaraokeFrames(
  frameDir: string,
  totalFrames: number,
  duration: number,
  width: number,
  height: number,
  verses: any[],
  ustxData: any,
  lipSyncData: any[]
) {
  // For now, create simple text-based frames using ImageMagick
  // This is a quick solution - could be enhanced with proper graphics later
  
  for (let frame = 0; frame < totalFrames; frame++) {
    const timestamp = (frame / 30); // 30 fps
    
    // Find current verse and lyrics
    const currentVerse = findVerseAtTime(verses, timestamp, ustxData);
    const lyricsText = currentVerse?.lyrics || 'OpenUtau Karaoke';
    
    // Find current mouth shape from lip sync data
    const mouthShape = findMouthShapeAtTime(lipSyncData, timestamp);
    
    // Create frame with ImageMagick (simple approach)
    const framePath = path.join(frameDir, `frame_${frame.toString().padStart(6, '0')}.png`);
    
    const imageCommand = `convert -size ${width}x${height} xc:black ` +
      `-fill white -pointsize 72 -gravity center ` +
      `-annotate +0-200 "${lyricsText.replace(/"/g, '\\"')}" ` +
      `-fill yellow -pointsize 48 -gravity center ` +
      `-annotate +0+200 "♪ ${mouthShape} ♪" ` +
      `"${framePath}"`;
    
    try {
      await execAsync(imageCommand);
    } catch (error) {
      // Fallback: create a simple colored frame if ImageMagick fails
      await execAsync(`convert -size ${width}x${height} xc:black "${framePath}"`);
    }
  }
}

function findVerseAtTime(verses: any[], timestamp: number, ustxData: any) {
  // Simple time-based verse detection
  // This would need proper timing calculation from USTX data
  const verseIndex = Math.floor(timestamp / 10); // Rough 10-second verses
  return verses[verseIndex % verses.length];
}

function findMouthShapeAtTime(lipSyncData: any[], timestamp: number) {
  for (const cue of lipSyncData) {
    if (timestamp >= cue.start && timestamp <= cue.end) {
      return cue.value || 'X';
    }
  }
  return 'X'; // Default closed mouth
}

// GET endpoint to list available templates
export async function GET() {
  return NextResponse.json({
    templates: [
      {
        name: 'still_here_original',
        displayName: 'Still Here (Original)',
        audioFile: 'still_here_original_full_song.wav',
        supported: true
      }
    ]
  });
}