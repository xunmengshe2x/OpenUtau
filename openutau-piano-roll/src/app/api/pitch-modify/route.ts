import { NextRequest } from 'next/server';
import { VerseExtractor } from '@/utils/verseExtractor';
import { modifyPitch, parsePitchCommand } from '@/utils/pitchUtils';

interface PitchModificationRequest {
  message: string;
  ustxData: any;
  verseNumber: number;
}

// Enhanced pitch modification with AI understanding
async function intelligentPitchModification(
  verseUSTX: any,
  originalMessage: string,
  verseNumber: number,
  apiKey: string
): Promise<any> {
  console.log(`🤖 STARTING AI PITCH MODIFICATION for verse ${verseNumber}:`, originalMessage);

  // Skip structured parsing - go directly to AI for better results
  console.log('🧠 Using AI-driven pitch interpretation (skipping structured parsing)');
  
  let usedAI = false;
  let aiError = null;

  const prompt = `You are an AI assistant for OpenUtau, a singing synthesizer software. The user has requested a pitch modification for verse ${verseNumber}: "${originalMessage}"

CRITICAL: This modification will be applied to EXISTING pitch data that may already have been modified. BE CONSERVATIVE to avoid making pitch incomprehensible.

**IMPORTANT: PREVENT ROBOTIC SOUND**
- ALWAYS add subtle vibrato (8-12% depth) to any pitch modification to sound natural
- Combine pitch shifts with gentle micro-variations
- Pure pitch shifts without vibrato sound robotic and mechanical

**SAFE PITCH MODIFICATION GUIDELINES:**

1. **shift**: Move notes up/down (LIMIT: ±600 cents max, prefer ±200-300 cents)
   - "higher" → shift +100 to +300 cents (1-3 semitones) + 10% vibrato
   - "lower" → shift -100 to -300 cents (1-3 semitones) + 10% vibrato  
   - "much higher" → shift +300 to +500 cents (3-5 semitones) + 12% vibrato
   - "much lower" → shift -300 to -500 cents (3-5 semitones) + 12% vibrato
   - "flat/flatten" → shift -50 to -150 cents (slight downward) + 8% vibrato
   - "happy" → shift +150 to +250 cents (upward) + 12-15% vibrato for liveliness
   - "super happy" → shift +200 to +350 cents + 15-18% vibrato for energy
   - "clearer" → shift +50 to +100 cents + 10% vibrato for brightness
   - "down a bit" → shift -100 to -200 cents + 10% vibrato

2. **vibrato**: Add vibrato (LIMIT: 5-30% depth max) - USE THIS FREQUENTLY
   - "add vibrato" → 12-16% depth (natural)
   - "more vibrato" → 18-22% depth (moderate)
   - "way more vibrato" → 25-30% depth (strong but not excessive)
   - "less robotic" → 12-15% depth + slight randomization
   - DEFAULT: Always include 8-12% vibrato with any modification

3. **curve**: Pitch expression curves (USE WITH VIBRATO)
   - "dramatic" → gentle arch curves + 12% vibrato
   - "expressive" → subtle pitch bends + 10% vibrato
   - "smoother" → linear transitions + 8% vibrato

4. **reset**: Clear existing modifications (use for "reset", "clean", "original")
   - "reset pitch" → {"type": "reset", "reasoning": "Clear all pitch modifications"}

**CRITICAL ANTI-ROBOTIC RULES:**
- NEVER return pure pitch shifts without vibrato
- ALWAYS add at least 8% vibrato to sound human
- Emotional words (happy, sad, excited) need MORE vibrato (12-18%)
- If unsure, prefer vibrato over pure shifts

Respond with a JSON object. For natural human-like pitch, use "combined" type:
{
  "type": "combined|shift|vibrato|curve|transition|reset",
  "shift": {
    "amount": <number in cents (±600 max)>
  },
  "vibrato": {
    "depth": <percentage 8-30%>
  },
  "pattern": {
    "shape": "linear|arch|sweep|gentle",
    "direction": "up|down|subtle"
  },
  "reasoning": "Brief explanation with amount details"
}

**PREFER "combined" TYPE for natural sound - always include both shift AND vibrato unless specifically asking for vibrato alone.**

**SAFE EXAMPLES (PREFER COMBINED TYPE):**
- "make it higher" → {"type": "combined", "shift": {"amount": 200}, "vibrato": {"depth": 10}, "reasoning": "Shift up 2 semitones with natural vibrato"}
- "much lower" → {"type": "combined", "shift": {"amount": -400}, "vibrato": {"depth": 12}, "reasoning": "Shift down 4 semitones with vibrato"}
- "make verse 1 more happy" → {"type": "combined", "shift": {"amount": 200}, "vibrato": {"depth": 15}, "reasoning": "Happy upward shift with lively vibrato"}
- "super happy" → {"type": "combined", "shift": {"amount": 300}, "vibrato": {"depth": 18}, "reasoning": "Energetic upward shift with strong vibrato"}
- "clearer" → {"type": "combined", "shift": {"amount": 80}, "vibrato": {"depth": 10}, "reasoning": "Slight brightness boost with subtle vibrato"}
- "down a bit" → {"type": "combined", "shift": {"amount": -150}, "vibrato": {"depth": 10}, "reasoning": "Gentle downward with natural vibrato"}
- "add vibrato only" → {"type": "vibrato", "vibrato": {"depth": 12}, "reasoning": "Pure vibrato addition"}
- "reset pitch" → {"type": "reset", "reasoning": "Clear all pitch modifications to baseline"}`;

  try {
    console.log('🌐 CALLING OPENROUTER AI API...');
    
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
            content: 'You are an expert in music pitch modification for singing synthesizers. Analyze user requests and generate appropriate pitch modification parameters. ALWAYS respond with valid JSON only. No explanation text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.2  // Lower temperature for more consistent JSON
      }),
    });

    console.log(`📡 AI API Response Status: ${response.status}`);

    if (!response.ok) {
      aiError = `AI request failed with status ${response.status}`;
      throw new Error(aiError);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content?.trim() || '{}';
    
    console.log('🤖 RAW AI RESPONSE:', aiResponse);
    
    // Parse AI response
    let pitchModification;
    try {
      pitchModification = JSON.parse(aiResponse);
      usedAI = true;
      console.log('✅ AI PARSING SUCCESSFUL:', pitchModification);
    } catch (parseError) {
      aiError = `Failed to parse AI response: ${parseError}`;
      console.error('❌ AI JSON PARSE ERROR:', parseError);
      console.error('📄 AI Response that failed to parse:', aiResponse);
      throw new Error(aiError);
    }

    // Validate AI response has required fields
    if (!pitchModification.type) {
      aiError = 'AI response missing required "type" field';
      throw new Error(aiError);
    }

    // Add verse context
    pitchModification.verse = verseNumber;
    
    console.log('🎯 FINAL AI-GENERATED PITCH MODIFICATION:', pitchModification);
    console.log('🎵 APPLYING AI MODIFICATION TO VERSE USTX...');
    
    // Apply the AI-generated modification to the verse USTX
    return modifyPitch(verseUSTX, pitchModification);

  } catch (error) {
    aiError = error instanceof Error ? error.message : 'Unknown AI error';
    console.error('💥 AI PITCH MODIFICATION FAILED:', aiError);
    console.log('🔄 FALLING BACK TO KEYWORD MATCHING...');
    
    // Use fallback modification
    const fallbackModification = generateFallbackModification(originalMessage);
    fallbackModification.verse = verseNumber;
    fallbackModification.usedAI = false;
    fallbackModification.aiError = aiError;
    
    console.log('📝 FALLBACK MODIFICATION:', fallbackModification);
    
    return modifyPitch(verseUSTX, fallbackModification);
  }
}

