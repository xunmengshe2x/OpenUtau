import { USTXData, USTXNote, PitchPoint, PitchPointShape, USTXVibrato, USTXPitch } from '@/types/openutau';
import { USTXLyricsManager } from './ustxLyricsUtils';
import { PitchCurve } from '@/components/PitchCurveEditor';

export interface PitchModification {
  type: 'shift' | 'curve' | 'vibrato' | 'transition' | 'reset' | 'unknown' | 'show_panel' | 'combined';
  verse?: number;
  amount?: number; // Cents or semitones
  pattern?: PitchPattern;
  startNoteIndex?: number;
  endNoteIndex?: number;
  error?: string; // For unknown types
  // Combined modification support
  vibrato?: {
    depth: number; // Percentage 5-30%
    period?: number; // Milliseconds
  };
  shift?: {
    amount: number; // Cents ±600 max
  };
}

export interface PitchPattern {
  shape: 'linear' | 'arch' | 'valley' | 'wave' | 'custom';
  intensity: number; // -1200 to +1200 cents
  duration?: 'whole' | 'half' | 'phrase';
  direction?: 'high-to-low' | 'low-to-high';
}

// Identify verse boundaries based on lyrics patterns
export function identifyVerseNotes(ustxData: USTXData, verseNumber: number): { note: USTXNote; globalIndex: number }[] {
  const allNotes: { note: USTXNote; globalIndex: number }[] = [];
  let globalIndex = 0;

  ustxData.voice_parts?.forEach(part => {
    part.notes?.forEach(note => {
      allNotes.push({ note, globalIndex });
      globalIndex++;
    });
  });

  // Simple verse detection - assume verses are separated by longer pauses or repeated patterns
  const verses = detectVerses(allNotes.map(n => n.note));
  
  if (verseNumber > 0 && verseNumber <= verses.length) {
    const verseIndices = verses[verseNumber - 1];
    return allNotes.filter(n => verseIndices.includes(n.globalIndex));
  }

  return [];
}

// Simple verse detection based on note positions and pauses
function detectVerses(notes: USTXNote[]): number[][] {
  const verses: number[][] = [];
  let currentVerse: number[] = [];
  
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const nextNote = notes[i + 1];
    
    currentVerse.push(i);
    
    // Detect verse boundary: large gap in timing or pattern break
    if (nextNote) {
      const gap = nextNote.position - (note.position + note.duration);
      const isLargeGap = gap > 960; // More than 2 quarter notes
      const isPatternBreak = note.lyric === '+' && nextNote.lyric !== '+';
      
      if (isLargeGap || (isPatternBreak && currentVerse.length > 8)) {
        verses.push([...currentVerse]);
        currentVerse = [];
      }
    }
  }
  
  if (currentVerse.length > 0) {
    verses.push(currentVerse);
  }
  
  return verses;
}

// Apply pitch shift to notes (in semitones) with safety bounds
export function applyPitchShift(ustxData: USTXData, modification: PitchModification): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  const targetNotes = modification.verse 
    ? identifyVerseNotes(updatedData, modification.verse)
    : getNotesInRange(updatedData, modification.startNoteIndex, modification.endNoteIndex);

  // Safety constraint: limit individual shift to ±600 cents (6 semitones)
  const maxShiftCents = 600;
  const safeCentsShift = Math.max(-maxShiftCents, Math.min(maxShiftCents, modification.amount || 0));
  const semitoneShift = Math.round(safeCentsShift / 100);
  
  console.log(`Applying pitch shift: ${safeCentsShift} cents (${semitoneShift} semitones) to ${targetNotes.length} notes`);

  targetNotes.forEach(({ note }) => {
    const originalTone = note.tone;
    // Apply shift with bounds checking (MIDI note range 0-127)
    note.tone = Math.max(12, Math.min(115, note.tone + semitoneShift)); // Keep in reasonable singing range
    
    console.log(`  Note shifted: ${originalTone} → ${note.tone} (shift: ${semitoneShift})`);
  });

  return updatedData;
}

// Add pitch curves to notes
export function addPitchCurve(ustxData: USTXData, modification: PitchModification): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  const targetNotes = modification.verse 
    ? identifyVerseNotes(updatedData, modification.verse)
    : getNotesInRange(updatedData, modification.startNoteIndex, modification.endNoteIndex);

  if (!modification.pattern) return updatedData;

  targetNotes.forEach(({ note }, index) => {
    const progress = targetNotes.length > 1 ? index / (targetNotes.length - 1) : 0.5;
    const curvePoints = generatePitchCurve(modification.pattern!, progress, note.duration);
    
    if (!note.pitch) {
      note.pitch = { data: [], snap_first: true };
    }
    
    note.pitch.data = curvePoints;
  });

  return updatedData;
}

