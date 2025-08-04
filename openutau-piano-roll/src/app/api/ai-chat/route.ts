import { NextRequest, NextResponse } from 'next/server';
import { USTXData, USTXNote } from '@/types/openutau';
import { modifyPitch, parsePitchCommand, PitchModification } from '@/utils/pitchUtils';
import yaml from 'js-yaml';

interface AIRequest {
  message: string;
  ustxData?: USTXData;
}

interface AIResponse {
  message: string;
  updatedUSTX?: USTXData;
  changes?: Array<{
    type: 'lyrics' | 'pitch' | 'timing' | 'vibrato' | 'expression';
    description: string;
    noteIndex?: number;
    oldValue?: any;
    newValue?: any;
  }>;
}

// System prompt for DeepSeek R1 to understand USTX format and music editing
const SYSTEM_PROMPT = `You are an AI assistant specialized in OpenUtau USTX file editing and music composition.

USTX File Structure:
- name: Project name
- bpm: Tempo in beats per minute
- resolution: Ticks per quarter note (usually 480)
- voice_parts: Array of vocal parts containing notes
- notes: Array with position, duration, tone (MIDI note), lyric, pitch curves, vibrato

Your capabilities:
1. LYRICS EDITING: Change note lyrics, handle phonetic symbols, manage syllable timing
2. PITCH ADJUSTMENT: Modify note tones (MIDI numbers 0-127), add pitch curves, apply pitch shifts
3. PITCH CURVES: Add pitch bends with shapes (linear, arch, valley, wave) and intensity
4. VIBRATO CONTROL: Add/modify vibrato parameters (length, period, depth, in, out)
5. PITCH TRANSITIONS: Apply gradual pitch changes across verses or note ranges
6. TIMING MODIFICATION: Adjust note positions and durations
7. EXPRESSION CONTROL: Modify dynamics, voice color, attack, decay, gender, etc.

Guidelines:
- Always preserve the USTX structure and required fields
- Handle phonetic continuations marked with '+' properly
- Maintain proper timing relationships between notes
- Use MIDI note numbers (C4 = 60, C5 = 72, etc.)
- Keep vibrato values within reasonable ranges (0-100% for most parameters)
- Provide clear explanations of changes made

When making changes, respond with:
1. A human-readable message explaining what was changed
2. The updated USTX data structure
3. A summary of specific changes made

For pitch references:
- C4 (Middle C) = 60
- Each semitone = +1 MIDI note
- Octave = +12 MIDI notes

Common pitch modification commands:
- "Make verse 1 higher" → Pitch shift up by 3-5 semitones
- "Add upward sweep to chorus" → Linear pitch curve with positive intensity
- "High-low-high transition" → Arch-shaped pitch curve
- "Add vibrato to sustained notes" → Vibrato on notes longer than quarter note
- "Raise pitch by 300 cents" → Specific pitch adjustment

Pitch curve shapes:
- linear: Straight line pitch change
- arch: Up-down curve (emotional peaks)
- valley: Down-up curve (tension-release)
- wave: Oscillating pitch pattern`;

export async function POST(request: NextRequest) {
  try {
    const { message, ustxData }: AIRequest = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get OpenRouter API key from environment
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenRouter API key not configured' },
        { status: 500 }
      );
    }

    // Prepare the context for the AI
    const context = ustxData ? {
      projectName: ustxData.name,
      bpm: ustxData.bpm,
      resolution: ustxData.resolution,
      totalNotes: ustxData.voice_parts?.reduce((sum, part) => sum + (part.notes?.length || 0), 0) || 0,
      currentLyrics: ustxData.voice_parts?.flatMap(part => 
        part.notes?.map(note => note.lyric) || []
      ).join(' ').replace(/\+/g, '').trim(),
      sampleNotes: ustxData.voice_parts?.slice(0, 1).flatMap(part => 
        part.notes?.slice(0, 10).map(note => ({
          position: note.position,
          duration: note.duration,
          tone: note.tone,
          lyric: note.lyric
        })) || []
      )
    } : null;

    // Create the AI prompt
    const aiPrompt = `${SYSTEM_PROMPT}

User Request: ${message}

${context ? `Current Project Context:
- Name: ${context.projectName}
- BPM: ${context.bpm}
- Resolution: ${context.resolution}
- Total Notes: ${context.totalNotes}
- Current Lyrics: ${context.currentLyrics}
- Sample Notes: ${JSON.stringify(context.sampleNotes, null, 2)}