// Generate fallback pitch modifications based on keywords (with safety constraints)
function generateFallbackModification(message: string): any {
  const lowerMessage = message.toLowerCase();
  
  // Reset/clean pitch
  if (lowerMessage.includes('reset') || lowerMessage.includes('clean') || lowerMessage.includes('original')) {
    return {
      type: 'reset',
      reasoning: 'Reset pitch to baseline (detected reset keyword)'
    };
  }
  
  // Flatten - reduce pitch variation or slight downward
  if (lowerMessage.includes('flatten') || lowerMessage.includes('flat')) {
    return {
      type: 'combined',
      shift: { amount: -100 }, // Slight downward shift
      vibrato: { depth: 8 }, // Minimal vibrato for flattened sound
      reasoning: 'Flatten pitch - slight downward adjustment with minimal vibrato'
    };
  }
  
  // Clearer pitch
  if (lowerMessage.includes('clearer') || lowerMessage.includes('clear')) {
    return {
      type: 'combined',
      shift: { amount: 80 }, // Slight brightness boost
      vibrato: { depth: 10 }, // Natural vibrato for clarity
      reasoning: 'Clearer pitch - slight brightness boost with natural vibrato'
    };
  }
  
  // Higher/up pitch - use combined for natural sound
  if (lowerMessage.includes('much higher') || lowerMessage.includes('way higher')) {
    return {
      type: 'combined',
      shift: { amount: 400 }, // 4 semitones up (but capped)
      vibrato: { depth: 12 }, // Natural vibrato
      reasoning: 'Much higher pitch with natural vibrato - 4 semitones up'
    };
  }
  if (lowerMessage.includes('higher') || lowerMessage.includes(' up')) {
    return {
      type: 'combined',
      shift: { amount: 200 }, // 2 semitones up
      vibrato: { depth: 10 }, // Subtle vibrato
      reasoning: 'Higher pitch with subtle vibrato - 2 semitones up'
    };
  }
  
  // Lower/down pitch - use combined for natural sound
  if (lowerMessage.includes('much lower') || lowerMessage.includes('way lower')) {
    return {
      type: 'combined',
      shift: { amount: -400 }, // 4 semitones down (but capped)
      vibrato: { depth: 12 }, // Natural vibrato
      reasoning: 'Much lower pitch with natural vibrato - 4 semitones down'
    };
  }
  if (lowerMessage.includes('lower') || lowerMessage.includes('down')) {
    return {
      type: 'combined',
      shift: { amount: -200 }, // 2 semitones down
      vibrato: { depth: 10 }, // Subtle vibrato
      reasoning: 'Lower pitch with subtle vibrato - 2 semitones down'
    };
  }
  
  // Vibrato variations
  if (lowerMessage.includes('way more vibrato') || lowerMessage.includes('lots of vibrato')) {
    return {
      type: 'vibrato',
      amount: 25, // Strong but safe vibrato
      reasoning: 'Strong vibrato - 25% depth'
    };
  }
  if (lowerMessage.includes('more vibrato')) {
    return {
      type: 'vibrato',
      amount: 18, // Moderate vibrato
      reasoning: 'Moderate vibrato - 18% depth'
    };
  }
  if (lowerMessage.includes('vibrato') || lowerMessage.includes('less robotic')) {
    return {
      type: 'vibrato',
      amount: 12, // Subtle vibrato
      reasoning: 'Subtle vibrato for natural sound - 12% depth'
    };
  }
  
  // Dramatic/expressive
  if (lowerMessage.includes('dramatic') || lowerMessage.includes('expressive')) {
    return {
      type: 'curve',
      pattern: { shape: 'gentle', direction: 'subtle' },
      reasoning: 'Gentle dramatic curves for expression'
    };
  }
  
  // Sad/happy emotional cues - use combined for natural expressions
  if (lowerMessage.includes('sad') || lowerMessage.includes('melancholy')) {
    return {
      type: 'combined',
      shift: { amount: -150 }, // Slight downward for sadness
      vibrato: { depth: 8 }, // Subtle, restrained vibrato
      reasoning: 'Sad emotion - gentle downward shift with restrained vibrato'
    };
  }
  if (lowerMessage.includes('super happy') || lowerMessage.includes('really happy')) {
    return {
      type: 'combined',
      shift: { amount: 300 }, // Energetic upward for super happiness
      vibrato: { depth: 18 }, // Strong vibrato for energy
      reasoning: 'Super happy emotion - energetic upward shift with lively vibrato'
    };
  }
  if (lowerMessage.includes('happy') || lowerMessage.includes('cheerful')) {
    return {
      type: 'combined',
      shift: { amount: 150 }, // Slight upward for happiness
      vibrato: { depth: 12 }, // Natural vibrato for warmth
      reasoning: 'Happy emotion - upward shift with warm vibrato'
    };
  }
  
  // Default fallback - very conservative with natural vibrato
  return {
    type: 'combined',
    shift: { amount: 50 }, // Very small adjustment
    vibrato: { depth: 8 }, // Minimal natural vibrato
    reasoning: 'Conservative pitch adjustment with subtle vibrato to avoid robotic sound'
  };
}