// Generate pitch curve points based on pattern
function generatePitchCurve(pattern: PitchPattern, progress: number, noteDuration: number): PitchPoint[] {
  const points: PitchPoint[] = [];
  const intensity = pattern.intensity / 10; // Convert cents to 0.1 semitone units
  
  switch (pattern.shape) {
    case 'linear':
      points.push({ x: -25, y: -intensity * 0.5, shape: PitchPointShape.l });
      points.push({ x: 25, y: intensity * 0.5, shape: PitchPointShape.l });
      break;
      
    case 'arch':
      const archHeight = intensity * Math.sin(progress * Math.PI);
      points.push({ x: -25, y: 0, shape: PitchPointShape.io });
      points.push({ x: 0, y: archHeight, shape: PitchPointShape.io });
      points.push({ x: 25, y: 0, shape: PitchPointShape.io });
      break;
      
    case 'valley':
      const valleyDepth = -intensity * Math.sin(progress * Math.PI);
      points.push({ x: -25, y: 0, shape: PitchPointShape.io });
      points.push({ x: 0, y: valleyDepth, shape: PitchPointShape.io });
      points.push({ x: 25, y: 0, shape: PitchPointShape.io });
      break;
      
    case 'wave':
      for (let i = 0; i < 5; i++) {
        const x = -25 + (i * 12.5);
        const y = intensity * Math.sin(i * Math.PI / 2) * 0.5;
        points.push({ x: x, y: y, shape: PitchPointShape.io });
      }
      break;
      
    default:
      points.push({ x: -25, y: 0, shape: PitchPointShape.io });
      points.push({ x: 25, y: 0, shape: PitchPointShape.io });
  }
  
  return points;
}

// Add vibrato to sustained notes
export function addVibrato(ustxData: USTXData, modification: PitchModification): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  const targetNotes = modification.verse 
    ? identifyVerseNotes(updatedData, modification.verse)
    : getNotesInRange(updatedData, modification.startNoteIndex, modification.endNoteIndex);

  // Safety constraint: limit vibrato depth to 30% max
  const maxVibratoDepth = 30;
  const safeVibratoDepth = Math.min(maxVibratoDepth, Math.abs(modification.amount || 12)); // Default 12% depth
  
  console.log(`Applying vibrato: ${safeVibratoDepth}% depth to ${targetNotes.length} notes`);

  targetNotes.forEach(({ note }) => {
    // Only add vibrato to notes longer than a quarter note
    if (note.duration >= 480) {
      if (!note.vibrato) {
        note.vibrato = {
          length: 75,    // 75% of note duration
          period: 175,   // Vibrato frequency
          depth: safeVibratoDepth,
          in: 10,        // Fade in percentage
          out: 10,       // Fade out percentage
          shift: 0,      // Phase shift
          drift: 0       // Frequency drift
        };
        console.log(`  Added new vibrato to note: ${safeVibratoDepth}% depth`);
      } else {
        const existingDepth = note.vibrato.depth;
        // Instead of replacing, blend with existing vibrato (additive but capped)
        note.vibrato.depth = Math.min(maxVibratoDepth, existingDepth + safeVibratoDepth * 0.5);
        console.log(`  Modified existing vibrato: ${existingDepth}% → ${note.vibrato.depth}%`);
      }
    }
  });

  return updatedData;
}

// Apply pitch transition across a range of notes
export function applyPitchTransition(ustxData: USTXData, modification: PitchModification): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  const targetNotes = modification.verse 
    ? identifyVerseNotes(updatedData, modification.verse)
    : getNotesInRange(updatedData, modification.startNoteIndex, modification.endNoteIndex);

  if (targetNotes.length < 2) return updatedData;

  const transitionAmount = (modification.amount || 400) / 100; // Convert to semitones
  const direction = modification.pattern?.direction || 'high-to-low';
  
  let startShift: number, endShift: number;
  
  if (direction === 'high-to-low') {
    startShift = transitionAmount;   // Start high
    endShift = -transitionAmount;    // End low
  } else {
    startShift = -transitionAmount;  // Start low
    endShift = transitionAmount;     // End high
  }
  
  console.log(`Applying transition: ${direction}, start=${startShift}, end=${endShift}, notes=${targetNotes.length}`);

  targetNotes.forEach(({ note }, index) => {
    const progress = index / (targetNotes.length - 1);
    const shift = startShift + (endShift - startShift) * progress;
    
    const newTone = Math.max(0, Math.min(127, note.tone + Math.round(shift)));
    console.log(`Note ${index + 1}: ${note.tone} → ${newTone} (shift: ${shift.toFixed(1)})`);
    
    note.tone = newTone;
  });

  return updatedData;
}

// Get notes within a specific index range
function getNotesInRange(ustxData: USTXData, startIndex?: number, endIndex?: number): { note: USTXNote; globalIndex: number }[] {
  const allNotes: { note: USTXNote; globalIndex: number }[] = [];
  let globalIndex = 0;

  ustxData.voice_parts?.forEach(part => {
    part.notes?.forEach(note => {
      allNotes.push({ note, globalIndex });
      globalIndex++;
    });
  });

  if (startIndex !== undefined && endIndex !== undefined) {
    return allNotes.filter(n => n.globalIndex >= startIndex && n.globalIndex <= endIndex);
  }

  return allNotes;
}