Full USTX Data:
${JSON.stringify(ustxData, null, 2)}` : 'No project currently loaded.'}

Please respond with:
1. A clear explanation of what changes you would make
2. If applicable, the modified USTX data structure
3. A summary of specific changes

Remember to maintain the exact USTX format and structure.`;

    // Call OpenRouter API with DeepSeek R1
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'OpenUtau AI Assistant',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-r1', // Using DeepSeek R1 reasoning model
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: aiPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenRouter API error:', errorData);
      return NextResponse.json(
        { error: 'Failed to get AI response' },
        { status: 500 }
      );
    }

    const aiResponse = await response.json();
    const aiMessage = aiResponse.choices?.[0]?.message?.content || 'No response from AI';

    // Try to extract USTX data from AI response if it contains it
    let updatedUSTX: USTXData | undefined;
    let changes: any[] = [];

    // First, try to handle pitch commands directly using pitch utils
    if (ustxData) {
      const pitchModification = parsePitchCommand(message);
      if (pitchModification) {
        try {
          updatedUSTX = modifyPitch(ustxData, pitchModification);
          changes = generateChangeSummary(ustxData, updatedUSTX);
          
          // Override AI message with confirmation
          const result: AIResponse = {
            message: `Applied ${pitchModification.type} modification: ${generatePitchDescription(pitchModification, changes)}`,
            updatedUSTX,
            changes
          };
          return NextResponse.json(result);
        } catch (error) {
          console.error('Error applying pitch modification:', error);
        }
      }
    }

    // If not a direct pitch command, proceed with AI processing
    try {
      // Look for JSON blocks in the AI response
      const jsonMatch = aiMessage.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[1]);
        if (jsonData.name && jsonData.voice_parts) {
          updatedUSTX = jsonData as USTXData;
          
          // Generate change summary
          if (ustxData && updatedUSTX) {
            changes = generateChangeSummary(ustxData, updatedUSTX);
          }
        }
      }
    } catch (error) {
      console.error('Error parsing AI response JSON:', error);
    }

    const result: AIResponse = {
      message: aiMessage,
      updatedUSTX,
      changes
    };

    return NextResponse.json(result);

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateChangeSummary(original: USTXData, updated: USTXData) {
  const changes: any[] = [];

  // Compare basic properties
  if (original.bpm !== updated.bpm) {
    changes.push({
      type: 'timing',
      description: `BPM changed from ${original.bpm} to ${updated.bpm}`,
      oldValue: original.bpm,
      newValue: updated.bpm
    });
  }

  // Compare notes
  const originalNotes = original.voice_parts?.flatMap(part => part.notes || []) || [];
  const updatedNotes = updated.voice_parts?.flatMap(part => part.notes || []) || [];

  originalNotes.forEach((originalNote, index) => {
    const updatedNote = updatedNotes[index];
    if (!updatedNote) return;

    if (originalNote.lyric !== updatedNote.lyric) {
      changes.push({
        type: 'lyrics',
        description: `Note ${index + 1} lyric changed from "${originalNote.lyric}" to "${updatedNote.lyric}"`,
        noteIndex: index,
        oldValue: originalNote.lyric,
        newValue: updatedNote.lyric
      });
    }

    if (originalNote.tone !== updatedNote.tone) {
      changes.push({
        type: 'pitch',
        description: `Note ${index + 1} pitch changed from ${originalNote.tone} to ${updatedNote.tone}`,
        noteIndex: index,
        oldValue: originalNote.tone,
        newValue: updatedNote.tone
      });
    }

    if (originalNote.position !== updatedNote.position) {
      changes.push({
        type: 'timing',
        description: `Note ${index + 1} position changed from ${originalNote.position} to ${updatedNote.position}`,
        noteIndex: index,
        oldValue: originalNote.position,
        newValue: updatedNote.position
      });
    }

    if (originalNote.duration !== updatedNote.duration) {
      changes.push({
        type: 'timing',
        description: `Note ${index + 1} duration changed from ${originalNote.duration} to ${updatedNote.duration}`,
        noteIndex: index,
        oldValue: originalNote.duration,
        newValue: updatedNote.duration
      });
    }
  });

  return changes;
}

function generatePitchDescription(modification: PitchModification, changes: any[]): string {
  const changeCount = changes.filter(c => c.type === 'pitch').length;
  
  switch (modification.type) {
    case 'shift':
      const semitones = Math.round((modification.amount || 0) / 100);
      return `Shifted pitch of ${changeCount} notes by ${semitones} semitones ${modification.verse ? `in verse ${modification.verse}` : ''}`.trim();
    
    case 'curve':
      return `Added ${modification.pattern?.shape || 'linear'} pitch curve to ${changeCount} notes ${modification.verse ? `in verse ${modification.verse}` : ''}`.trim();
    
    case 'vibrato':
      return `Added vibrato (${modification.amount}% depth) to ${changeCount} sustained notes ${modification.verse ? `in verse ${modification.verse}` : ''}`.trim();
    
    case 'transition':
      return `Applied pitch transition across ${changeCount} notes ${modification.verse ? `in verse ${modification.verse}` : ''}`.trim();
    
    default:
      return `Applied pitch modification to ${changeCount} notes`;
  }
}