export async function POST(request: NextRequest) {
  try {
    const { message, ustxData, verseNumber } = await request.json() as PitchModificationRequest;
    
    console.log('Pitch modification request:', { 
      message, 
      verseNumber, 
      hasUSTXData: !!ustxData 
    });

    if (!message || !ustxData || typeof verseNumber !== 'number') {
      return Response.json({
        success: false,
        error: 'Missing required parameters: message, ustxData, and verseNumber'
      }, { status: 400 });
    }

    // Extract the specific verse data
    const verseExtractor = new VerseExtractor(ustxData);
    const verseData = verseExtractor.extractVerseUSTXData(verseNumber);
    
    if (!verseData) {
      return Response.json({
        success: false,
        error: `Verse ${verseNumber} not found`,
        availableVerses: verseExtractor.getAvailableVerses()
      }, { status: 404 });
    }

    console.log(`Extracted verse ${verseNumber} data:`, {
      noteCount: verseData.ustxData.voice_parts[0]?.notes?.length,
      lyrics: verseData.metadata.lyrics
    });

    // Check if this is a reset operation
    const isResetRequest = message.toLowerCase().includes('reset') || 
                          message.toLowerCase().includes('original') || 
                          message.toLowerCase().includes('clean');
    
    let updatedUSTX: any;
    
    if (isResetRequest) {
      console.log(`🔄 RESET OPERATION: Restoring original pitch data for verse ${verseNumber}`);
      
      // Get the original verse data from the baseline USTX
      const originalVerseData = verseExtractor.getOriginalVerseData(verseNumber);
      if (!originalVerseData) {
        return Response.json({
          success: false,
          error: `Could not retrieve original data for verse ${verseNumber}`
        }, { status: 500 });
      }
      
      // Create a "clean" verse USTX using the original data
      const cleanVerseUSTX = {
        name: `${ustxData.name} - Verse ${verseNumber} (Reset)`,
        resolution: ustxData.resolution || 480,
        bpm: ustxData.bpm || 120,
        voice_parts: [{
          name: `Verse ${verseNumber} Reset`,
          notes: originalVerseData.notes.map((note: any, index: number) => ({
            ...note,
            position: note.position - originalVerseData.notes[0].position // Normalize to start at 0
          })),
          comment: `Reset verse ${verseNumber} to original pitch data`,
          track_no: 0
        }]
      };
      
      // Apply the reset verse back to the original USTX
      updatedUSTX = verseExtractor.applyVerseModifications(verseNumber, cleanVerseUSTX);
      
      console.log('✅ Reset operation completed');
    } else {
      console.log(`🎵 PITCH MODIFICATION: Applying AI-driven changes to verse ${verseNumber}`);
      
      // Apply AI-driven pitch modification to the verse
      const apiKey = process.env.OPENROUTER_API_KEY || "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";
      const modifiedVerseUSTX = await intelligentPitchModification(
        verseData.ustxData,
        message,
        verseNumber,
        apiKey
      );

      console.log('Applied pitch modification to verse USTX');

      // Apply the modified verse back to the original USTX
      updatedUSTX = verseExtractor.applyVerseModifications(verseNumber, modifiedVerseUSTX);
    }
    
    if (!updatedUSTX) {
      return Response.json({
        success: false,
        error: 'Failed to apply verse modifications back to original USTX'
      }, { status: 500 });
    }

    console.log('Successfully applied verse modifications to full USTX');

    // Generate response message based on operation type
    const responseMessage = isResetRequest 
      ? `🔄 **Pitch Reset Successfully!**

**Verse ${verseNumber}** has been restored to original pitch values.

**Reset**: ${verseData.metadata.lyrics}
**Notes restored**: ${verseData.metadata.verseNoteCount} notes

The original pitch data has been restored. You can now make new modifications or render to hear the clean result!`
      : `✅ **Pitch Modified Successfully!**

**Verse ${verseNumber}** pitch has been modified based on: "${message}"

**Modified**: ${verseData.metadata.lyrics}
**Notes affected**: ${verseData.metadata.verseNoteCount} notes

The changes have been applied to your project. You can now render the audio to hear the result!`;

    return Response.json({
      success: true,
      verseNumber,
      originalMessage: message,
      modifiedUSTX: updatedUSTX,
      responseMessage,
      verseMetadata: verseData.metadata,
      operationType: isResetRequest ? 'reset' : 'modification'
    });

  } catch (error) {
    console.error('Pitch modification error:', error);
    return Response.json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const maxDuration = 60; // 1 minute timeout
export const runtime = 'nodejs';