// Reset pitch modifications to baseline
export function resetPitch(ustxData: USTXData, modification: PitchModification): USTXData {
  const updatedData = JSON.parse(JSON.stringify(ustxData)) as USTXData;
  const targetNotes = modification.verse 
    ? identifyVerseNotes(updatedData, modification.verse)
    : getNotesInRange(updatedData, modification.startNoteIndex, modification.endNoteIndex);

  console.log(`Resetting pitch for ${targetNotes.length} notes`);

  targetNotes.forEach(({ note }) => {
    // Reset pitch data to baseline
    if (note.pitch) {
      // Clear pitch points but keep basic structure
      note.pitch.data = [];
    }
    
    // Reset vibrato
    if (note.vibrato) {
      note.vibrato.length = 0;
      note.vibrato.period = 0;
      note.vibrato.depth = 0;
      note.vibrato.in = 0;
      note.vibrato.out = 0;
      note.vibrato.shift = 0;
      note.vibrato.drift = 0;
    }
    
    // Note: We don't reset note.tone as that's the base pitch the user set
    // We only reset the modulations/variations
  });

  return updatedData;
}

// Apply combined pitch modifications (shift + vibrato)
export function applyCombinedModification(ustxData: USTXData, modification: PitchModification): USTXData {
  let result = ustxData;
  
  console.log(`🎵 Applying combined modification: shift=${modification.shift?.amount}cents, vibrato=${modification.vibrato?.depth}%`);
  
  // Apply pitch shift first
  if (modification.shift?.amount) {
    const shiftMod: PitchModification = {
      type: 'shift',
      verse: modification.verse,
      amount: modification.shift.amount,
      startNoteIndex: modification.startNoteIndex,
      endNoteIndex: modification.endNoteIndex
    };
    result = applyPitchShift(result, shiftMod);
  }
  
  // Then apply vibrato
  if (modification.vibrato?.depth) {
    const vibratoMod: PitchModification = {
      type: 'vibrato',
      verse: modification.verse,
      amount: modification.vibrato.depth,
      startNoteIndex: modification.startNoteIndex,
      endNoteIndex: modification.endNoteIndex
    };
    result = addVibrato(result, vibratoMod);
  }
  
  return result;
}

// Main pitch modification function
export function modifyPitch(ustxData: USTXData, modification: PitchModification): USTXData {
  switch (modification.type) {
    case 'shift':
      return applyPitchShift(ustxData, modification);
    case 'curve':
      return addPitchCurve(ustxData, modification);
    case 'vibrato':
      return addVibrato(ustxData, modification);
    case 'transition':
      return applyPitchTransition(ustxData, modification);
    case 'reset':
      return resetPitch(ustxData, modification);
    case 'combined':
      return applyCombinedModification(ustxData, modification);
    default:
      return ustxData;
  }
}

// AI-powered pitch command parsing
async function parsePitchCommandWithAI(command: string): Promise<PitchModification | null> {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY || "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";
    
    const schema = {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["shift", "curve", "vibrato", "transition", "show_panel"],
          description: "Type of pitch modification. Use 'show_panel' for requests to show/open/display pitch controls."
        },
        verse: {
          type: "number",
          description: "Verse number (1-based) to apply modification to. Extract from 'first/1st', 'second/2nd', 'third/3rd', or 'verse X'"
        },
        amount: {
          type: "number",
          description: "Amount in cents. Default: 300 for shift/transition, 40 for vibrato. Use 200-600 for normal pitch changes, 600+ for dramatic changes."
        },
        pattern: {
          type: "object",
          properties: {
            shape: {
              type: "string", 
              enum: ["linear", "arch", "valley", "wave"],
              description: "Curve shape for transitions/curves. Use 'linear' for gradual transitions."
            },
            intensity: {
              type: "number",
              description: "Intensity in cents, typically same as amount"
            },
            direction: {
              type: "string",
              enum: ["high-to-low", "low-to-high"],
              description: "Direction for transitions: 'high-to-low' for lowering pitch over time, 'low-to-high' for raising pitch over time"
            }
          }
        }
      },
      required: ["type"]
    };

    const prompt = `Analyze this pitch modification command and return a JSON object matching the schema.

Command: "${command}"

PITCH MODIFICATION TYPES:
1. "shift" - Uniform pitch change (all notes shifted by same amount)
   - Examples: "make verse 1 higher", "raise pitch by 3 semitones", "lower the melody"

2. "transition" - Gradual pitch change across notes in sequence
   - Examples: "transition from high to low", "start high and end low", "gradually increase pitch"

3. "curve" - Add pitch bends/curves to individual notes (IMPORTANT: any mention of "curve", "bend", "arch", "wave" should be curve type)
   - Examples: "add pitch curves", "bend the notes", "arch-shaped pitch", "nice high curve", "curve for it", "with curves"

4. "vibrato" - Add vibrato to sustained notes
   - Examples: "add vibrato", "make it more expressive"

CRITICAL: If the command mentions BOTH "higher/lower" AND "curve/bend/arch", prioritize CURVE type, not shift!

SPECIAL CASES:
- If user says "show me", "open", "display" + "pitch control/panel", return type "show_panel"
- If command is unclear or requests UI access, return type "show_panel" instead of "unknown"

DIRECTION MAPPING:
- "high to low", "start high end low", "descending" → "high-to-low"
- "low to high", "start low end high", "ascending" → "low-to-high"
- "high to higher", "even higher", "more high" → "low-to-high" (starts lower, goes higher)
- "low to lower", "even lower", "more low" → "high-to-low" (starts higher, goes lower)

VERSE DETECTION:
- "first verse", "1st verse", "verse 1" → verse: 1
- "second verse", "2nd verse", "verse 2" → verse: 2
- etc.

AMOUNT GUIDELINES:
- Subtle: 100-200 cents
- Normal: 200-400 cents  
- Noticeable: 400-600 cents
- Dramatic: 600+ cents
- Convert semitones to cents: 1 semitone = 100 cents

Return ONLY the JSON object, no explanation:`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "anthropic/claude-3.5-sonnet",
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.1 // Low temperature for consistent parsing
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI pitch parsing request failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content?.trim();
    
    if (!result) {
      console.error('No response from AI pitch parser. Full response:', JSON.stringify(data, null, 2));
      return null;
    }

    console.log('AI raw response:', result);

    // Parse the JSON response
    let parsed;
    try {
      // Extract JSON if wrapped in markdown
      const jsonMatch = result.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : result;
      parsed = JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse AI response as JSON:', result, error);
      return null;
    }

    // Validate and return
    if (parsed && typeof parsed === 'object' && parsed.type) {
      console.log('✅ AI parsed pitch command:', parsed);
      return parsed as PitchModification;
    } else {
      console.error('Invalid AI parsing result:', parsed);
      return null;
    }
    
  } catch (error) {
    console.error('AI pitch parsing failed:', error);
    return null;
  }
}

