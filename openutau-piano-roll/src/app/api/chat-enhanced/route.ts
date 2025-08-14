import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface ChatEnhancedRequest {
  message: string;
  ustxPath?: string;
  messageHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  useAnalyzeVerses?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ChatEnhancedRequest;
    const { message, ustxPath, messageHistory = [], useAnalyzeVerses = false } = body;

    // Check for specific verse editing patterns that should use CLI
    const cliPatterns = [
      /analyze.*(verse|phrase)/i,
      /show.*(verse|phrase)/i,
      /list.*(verse|phrase)/i
    ];
    
    const shouldUseCLI = cliPatterns.some(pattern => pattern.test(message));

    if (shouldUseCLI && ustxPath && fs.existsSync(ustxPath)) {
      console.log('🎵 Using analyze-verses CLI for analysis request');
      return await handleVerseAnalysis(ustxPath, message);
    }

    // For verse editing requests, still use the regular chat API (which has the tools)
    // but add a flag to indicate we want to preserve phrase boundaries
    console.log('🗣️ Forwarding to regular chat API with enhanced context');
    return await forwardToChatAPI(message, messageHistory, ustxPath);

  } catch (error) {
    console.error('Error in chat-enhanced API:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

async function handleVerseAnalysis(ustxPath: string, message: string) {
  return new Promise((resolve) => {
    const openUtauRoot = '/workspaces/OpenUtau';
    const cliArgs = ['run', '--project', 'OpenUtau.Cli', '--', 'analyze-verses', ustxPath];
    
    let output = '';
    let errorOutput = '';

    const process = spawn('dotnet', cliArgs, {
      cwd: openUtauRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        resolve(NextResponse.json({ 
          error: 'Verse analysis failed', 
          stderr: errorOutput,
          stdout: output
        }, { status: 500 }));
        return;
      }

      // Parse verse analysis results
      const verses = parseVerseAnalysisOutput(output);
      
      // Generate a response based on the analysis
      let response = `## 📝 Verse Analysis Complete\n\n`;
      response += `Found **${verses.length} phrases** in the song:\n\n`;
      
      verses.forEach((verse, i) => {
        response += `**Phrase ${verse.phraseNumber}** (${verse.timing}):\n`;
        response += `- Lyrics: "${verse.lyrics}"\n`;
        response += `- Phonemes: ${verse.phonemes.join(' ')}\n\n`;
      });
      
      if (message.toLowerCase().includes('edit') || message.toLowerCase().includes('change')) {
        response += `\n💡 **To edit lyrics**: Use the interactive mode by specifying which phrase number you want to change and the new lyrics.\n`;
        response += `\nExample: "Change phrase 3 lyrics to 'new words here'"\n`;
      }
      
      resolve(NextResponse.json({
        success: true,
        response,
        verses,
        analysisOutput: output
      }));
    });

    process.on('error', (error) => {
      resolve(NextResponse.json({ 
        error: 'Failed to start analysis process', 
        message: error.message 
      }, { status: 500 }));
    });
  });
}

async function forwardToChatAPI(message: string, messageHistory: any[], ustxPath?: string) {
  try {
    // Forward the streaming request back to the chat API
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        messages: messageHistory,
        enhancedMode: true,  // Flag to indicate this came from enhanced API
        preservePhrases: true, // Hint to use analyze-verses approach
        ustxPath
      })
    });

    if (!response.ok) {
      throw new Error(`Chat API failed: ${response.status}`);
    }

    // Return the streaming response as-is
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked'
      }
    });

  } catch (error) {
    return NextResponse.json({ 
      error: 'Chat forwarding failed', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

function parseVerseAnalysisOutput(output: string) {
  const verses = [];
  const lines = output.split('\n');
  
  let currentPhrase = null;
  
  for (const line of lines) {
    // Parse phrase headers like "Phrase 1: (0.00s to 2.48s, 119 frames)"
    const phraseMatch = line.match(/^Phrase (\d+): \(([^)]+)\)/);
    if (phraseMatch) {
      if (currentPhrase) {
        verses.push(currentPhrase);
      }
      
      const [, phraseNum, timing] = phraseMatch;
      currentPhrase = {
        phraseNumber: parseInt(phraseNum),
        timing: timing,
        lyrics: '',
        phonemes: []
      };
      continue;
    }
    
    // Parse lyrics line
    if (line.startsWith('  Lyrics: ') && currentPhrase) {
      currentPhrase.lyrics = line.substring('  Lyrics: '.length).trim();
      continue;
    }
    
    // Parse phonemes line
    if (line.startsWith('  Phonemes: ') && currentPhrase) {
      const phonemesStr = line.substring('  Phonemes: '.length).trim();
      currentPhrase.phonemes = phonemesStr.split(' ').filter(p => p.length > 0);
      continue;
    }
  }
  
  // Don't forget the last phrase
  if (currentPhrase) {
    verses.push(currentPhrase);
  }
  
  return verses;
}