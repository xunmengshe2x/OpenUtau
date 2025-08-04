import { NextRequest } from 'next/server';
import { VerseExtractor } from '@/utils/verseExtractor';

interface PitchModificationRequest {
  message: string;
  ustxData: any;
  verseNumber?: number;
}

// Enhanced pitch detection that also looks for verse mentions
function isPitchRequestWithVerse(message: string): { isPitch: boolean; verseNumber?: number } {
  const pitchKeywords = [
    /\bpitch\b/i,
    /\bmake\b.*\b(higher|lower|pitch)\b/i,
    /\bhave\b.*\b(higher|lower|much.*pitch|more.*pitch|less.*pitch)\b/i,
    /\bsound\b.*\b(higher|lower|pitch)\b/i,
    /\bchange\b.*\b(pitch|tone|key)\b/i,
    /\braise\b.*\b(pitch|tone|key)\b/i,
    /\blower\b.*\b(pitch|tone|key)\b/i,
    /\bincrease\b.*\b(pitch|tone|key)\b/i,
    /\bdecrease\b.*\b(pitch|tone|key)\b/i,
    /\b(higher|lower)\b.*\b(pitch|tone|key|semitone|octave)\b/i,
    /\btranspose\b/i,
    /\bvibrato\b/i,
    /\bsemitone/i,
    /\boctave/i,
  ];

  const isPitch = pitchKeywords.some(keyword => keyword.test(message));
  
  if (!isPitch) {
    return { isPitch: false };
  }

  // Check for verse mentions
  const verseMatch = message.toLowerCase().match(/(?:verse\s+(\d+)|(first|second|third|1st|2nd|3rd)\s+verse)/);
  let verseNumber: number | undefined;
  
  if (verseMatch) {
    if (verseMatch[1]) {
      verseNumber = parseInt(verseMatch[1]);
    } else if (verseMatch[2]) {
      const ordinals: { [key: string]: number } = {
        'first': 1, '1st': 1,
        'second': 2, '2nd': 2,
        'third': 3, '3rd': 3
      };
      verseNumber = ordinals[verseMatch[2]];
    }
  }

  return { isPitch: true, verseNumber };
}

// Generate AI response asking for verse clarification
async function generateVerseClarificationResponse(
  originalMessage: string,
  availableVerses: Array<{ verseNumber: number; lyrics: string; noteCount: number }>,
  apiKey: string
): Promise<string> {
  const verseSummary = availableVerses.map(v => 
    `Verse ${v.verseNumber}: "${v.lyrics}" (${v.noteCount} notes)`
  ).join('\n');

  const prompt = `The user requested a pitch modification: "${originalMessage}"

Available verses in this song:
${verseSummary}

Since the user didn't specify which verse to modify, ask them to clarify which verse they want to modify. Be conversational and helpful. Suggest they could say something like "verse 1" or "the first verse" or "all verses" if they want to modify everything.

Keep your response concise and friendly. Don't explain what pitch modification is - just ask for clarification.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "moonshotai/kimi-k2",
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant for a music editing application. Generate clear, conversational responses asking for clarification about which verse to modify.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      throw new Error(`AI request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || 
           "Which verse would you like me to modify the pitch for? You can say something like 'verse 1' or 'the first verse'.";
  } catch (error) {
    console.error('Error generating verse clarification response:', error);
    return "Which verse would you like me to modify the pitch for? You can say something like 'verse 1' or 'the first verse'.";
  }
}

export async function POST(request: NextRequest) {
  try {
    const { message, ustxData } = await request.json() as PitchModificationRequest;
    
    console.log('Pitch verse clarification request:', { message, hasUSTXData: !!ustxData });

    if (!message) {
      return new Response('Message is required', { status: 400 });
    }

    if (!ustxData) {
      return new Response('USTX data is required', { status: 400 });
    }

    // Analyze the pitch request
    const pitchAnalysis = isPitchRequestWithVerse(message);
    
    if (!pitchAnalysis.isPitch) {
      return Response.json({
        success: false,
        error: 'Not a pitch modification request',
        message
      });
    }

    // If verse is already specified, return it directly
    if (pitchAnalysis.verseNumber) {
      console.log(`Verse ${pitchAnalysis.verseNumber} already specified in request`);
      return Response.json({
        success: true,
        verseSpecified: true,
        verseNumber: pitchAnalysis.verseNumber,
        message,
        action: 'proceed_with_pitch_modification'
      });
    }

    // Extract available verses using our verse extractor
    const verseExtractor = new VerseExtractor(ustxData);
    const availableVerses = verseExtractor.getVerseSummary();

    if (availableVerses.length === 0) {
      return Response.json({
        success: false,
        error: 'No verses found in USTX data',
        message
      });
    }

    console.log('Available verses for clarification:', availableVerses);

    // Generate AI response asking for clarification
    const apiKey = process.env.OPENROUTER_API_KEY || "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";
    const clarificationResponse = await generateVerseClarificationResponse(
      message,
      availableVerses,
      apiKey
    );

    return Response.json({
      success: true,
      verseSpecified: false,
      needsClarification: true,
      clarificationMessage: clarificationResponse,
      availableVerses,
      originalMessage: message,
      action: 'request_verse_clarification'
    });

  } catch (error) {
    console.error('Pitch verse clarification error:', error);
    return Response.json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const maxDuration = 30;
export const runtime = 'nodejs';