// Convert user-friendly commands to pitch modifications (with AI fallback)
export async function parsePitchCommand(command: string): Promise<PitchModification | null> {
  console.log('Parsing pitch command:', command);

  // Try AI parsing first for better flexibility
  const aiResult = await parsePitchCommandWithAI(command);
  if (aiResult) {
    console.log('✅ AI parsing successful:', aiResult);
    return aiResult;
  }

  // Fallback to original regex-based parsing
  console.log('⚠️ AI parsing failed, falling back to regex parsing');
  return parsePitchCommandLegacy(command);
}

// Original regex-based parsing (renamed as legacy fallback)
function parsePitchCommandLegacy(command: string): PitchModification | null {
  const lowerCmd = command.toLowerCase();
  
  console.log('Parsing pitch command:', command);
  
  // Extract verse number (first, second, third, or verse X)
  const verseMatch = lowerCmd.match(/(?:verse\s+(\d+)|(first|second|third|1st|2nd|3rd)\s+verse)/);
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
  
  // Extract intensity indicators
  const intensityMatch = lowerCmd.match(/(?:much|very|really|extremely|slightly|little|bit)/);
  const intensityMultiplier = intensityMatch ? 
    (['much', 'very', 'really', 'extremely'].includes(intensityMatch[0]) ? 2.0 : 0.5) : 1.0;
  
  // Extract specific amounts
  const amountMatch = lowerCmd.match(/(\d+)\s*(cent|semitone|tone|octave)/);
  let amount = 300; // Default 3 semitones
  if (amountMatch) {
    const value = parseInt(amountMatch[1]);
    const unit = amountMatch[2];
    if (unit.includes('octave')) amount = value * 1200;
    else if (unit.includes('semi') || unit.includes('tone')) amount = value * 100;
    else amount = value; // cents
  } else {
    amount = Math.round(300 * intensityMultiplier);
  }
  
  console.log('Extracted:', { verseNumber, intensityMultiplier, amount });
  
  // Check for TRANSITION patterns first (more complex)
  const transitionPatterns = [
    // Start high, end low patterns
    /\b(start|beginning).*\b(high|higher).*\b(end|finish).*\b(low|lower|reduce)/i,
    /\bhigh.*\b(start|beginning).*\b(low|lower|reduce).*\b(end|finish)/i,
    
    // Start low, end high patterns  
    /\b(start|beginning).*\b(low|lower).*\b(end|finish).*\b(high|higher)/i,
    /\blow.*\b(start|beginning).*\bhigh.*\b(end|finish)/i,
    
    // IMPROVED: More flexible transition patterns
    /\btransition.*\b(high.*low|low.*high|high.*higher|low.*lower)/i,
    /\b(high.*to.*low|low.*to.*high|high.*to.*higher|low.*to.*lower)/i,
    /\bfrom.*high.*to.*low/i,
    /\bfrom.*low.*to.*high/i,
    /\bfrom.*high.*to.*higher/i,
    /\bfrom.*low.*to.*lower/i,
    /\b(first|verse).*high.*low/i,
    /\b(first|verse).*low.*high/i,
    /\b(first|verse).*high.*higher/i,
    /\b(first|verse).*low.*lower/i,
    
    // Start/end progressive patterns (key addition for your command)
    /\b(start|beginning).*\bhigh(er)?.*\b(end|towards).*\b(much|very|really).*\bhigh(er)?/i,
    /\bhigh(er)?.*\b(start|beginning).*\b(much|very|really).*\bhigh(er)?.*\b(end|towards)/i,
    /\b(start|beginning).*\blow(er)?.*\b(end|towards).*\b(much|very|really).*\blow(er)?/i,
    /\blow(er)?.*\b(start|beginning).*\b(much|very|really).*\blow(er)?.*\b(end|towards)/i,
    
    // Progressive intensity patterns
    /\bhigh(er)?.*\bthen.*\b(much|very|really).*\bhigh(er)?/i,
    /\blow(er)?.*\bthen.*\b(much|very|really).*\blow(er)?/i,
    /\bhigh(er)?.*\bgo.*\b(much|very|really).*\bhigh(er)?/i,
    /\blow(er)?.*\bgo.*\b(much|very|really).*\blow(er)?/i,
    
    // More natural language patterns
    /\bstart.*high.*then.*\b(reduce|lower|down)/i,
    /\bbegin.*high.*then.*\b(reduce|lower|down)/i,
    /\bhigh.*\b(start|beginning).*then.*\b(reduce|lower|down)/i,
    /\bstart.*low.*then.*\b(higher|up|increase)/i,
    /\bbegin.*low.*then.*\b(higher|up|increase)/i,
    
    // Sequence patterns
    /\bhigh.*then.*low/i,
    /\blow.*then.*high/i,
    /\brise.*then.*fall/i,
    /\bfall.*then.*rise/i,
    
    // Gradual change patterns
    /\bgradual.*\b(increase|decrease)/i,
    /\bslowly.*\b(higher|lower)/i,
    /\btransition.*\b(up|down|higher|lower)/i,
    
    // Flexible "start/end" patterns that allow more words in between
    /\bstart.*high.*reduce.*\b(end|significantly)/i,
    /\bbeginning.*high.*lower.*end/i,
    /\bhigh.*start.*low.*end/i,
    
    // Progression patterns with "go" keyword
    /\b(start|beginning).*\bpitch.*\bgo.*\b(higher|lower|up|down)/i,
    /\bpitch.*\b(start|beginning).*\bgo.*\b(higher|lower|up|down)/i
  ];
  
  const isTransition = transitionPatterns.some(pattern => pattern.test(lowerCmd));
  
  if (isTransition) {
    console.log('→ Detected TRANSITION pattern');
    
    // Determine direction: does it go high→low, low→high, high→higher, or low→lower?
    const highToLowPatterns = [
      /\b(start|beginning).*\b(high|higher).*\b(end|finish).*\b(low|lower|reduce)/i,
      /\bhigh.*\b(start|beginning).*\b(low|lower|reduce).*\b(end|finish)/i,
      /\bstart.*high.*then.*\b(reduce|lower|down)/i,
      /\bbegin.*high.*then.*\b(reduce|lower|down)/i,
      /\bhigh.*\b(start|beginning).*then.*\b(reduce|lower|down)/i,
      /\bhigh.*then.*low/i,
      /\brise.*then.*fall/i,
      /\bgradual.*decrease/i,
      /\bslowly.*lower/i,
      /\bstart.*high.*reduce.*\b(end|significantly)/i,
      /\bhigh.*start.*low.*end/i,
      
      // IMPROVED: Better high-to-low detection patterns
      /\bhigh.*to.*low/i,
      /\bfrom.*high.*to.*low/i,
      /\b(first|verse).*high.*low/i,
      /\btransition.*high.*low/i,
      /\bhigh.*pitch.*to.*low.*pitch/i
    ];

    const lowToHighPatterns = [
      /\b(start|beginning).*\b(low|lower).*\b(end|finish).*\b(high|higher)/i,
      /\blow.*\b(start|beginning).*\bhigh.*\b(end|finish)/i,
      /\bstart.*low.*then.*\b(higher|up|increase)/i,
      /\bbegin.*low.*then.*\b(higher|up|increase)/i,
      /\blow.*then.*high/i,
      /\bfall.*then.*rise/i,
      /\bgradual.*increase/i,
      /\bslowly.*higher/i,
      
      // IMPROVED: Better low-to-high detection patterns
      /\blow.*to.*high/i,
      /\bfrom.*low.*to.*high/i,
      /\b(first|verse).*low.*high/i,
      /\btransition.*low.*high/i,
      /\blow.*pitch.*to.*high.*pitch/i
    ];

    const highToHigherPatterns = [
      /\bhigh.*to.*higher/i,
      /\bhigh.*to.*even.*higher/i,
      /\bfrom.*high.*to.*higher/i,
      /\b(first|verse).*high.*higher/i,
      /\btransition.*high.*higher/i,
      /\bhigh.*pitch.*to.*higher.*pitch/i,
      /\bhigh.*pitch.*to.*even.*higher/i
    ];

    const lowToLowerPatterns = [
      /\blow.*to.*lower/i,
      /\blow.*to.*even.*lower/i,
      /\bfrom.*low.*to.*lower/i,
      /\b(first|verse).*low.*lower/i,
      /\btransition.*low.*lower/i,
      /\blow.*pitch.*to.*lower.*pitch/i,
      /\blow.*pitch.*to.*even.*lower/i
    ];
    
    const isHighToLow = highToLowPatterns.some(pattern => pattern.test(lowerCmd));
    const isLowToHigh = lowToHighPatterns.some(pattern => pattern.test(lowerCmd));
    const isHighToHigher = highToHigherPatterns.some(pattern => pattern.test(lowerCmd));
    const isLowToLower = lowToLowerPatterns.some(pattern => pattern.test(lowerCmd));

    // Determine the final direction
    let direction: 'high-to-low' | 'low-to-high';
    if (isHighToLow) {
      direction = 'high-to-low';
    } else if (isLowToHigh) {
      direction = 'low-to-high';  
    } else if (isHighToHigher) {
      direction = 'low-to-high'; // Start lower, go higher
    } else if (isLowToLower) {
      direction = 'high-to-low'; // Start higher, go lower  
    } else {
      // Fallback to original logic
      direction = highToLowPatterns.some(pattern => pattern.test(lowerCmd)) ? 'high-to-low' : 'low-to-high';
    }
    
    const transitionAmount = Math.round(amount * intensityMultiplier);
    
    return {
      type: 'transition',
      verse: verseNumber,
      amount: transitionAmount,
      pattern: {
        shape: 'linear',
        intensity: transitionAmount,
        direction: direction
      }
    };
  }
  
  // CHECK FOR CURVES FIRST (before pitch shifts) to handle "higher with curve" cases
  // Pitch curve patterns - ENHANCED to catch more cases
  if (lowerCmd.includes('sweep') || lowerCmd.includes('curve') || lowerCmd.includes('arch') || 
      lowerCmd.includes('bend') || lowerCmd.includes('wave') || lowerCmd.includes('valley') ||
      (lowerCmd.includes('upward') && !lowerCmd.includes('raise')) ||
      (lowerCmd.includes('curve') && lowerCmd.includes('for it'))) {
    
    const shape = lowerCmd.includes('arch') ? 'arch' : 
                  lowerCmd.includes('valley') ? 'valley' : 
                  lowerCmd.includes('wave') ? 'wave' : 'linear';
    
    // Extract intensity based on descriptors
    let intensity = 400;
    if (lowerCmd.includes('much')) intensity = 600;
    if (lowerCmd.includes('subtle')) intensity = 200;
    if (lowerCmd.includes('dramatic')) intensity = 800;
    if (lowerCmd.includes('high') && lowerCmd.includes('curve')) intensity = 500;
    
    console.log('→ Detected CURVE pattern:', shape, 'intensity:', intensity);
    return {
      type: 'curve',
      verse: verseNumber,
      pattern: {
        shape: shape as any,
        intensity: intensity
      }
    };
  }
  
  // Pitch shift patterns - ONLY if no curve detected
  if (lowerCmd.includes('higher') || lowerCmd.includes('raise') || lowerCmd.includes('up') || 
      lowerCmd.includes('increase') || lowerCmd.match(/\bhigh(er)?\s+pitch/) ||
      lowerCmd.match(/pitch.*higher/) || lowerCmd.match(/sound.*higher/)) {
    
    console.log('→ Detected SHIFT UP pattern');
    return {
      type: 'shift',
      verse: verseNumber,
      amount: amount
    };
  }
  
  if (lowerCmd.includes('lower') || lowerCmd.includes('decrease') || lowerCmd.includes('down') ||
      lowerCmd.match(/\blow(er)?\s+pitch/) || lowerCmd.match(/pitch.*lower/) || 
      lowerCmd.match(/sound.*lower/) || lowerCmd.match(/have.*lower/)) {
    
    console.log('→ Detected SHIFT DOWN pattern');
    return {
      type: 'shift',
      verse: verseNumber,
      amount: -amount // Negative for lowering
    };
  }
  
  
  // Vibrato patterns  
  if (lowerCmd.includes('vibrato')) {
    const depthMatch = lowerCmd.match(/(\d+)%/);
    
    console.log('→ Detected VIBRATO pattern');
    return {
      type: 'vibrato',
      verse: verseNumber,
      amount: depthMatch ? parseInt(depthMatch[1]) : 40
    };
  }
  
  // Transition patterns
  if (lowerCmd.includes('transition') || lowerCmd.includes('high-low') || lowerCmd.includes('low-high')) {
    console.log('→ Detected TRANSITION pattern');
    return {
      type: 'transition',
      verse: verseNumber,
      amount: 400,
      pattern: {
        shape: 'linear',
        intensity: 400
      }
    };
  }
  
  // If we detected pitch in the detection function but couldn't parse it specifically,
  // assume it's a basic pitch shift
  if (lowerCmd.includes('pitch')) {
    console.log('→ Fallback: Generic pitch shift');
    return {
      type: 'shift', 
      verse: verseNumber,
      amount: lowerCmd.includes('much') ? 500 : 300
    };
  }
  
  console.log('→ Could not parse pitch command');
  return null;
}

