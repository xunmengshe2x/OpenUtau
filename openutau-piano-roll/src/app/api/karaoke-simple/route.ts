import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

interface LyricsLine {
  text: string;
  startTime: number;
  endTime: number;
  verseNumber: number;
  words?: LyricsWord[];
}

interface LyricsWord {
  text: string;
  startTime: number;
  endTime: number;
}

export async function POST(request: NextRequest) {
  // This endpoint has been disabled - it requires karaoke sprites and Rhubarb lip sync
  return NextResponse.json(
    { error: 'Karaoke video generation has been disabled' },
    { status: 501 }
  );
  /*
  try {
    const body = await request.json();
    const { ustxFile = '/workspaces/OpenUtau/still_here.ustx', singerId = 'fem_1_ln' } = body;

    console.log(`Creating simple karaoke video for: ${ustxFile}`);

    // Step 1: Load USTX data
    if (!fs.existsSync(ustxFile)) {
      return NextResponse.json(
        { error: `USTX file not found: ${ustxFile}` },
        { status: 404 }
      );
    }

    // USTX files are YAML format, use the existing template API to load them
    const templateResponse = await fetch(`http://localhost:3000/api/templates?name=still_here_original`);
    const templateData = await templateResponse.json();
    
    if (!templateData.ustxData) {
      return NextResponse.json(
        { error: 'Failed to load USTX data' },
        { status: 500 }
      );
    }
    
    const ustxData = templateData.ustxData;

    // Step 2: Get phrase detection using existing API
    console.log('Getting phrase detection...');
    const phrasesResponse = await fetch('http://localhost:3000/api/phrases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ustxData, singerId })
    });

    let phrases = [];
    if (phrasesResponse.ok) {
      const phrasesData = await phrasesResponse.json();
      phrases = phrasesData.phrases || [];
      console.log(`Found ${phrases.length} phrases`);
    } else {
      console.log('Phrase detection failed, using fallback');
      // Simple fallback - extract lyrics from notes
      phrases = extractSimplePhrases(ustxData);
    }

    // Step 3: Use existing full song audio
    const audioPath = '/workspaces/OpenUtau/still_here_original_full_song.wav';
    if (!fs.existsSync(audioPath)) {
      return NextResponse.json(
        { error: `Audio file not found: ${audioPath}` },
        { status: 404 }
      );
    }

    // Step 4: Add word-level timing to phrases
    const phrasesWithWords = extractWordTiming(phrases);
    
    // Step 5: Generate video
    const timestamp = Date.now();
    const outputVideo = path.join(
      process.cwd(), 
      'public', 
      `karaoke_simple_${timestamp}.mp4`
    );

    await createSimpleKaraokeVideo(phrasesWithWords, audioPath, outputVideo, ustxData);

    if (fs.existsSync(outputVideo)) {
      const videoUrl = `/karaoke_simple_${timestamp}.mp4`;
      
      return NextResponse.json({
        success: true,
        videoUrl,
        message: 'Simple karaoke video created',
        phrasesCount: phrases.length
      });
    } else {
      return NextResponse.json(
        { error: 'Video file was not created' },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('Simple karaoke error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to create simple karaoke video',
        details: error.message
      },
      { status: 500 }
    );
  }
}

function extractWordTiming(phrases: any[]): LyricsLine[] {
  return phrases.map((phrase, phraseIndex) => {
    // Handle different phrase data structures
    const phraseText = phrase.text || phrase.lyrics || phrase.content || '';
    const phraseStart = phrase.startTime || phrase.start || 0;
    const phraseEnd = phrase.endTime || phrase.end || phraseStart + 2;
    
    const words = phraseText.split(' ').filter((word: string) => word.trim());
    const phraseDuration = phraseEnd - phraseStart;
    const avgWordDuration = Math.max(0.1, phraseDuration / Math.max(1, words.length));
    
    const wordsWithTiming: LyricsWord[] = words.map((word: string, wordIndex: number) => ({
      text: word,
      startTime: phraseStart + (wordIndex * avgWordDuration),
      endTime: phraseStart + ((wordIndex + 1) * avgWordDuration)
    }));
    
    return {
      text: phraseText,
      startTime: phraseStart,
      endTime: phraseEnd,
      verseNumber: phraseIndex + 1,
      words: wordsWithTiming
    };
  });
}

function extractSimplePhrases(ustxData: any): LyricsLine[] {
  if (!ustxData.voice_parts || !ustxData.voice_parts[0]?.notes) {
    return [];
  }

  const notes = ustxData.voice_parts[0].notes
    .filter((note: any) => note.lyric && note.lyric.trim() !== '' && !note.lyric.startsWith('+'))
    .sort((a: any, b: any) => a.position - b.position);

  // Group notes into lines (rough grouping every 8-10 words)
  const phrases: LyricsLine[] = [];
  const wordsPerLine = 8;
  
  for (let i = 0; i < notes.length; i += wordsPerLine) {
    const lineNotes = notes.slice(i, Math.min(i + wordsPerLine, notes.length));
    const text = lineNotes.map((note: any) => note.lyric).join(' ');
    
    // Convert positions to seconds (rough approximation)
    const ticksPerSecond = (ustxData.resolution * ustxData.bpm) / 60.0;
    const startTime = lineNotes[0].position / ticksPerSecond;
    const endTime = (lineNotes[lineNotes.length - 1].position + lineNotes[lineNotes.length - 1].duration) / ticksPerSecond;
    
    phrases.push({
      text,
      startTime,
      endTime,
      verseNumber: Math.floor(i / wordsPerLine) + 1
    });
  }

  return phrases;
}

// Live2D phoneme to mouth parameter mapping (matches C++ implementation)
interface Live2DMouthParams {
  mouthOpenY: number;
  mouthForm: number;
}

function calculateLive2DMouthParameters(
  currentPhoneme: string, 
  nextPhoneme: string, 
  interpolationFactor: number
): Live2DMouthParams {
  const phonemeMapping: Record<string, Live2DMouthParams> = {
    'A': { mouthOpenY: 1.0, mouthForm: 0.0 },    // Wide open mouth
    'B': { mouthOpenY: 0.0, mouthForm: -1.0 },   // Closed lips (plosive)
    'C': { mouthOpenY: 0.4, mouthForm: 0.2 },    // Slightly open
    'D': { mouthOpenY: 0.3, mouthForm: 0.4 },    // Tongue position
    'E': { mouthOpenY: 0.7, mouthForm: 0.1 },    // Mid open
    'F': { mouthOpenY: 0.1, mouthForm: -0.8 },   // Lip contact
    'G': { mouthOpenY: 0.5, mouthForm: 0.2 },    // Back tongue
    'H': { mouthOpenY: 0.2, mouthForm: 0.0 },    // Aspirated
    'X': { mouthOpenY: 0.0, mouthForm: 0.0 }     // Closed/rest
  };

  const currentParams = phonemeMapping[currentPhoneme] || phonemeMapping['X'];
  const nextParams = phonemeMapping[nextPhoneme] || phonemeMapping['X'];

  // Smooth interpolation between phonemes
  const mouthOpenY = currentParams.mouthOpenY + 
    (nextParams.mouthOpenY - currentParams.mouthOpenY) * interpolationFactor;
  const mouthForm = currentParams.mouthForm + 
    (nextParams.mouthForm - currentParams.mouthForm) * interpolationFactor;

  return { mouthOpenY, mouthForm };
}

async function createSimpleKaraokeVideo(
  phrases: LyricsLine[],
  audioPath: string,
  outputVideo: string,
  ustxData: any
) {
  console.log(`Creating karaoke video with ${phrases.length} phrases`);
  
  // Get audio duration (limited to 30 seconds for performance and disk space)
  const audioInfo = await execAsync(`ffprobe -v quiet -print_format json -show_format "${audioPath}"`);
  const audioData = JSON.parse(audioInfo.stdout);
  const fullDuration = parseFloat(audioData.format.duration);
  const duration = Math.min(30, fullDuration);
  
  console.log(`Audio duration: ${fullDuration}s, limiting video to: ${duration}s`);
  
  // Generate lip sync data with Rhubarb
  const rhubarbPath = "/workspaces/OpenUtau/Rhubarb-Lip-Sync-1.14.0-Linux/rhubarb";
  const tempJsonFile = path.join('/tmp', `rhubarb_${Date.now()}.json`);
  
  try {
    // Create a temporary 30-second audio clip for faster Rhubarb processing
    const tempAudioFile = path.join('/tmp', `audio_30s_${Date.now()}.wav`);
    await execAsync(`ffmpeg -y -i "${audioPath}" -t ${duration} "${tempAudioFile}"`);
    
    const rhubarbCommand = `${rhubarbPath} -f json -o "${tempJsonFile}" "${tempAudioFile}"`;
    console.log('Running Rhubarb on 30s clip:', rhubarbCommand);
    await execAsync(rhubarbCommand);
    
    // Cleanup temp audio file
    if (fs.existsSync(tempAudioFile)) {
      fs.unlinkSync(tempAudioFile);
    }
    
    let lipSyncData = [];
    if (fs.existsSync(tempJsonFile)) {
      const rhubarbOutput = JSON.parse(fs.readFileSync(tempJsonFile, 'utf8'));
      lipSyncData = rhubarbOutput.mouthCues || [];
      fs.unlinkSync(tempJsonFile);
    }

    // Create frames using ImageMagick
    const frameRate = 30;
    const totalFrames = Math.ceil(duration * frameRate);
    const width = 1920;
    const height = 1080;

    console.log(`Generating ${totalFrames} frames for ${duration}s video`);

    // Create frame directory
    const frameDir = path.join('/tmp', `frames_${Date.now()}`);
    fs.mkdirSync(frameDir, { recursive: true });

    try {
      // Generate frames
      for (let frame = 0; frame < totalFrames; frame++) {
        const timestamp = frame / frameRate;
        
        // Find current phrase and word
        const currentPhrase = phrases.find(p => timestamp >= p.startTime && timestamp <= p.endTime);
        let lyricsText = currentPhrase?.text || 'OpenUtau Karaoke';
        let currentWordIndex = -1;
        
        if (currentPhrase?.words) {
          currentWordIndex = currentPhrase.words.findIndex(w => timestamp >= w.startTime && timestamp <= w.endTime);
        }
        
        // Find mouth shape with Live2D-style parameter interpolation
        let currentMouthShape = 'X';
        let nextMouthShape = 'X';
        let interpolationFactor = 0.0;
        
        // Find current and next phoneme cues for smooth transitions
        let currentCue = null;
        let nextCue = null;
        
        for (let i = 0; i < lipSyncData.length; i++) {
          const cue = lipSyncData[i];
          if (timestamp >= cue.start && timestamp <= cue.end) {
            currentCue = cue;
            nextCue = lipSyncData[i + 1] || null;
            break;
          }
        }
        
        if (currentCue) {
          currentMouthShape = currentCue.value || 'X';
          
          // Calculate interpolation for smooth transitions
          if (nextCue && timestamp > (currentCue.end - 0.1)) {
            // In transition zone (last 0.1 seconds of current phoneme)
            interpolationFactor = (timestamp - (currentCue.end - 0.1)) / 0.1;
            nextMouthShape = nextCue.value || 'X';
          }
        }
        
        // Create smooth mouth parameter transitions (Live2D style)
        const mouthParams = calculateLive2DMouthParameters(currentMouthShape, nextMouthShape, interpolationFactor);
        
        // Log Live2D parameters for debugging (every 30 frames to avoid spam)
        if (frame % 30 === 0) {
          console.log(`Frame ${frame}: Phoneme ${currentMouthShape} -> Live2D params: OpenY=${mouthParams.mouthOpenY.toFixed(2)}, Form=${mouthParams.mouthForm.toFixed(2)}`);
        }
        
        // Create frame with character sprite
        const framePath = path.join(frameDir, `frame_${frame.toString().padStart(6, '0')}.png`);
        const spritesDir = '/workspaces/OpenUtau/karaoke-sprites';
        const characterBase = `${spritesDir}/character_base.png`;
        const mouthSprite = `${spritesDir}/mouth_${currentMouthShape}.png`;
        
        // Check if mouth sprite exists, fallback to X (closed mouth)
        const mouthFile = fs.existsSync(mouthSprite) ? mouthSprite : `${spritesDir}/mouth_X.png`;
        
        // Create karaoke lyrics with color highlighting
        let lyricsDisplay = '';
        if (currentPhrase?.words) {
          const words = currentPhrase.words;
          const sung = words.slice(0, currentWordIndex).map(w => w.text).join(' ');
          const current = currentWordIndex >= 0 ? words[currentWordIndex].text : '';
          const upcoming = words.slice(currentWordIndex + 1).map(w => w.text).join(' ');
          
          lyricsDisplay = [sung, current, upcoming].filter(s => s).join(' ').substring(0, 50);
        } else {
          lyricsDisplay = lyricsText.substring(0, 50);
        }
        
        const imageCommand = `convert -size ${width}x${height} xc:"#0a0a1a" ` +
          `-gravity center "${characterBase}" -composite ` +
          `-gravity center -geometry +0+15 "${mouthFile}" -composite ` +
          `-fill white -pointsize 42 -font Arial-Bold -gravity north ` +
          `-annotate +0+80 "${lyricsDisplay.replace(/"/g, '\\"')}" ` +
          `-fill "#FFD700" -pointsize 20 -gravity south ` +
          `-annotate +0+60 "♪ OpenUtau AI Singer ♪" ` +
          `-fill "#888888" -pointsize 16 -gravity south ` +
          `-annotate +0+30 "Lip Sync: ${currentMouthShape} | Live2D: OpenY=${mouthParams.mouthOpenY.toFixed(1)} Form=${mouthParams.mouthForm.toFixed(1)}" ` +
          `"${framePath}"`;
        
        await execAsync(imageCommand);
        
        // Progress indicator
        if (frame % 100 === 0) {
          console.log(`Generated ${frame}/${totalFrames} frames`);
        }
      }

      // Combine frames with audio using FFmpeg (limit audio to video duration)
      const ffmpegCommand = `ffmpeg -y -framerate ${frameRate} -i "${frameDir}/frame_%06d.png" -i "${audioPath}" -t ${duration} -c:v libx264 -c:a aac -pix_fmt yuv420p -shortest "${outputVideo}"`;
      
      console.log('Running FFmpeg...');
      await execAsync(ffmpegCommand);

    } finally {
      // Cleanup
      if (fs.existsSync(frameDir)) {
        fs.rmSync(frameDir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.error('Error in video creation:', error);
    throw error;
  }
}

  */
}

export async function GET() {
  return NextResponse.json({
    message: 'Simple karaoke video generator (disabled)',
    error: 'This endpoint requires karaoke sprites and Rhubarb lip sync which have been removed'
  });
}