// NEW: Verse-specific pitch data extraction and management

export interface VerseNoteData {
  noteIndex: number;
  note: USTXNote;
  globalNoteIndex: number; // Index across all notes in project
  partIndex: number;
  noteIndexInPart: number;
}

export interface VersePitchData {
  verseNumber: number;
  notes: VerseNoteData[];
  pitchCurves: PitchCurve[];
  baseTone: number; // Average tone for the verse
  timeRange: {
    startMs: number;
    endMs: number;
    durationMs: number;
  };
}

export class VersePitchExtractor {
  private ustxData: USTXData;
  private lyricsManager: USTXLyricsManager;

  constructor(ustxData: USTXData) {
    this.ustxData = ustxData;
    this.lyricsManager = new USTXLyricsManager(ustxData);
  }

  /**
   * Extract pitch data for a specific verse
   */
  extractVersePitchData(verseNumber: number): VersePitchData | null {
    const verses = this.lyricsManager.detectVerses();
    const verse = verses.find(v => v.verseNumber === verseNumber);
    
    if (!verse) {
      console.warn(`Verse ${verseNumber} not found`);
      return null;
    }

    // Get the vocal part
    const vocalPart = this.getVocalPart();
    if (!vocalPart?.notes) {
      console.warn('No vocal part found');
      return null;
    }

    // Get lyrical notes (excluding extension syllables)
    const lyricalNotes = vocalPart.notes.filter(note => 
      note.lyric && note.lyric.trim() !== '' && !note.lyric.startsWith('+')
    );

    // Get notes for this verse
    const verseNotes = lyricalNotes.slice(verse.startNoteIndex, verse.endNoteIndex + 1);
    
    // Calculate timing information
    const bpm = this.ustxData.bpm || 120;
    const resolution = this.ustxData.resolution || 480;
    const msPerTick = (60 * 1000) / (bpm * resolution);
    
    const startMs = verseNotes[0]?.position * msPerTick || 0;
    const lastNote = verseNotes[verseNotes.length - 1];
    const endMs = lastNote ? (lastNote.position + lastNote.duration) * msPerTick : startMs;

    // Create note data with indices
    const noteData: VerseNoteData[] = verseNotes.map((note, index) => {
      const globalIndex = lyricalNotes.indexOf(note);
      const partIndex = this.ustxData.voice_parts?.findIndex(part => part === vocalPart) || 0;
      const noteIndexInPart = vocalPart.notes?.indexOf(note) || 0;

      return {
        noteIndex: index,
        note: note,
        globalNoteIndex: globalIndex,
        partIndex,
        noteIndexInPart
      };
    });

    // Extract pitch curves from notes
    const pitchCurves = this.extractPitchCurves(noteData, startMs, endMs, msPerTick);

    // Calculate base tone (average)
    const baseTone = Math.round(
      verseNotes.reduce((sum, note) => sum + note.tone, 0) / verseNotes.length
    );

    return {
      verseNumber,
      notes: noteData,
      pitchCurves,
      baseTone,
      timeRange: {
        startMs,
        endMs,
        durationMs: endMs - startMs
      }
    };
  }

  /**
   * Convert USTX pitch data to PitchCurve format
   */
  private extractPitchCurves(
    noteData: VerseNoteData[], 
    verseStartMs: number, 
    verseEndMs: number,
    msPerTick: number
  ): PitchCurve[] {
    const curves: PitchCurve[] = [];

    noteData.forEach((noteInfo, index) => {
      const note = noteInfo.note;
      const noteStartMs = note.position * msPerTick;
      const noteDurationMs = note.duration * msPerTick;
      const noteEndMs = noteStartMs + noteDurationMs;

      // Convert note position to relative position within verse (0-100%)
      const noteStartPercent = ((noteStartMs - verseStartMs) / (verseEndMs - verseStartMs)) * 100;
      const noteEndPercent = ((noteEndMs - verseStartMs) / (verseEndMs - verseStartMs)) * 100;

      // Extract pitch bend data if present
      if (note.pitch?.data && note.pitch.data.length > 0) {
        const points = note.pitch.data.map(pitchPoint => ({
          x: noteStartPercent + ((pitchPoint.x / noteDurationMs) * (noteEndPercent - noteStartPercent)),
          y: pitchPoint.y * 10 // Convert from 0.1 semitones to cents
        }));

        curves.push({
          id: `note-${noteInfo.globalNoteIndex}`,
          name: `${note.lyric} (Note ${index + 1})`,
          points,
          color: this.getNoteColor(note.tone),
          noteIndex: noteInfo.globalNoteIndex,
          shape: 'custom' as const
        });
      } else {
        // Create a flat curve for notes without pitch data
        curves.push({
          id: `note-${noteInfo.globalNoteIndex}`,
          name: `${note.lyric} (Note ${index + 1})`,
          points: [
            { x: noteStartPercent, y: 0 },
            { x: noteEndPercent, y: 0 }
          ],
          color: this.getNoteColor(note.tone),
          noteIndex: noteInfo.globalNoteIndex,
          shape: 'linear' as const
        });
      }

      // Add vibrato curve if present
      if (note.vibrato && (note.vibrato.depth > 0 || note.vibrato.length > 0)) {
        const vibratoCurve = this.createVibratoCurve(
          note.vibrato, 
          noteStartPercent, 
          noteEndPercent, 
          noteInfo.globalNoteIndex
        );
        if (vibratoCurve) {
          curves.push(vibratoCurve);
        }
      }
    });

    return curves;
  }

  /**
   * Create a vibrato curve representation
   */
  private createVibratoCurve(
    vibrato: USTXVibrato, 
    noteStart: number, 
    noteEnd: number, 
    noteIndex: number
  ): PitchCurve | null {
    if (vibrato.length === 0 || vibrato.depth === 0) return null;

    const noteWidth = noteEnd - noteStart;
    const vibratoStart = noteStart + (noteWidth * (100 - vibrato.length) / 100);
    const vibratoEnd = noteEnd;
    
    // Create a simple sine wave representation of vibrato
    const points = [];
    const numPoints = 20;
    const period = vibrato.period || 175; // Default period
    const depth = vibrato.depth; // In cents
    
    for (let i = 0; i <= numPoints; i++) {
      const x = vibratoStart + (vibratoEnd - vibratoStart) * (i / numPoints);
      const phase = (i / numPoints) * 2 * Math.PI * (noteWidth / period * 1000); // Approximate
      const y = Math.sin(phase + (vibrato.shift || 0) * Math.PI / 180) * depth;
      points.push({ x, y });
    }

    return {
      id: `vibrato-${noteIndex}`,
      name: `Vibrato (Note ${noteIndex + 1})`,
      points,
      color: '#ff6b9d', // Pink for vibrato
      noteIndex,
      isVibrato: true,
      shape: 'wave' as const
    };
  }

  /**
   * Get color based on note tone
   */
  private getNoteColor(tone: number): string {
    // Color based on pitch height
    const hue = ((tone - 60) % 12) * 30; // Different hue for each semitone
    const saturation = Math.min(100, Math.max(50, (tone - 60) * 2 + 70));
    return `hsl(${hue}, ${saturation}%, 60%)`;
  }

  /**
   * Apply modified pitch curves back to USTX data
   */
  applyPitchCurves(verseNumber: number, curves: PitchCurve[]): USTXData {
    const versePitchData = this.extractVersePitchData(verseNumber);
    if (!versePitchData) {
      console.warn(`Cannot apply pitch curves: verse ${verseNumber} not found`);
      return this.ustxData;
    }

    const updatedData = JSON.parse(JSON.stringify(this.ustxData)) as USTXData;
    const vocalPart = this.getVocalPart(updatedData);
    if (!vocalPart) return updatedData;

    // Apply each curve to its corresponding note
    curves.forEach(curve => {
      if (curve.isVibrato) {
        this.applyVibratoCurve(curve, versePitchData, vocalPart);
      } else {
        this.applyPitchCurve(curve, versePitchData, vocalPart);
      }
    });

    return updatedData;
  }

  /**
   * Apply a pitch curve to a specific note
   */
  private applyPitchCurve(
    curve: PitchCurve, 
    versePitchData: VersePitchData, 
    vocalPart: any
  ) {
    const noteData = versePitchData.notes.find(n => n.globalNoteIndex === curve.noteIndex);
    if (!noteData) return;

    const note = vocalPart.notes[noteData.noteIndexInPart];
    if (!note) return;

    // Convert curve points back to USTX format
    const bpm = this.ustxData.bpm || 120;
    const resolution = this.ustxData.resolution || 480;
    const msPerTick = (60 * 1000) / (bpm * resolution);
    
    const noteDurationMs = note.duration * msPerTick;
    const verseDurationMs = versePitchData.timeRange.durationMs;
    
    const pitchPoints: PitchPoint[] = curve.points.map(point => {
      // Convert back from verse-relative percentage to note-relative milliseconds
      const verseRelativeMs = (point.x / 100) * verseDurationMs;
      const noteRelativeMs = verseRelativeMs - (noteData.note.position * msPerTick - versePitchData.timeRange.startMs);
      
      return {
        x: Math.max(0, Math.min(noteDurationMs, noteRelativeMs)),
        y: point.y / 10, // Convert from cents back to 0.1 semitones
        shape: PitchPointShape.io // Default shape
      };
    });

    // Update the note's pitch data
    note.pitch = {
      data: pitchPoints,
      snap_first: true
    };
  }

  /**
   * Apply vibrato curve to a note
   */
  private applyVibratoCurve(
    curve: PitchCurve, 
    versePitchData: VersePitchData, 
    vocalPart: any
  ) {
    const noteData = versePitchData.notes.find(n => n.globalNoteIndex === curve.noteIndex);
    if (!noteData) return;

    const note = vocalPart.notes[noteData.noteIndexInPart];
    if (!note) return;

    // Extract vibrato parameters from curve
    const maxDepth = Math.max(...curve.points.map(p => Math.abs(p.y)));
    const length = 75; // Default vibrato length percentage
    
    note.vibrato = {
      length,
      period: 175, // Default period
      depth: Math.round(maxDepth),
      in: 10,
      out: 10,
      shift: 0,
      drift: 0
    };
  }

  /**
   * Get the vocal part from USTX data
   */
  private getVocalPart(data: USTXData = this.ustxData) {
    return data.voice_parts?.find(part => 
      part.notes && part.notes.some(note => note.lyric && note.lyric.trim() !== '')
    );
  }

  /**
   * Get all available verses with their numbers
   */
  getAvailableVerses(): Array<{number: number, lyrics: string, noteCount: number}> {
    const verses = this.lyricsManager.detectVerses();
    return verses.map(verse => ({
      number: verse.verseNumber,
      lyrics: verse.lyrics.substring(0, 50) + (verse.lyrics.length > 50 ? '...' : ''),
      noteCount: verse.endNoteIndex - verse.startNoteIndex + 1
    }));
  }
}