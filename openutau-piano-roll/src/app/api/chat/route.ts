import { NextRequest } from 'next/server';

// Check if the request is a simple correction vs full transformation
function isSimpleCorrectionRequest(theme: string, currentLyrics: string): boolean {
  // Check for simple word replacement patterns
  const simpleReplacementPatterns = [
    /^change\s+(\w+)\s+to\s+(\w+)$/i,           // "change starfields to starlight"
    /^replace\s+(\w+)\s+with\s+(\w+)$/i,        // "replace starfields with starlight"
    /^make\s+(\w+\s+\w+)\s+one\s+word$/i,       // "make sky ways one word"
    /^fix\s+spelling/i,                         // "fix spelling"
    /^correct.*to/i,                            // "correct X to Y"
    /should\s+be\s+(\w+)/i                      // "should be starlight"
  ];
  
  // Check if the theme matches any simple replacement pattern
  const isSimplePattern = simpleReplacementPatterns.some(pattern => pattern.test(theme.trim()));
  
  // Additional check: if the "theme" contains a word that exists in current lyrics,
  // it's likely a correction rather than a theme change
  if (!isSimplePattern) {
    const words = currentLyrics.toLowerCase().split(/\s+/);
    const themeWords = theme.toLowerCase().split(/\s+/);
    const hasExistingWord = themeWords.some(word => words.includes(word));
    
    // If theme is very short and contains existing words, likely a correction
    if (themeWords.length <= 4 && hasExistingWord) {
      console.log('Detected likely correction based on existing words:', { theme, hasExistingWord });
      return true;
    }
  }
  
  return isSimplePattern;
}

// Apply simple corrections like "change starfields to starlight"
function applySimpleCorrection(currentLyrics: string, correctionRequest: string): string {
  console.log('Applying simple correction:', { currentLyrics, correctionRequest });
  
  // Handle "change X to Y" pattern
  const changeMatch = correctionRequest.match(/^change\s+(\w+)\s+to\s+(\w+)$/i);
  if (changeMatch) {
    const [, oldWord, newWord] = changeMatch;
    console.log('Change pattern detected:', { oldWord, newWord });
    return currentLyrics.replace(new RegExp(`\\b${oldWord}\\b`, 'gi'), newWord);
  }
  
  // Handle "replace X with Y" pattern
  const replaceMatch = correctionRequest.match(/^replace\s+(\w+)\s+with\s+(\w+)$/i);
  if (replaceMatch) {
    const [, oldWord, newWord] = replaceMatch;
    console.log('Replace pattern detected:', { oldWord, newWord });
    return currentLyrics.replace(new RegExp(`\\b${oldWord}\\b`, 'gi'), newWord);
  }
  
  // Handle "make X one word" - combine two words into one
  const makeOneWordMatch = correctionRequest.match(/^make\s+(.+)\s+one\s+word$/i);
  if (makeOneWordMatch) {
    const targetPhrase = makeOneWordMatch[1];
    console.log('Make one word pattern detected:', { targetPhrase });
    // Replace spaces in the target phrase
    const combinedWord = targetPhrase.replace(/\s+/g, '');
    return currentLyrics.replace(new RegExp(`\\b${targetPhrase}\\b`, 'gi'), combinedWord);
  }
  
  // Handle "should be X" pattern
  const shouldBeMatch = correctionRequest.match(/should\s+be\s+(\w+)/i);
  if (shouldBeMatch) {
    const newWord = shouldBeMatch[1];
    console.log('Should be pattern detected:', { newWord });
    // Try to find what word to replace based on context
    const words = currentLyrics.split(' ');
    // Look for similar length words or recently mentioned words
    for (let i = 0; i < words.length; i++) {
      if (words[i].length === newWord.length || correctionRequest.toLowerCase().includes(words[i].toLowerCase())) {
        const oldWord = words[i];
        return currentLyrics.replace(new RegExp(`\\b${oldWord}\\b`, 'gi'), newWord);
      }
    }
  }
  
  // Fallback: return original if no pattern matches
  console.log('No correction pattern matched, returning original');
  return currentLyrics;
}

// Count syllables in a word (simple heuristic)
function countSyllables(word: string): number {
  if (!word) return 0;
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleanWord.length === 0) return 0;
  
  // Simple syllable counting heuristic
  const vowelGroups = cleanWord.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;
  
  // Adjust for silent e
  if (cleanWord.endsWith('e') && count > 1) count--;
  
  // Minimum of 1 syllable
  return Math.max(1, count);
}

// Validate if new lyrics match original structure
function validateLyricsStructure(originalLyrics: string, newLyrics: string): {
  isValid: boolean;
  errors: string[];
  details: any;
} {
  const originalWords = originalLyrics.split(' ');
  const newWords = newLyrics.split(' ');
  const errors: string[] = [];
  
  // Check word count
  if (originalWords.length !== newWords.length) {
    errors.push(`Word count mismatch: original has ${originalWords.length} words, new has ${newWords.length} words`);
  }
  
  // Check syllable structure
  const originalSyllables = originalWords.map(word => ({ word, syllables: countSyllables(word) }));
  const newSyllables = newWords.map(word => ({ word, syllables: countSyllables(word) }));
  
  const syllableMismatches: string[] = [];
  for (let i = 0; i < Math.min(originalWords.length, newWords.length); i++) {
    if (originalWords[i] === '+') {
      if (newWords[i] !== '+') {
        errors.push(`Position ${i + 1}: '+' symbol not preserved`);
      }
    } else if (originalSyllables[i].syllables !== newSyllables[i].syllables) {
      syllableMismatches.push(
        `Position ${i + 1}: "${originalWords[i]}" (${originalSyllables[i].syllables} syl) → "${newWords[i]}" (${newSyllables[i].syllables} syl)`
      );
    }
  }
  
  if (syllableMismatches.length > 0) {
    errors.push(`Syllable mismatches: ${syllableMismatches.join(', ')}`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    details: {
      originalWords: originalSyllables,
      newWords: newSyllables,
      wordCountMatch: originalWords.length === newWords.length,
      syllableMatches: syllableMismatches.length === 0
    }
  };
}

// Use AI to generate lyrics for theme with chat history context and validation
async function generateLyricsWithAI(prompt: string, apiKey: string, chatHistory: any[] = [], maxRetries: number = 3, originalLyrics?: string): Promise<string> {
  let attempt = 0;
  let lastResult = '';
  let lastErrors: string[] = [];

  while (attempt < maxRetries) {
    attempt++;
    console.log(`Lyrics generation attempt ${attempt}/${maxRetries}`);

    try {
      // Build retry-specific prompt
      let enhancedPrompt = prompt;
      if (attempt > 1 && originalLyrics) {
        enhancedPrompt += `\n\nPREVIOUS ATTEMPT FAILED with errors: ${lastErrors.join(', ')}\nPrevious result: "${lastResult}"\n\nFIX THESE ERRORS and try again with PERFECT syllable matching.`;
      }

      // Build messages with chat history for context
      const messages = [
        {
          role: 'system',
          content: 'You are a creative lyricist working on song lyrics. Generate lyrics that maintain rhythm, rhyme, and are suitable for singing. CRITICAL: You must match syllable counts EXACTLY. Return only the lyrics, nothing else.'
        },
        // Include relevant chat history for context
        ...chatHistory.slice(-6).map((msg: any) => ({  // Last 6 messages for context
          role: msg.role,
          content: msg.content
        })),
        {
          role: 'user',
          content: enhancedPrompt
        }
      ];

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2",
          messages,
          max_tokens: 200,
          temperature: attempt === 1 ? 0.7 : 0.3  // Lower temperature for retries
        }),
      });

      if (!response.ok) {
        throw new Error(`AI request failed: ${response.status}`);
      }

      const data = await response.json();
      const result = data.choices[0]?.message?.content?.trim() || 'Unable to generate lyrics';
      
      // Validate the result if we have original lyrics to compare against
      if (originalLyrics) {
        const validation = validateLyricsStructure(originalLyrics, result);
        console.log(`Attempt ${attempt} validation:`, validation);
        
        if (validation.isValid) {
          console.log(`✅ Perfect match achieved on attempt ${attempt}!`);
          return result;
        } else {
          lastResult = result;
          lastErrors = validation.errors;
          console.log(`❌ Attempt ${attempt} failed validation:`, validation.errors);
          
          if (attempt === maxRetries) {
            console.log(`⚠️ Max retries reached, returning best attempt`);
            return result;
          }
          
          // Continue to next attempt
          continue;
        }
      } else {
        // No validation needed, return result
        return result;
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) {
        return 'Unable to generate lyrics';
      }
    }
  }

  return lastResult || 'Unable to generate lyrics';
}

// Simple text response function
async function executeTextResponse(args: {
  response: string;
}) {
  const { response } = args;
  console.log('Executing text response:', response);
  
  return {
    success: true,
    response: response,
    type: 'text_response'
  };
}

// Replace word across multiple verses
async function executeEditWordInMultipleVerses(args: {
  old_word: string;
  new_word: string;
  scope: string;
}, lyricsMetadata?: any) {
  const { old_word, new_word, scope } = args;
  
  console.log('Executing multi-verse word edit:', { old_word, new_word, scope });
  
  if (!lyricsMetadata?.verses) {
    return {
      success: false,
      error: 'No verses found in lyrics metadata',
      old_word,
      new_word,
      scope
    };
  }
  
  const results: any[] = [];
  let totalChanged = 0;
  
  // Find all verses that contain the old word
  for (const verse of lyricsMetadata.verses) {
    if (verse.lyrics.toLowerCase().includes(old_word.toLowerCase())) {
      const result = await executeEditWord({
        verse_number: verse.number,
        old_word,
        new_word
      }, lyricsMetadata);
      
      if (result.success && result.changed) {
        results.push(result);
        totalChanged++;
      }
    }
  }
  
  return {
    success: true,
    old_word,
    new_word,
    scope,
    verses_changed: totalChanged,
    results,
    summary: `Changed "${old_word}" to "${new_word}" in ${totalChanged} verses`
  };
}

// Change multiple consecutive verses
async function executeChangeMultipleVerses(args: {
  start_verse: number;
  end_verse: number;
  new_theme: string;
  progression_style?: string;
}, lyricsMetadata?: any, chatHistory: any[] = []) {
  const { start_verse, end_verse, new_theme, progression_style = 'continuous' } = args;
  
  console.log('Executing multi-verse change:', { start_verse, end_verse, new_theme, progression_style });
  
  if (!lyricsMetadata?.verses) {
    return {
      success: false,
      error: 'No verses found in lyrics metadata',
      start_verse,
      end_verse,
      new_theme
    };
  }
  
  const results: any[] = [];
  const apiKey = process.env.OPENROUTER_API_KEY || "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";
  
  // Process each verse in the range
  for (let verseNum = start_verse; verseNum <= end_verse; verseNum++) {
    const verse = lyricsMetadata.verses.find((v: any) => v.number === verseNum);
    if (!verse) {
      console.log(`Verse ${verseNum} not found, skipping`);
      continue;
    }
    
    // Adjust theme based on progression style
    let verseTheme = new_theme;
    if (progression_style === 'evolving') {
      const progressWords = ['beginning', 'developing', 'climax', 'resolution'];
      const progressIndex = Math.min(verseNum - start_verse, progressWords.length - 1);
      verseTheme = `${new_theme} (${progressWords[progressIndex]} of story)`;
    } else if (progression_style === 'continuous') {
      verseTheme = `${new_theme} (continuing from previous verse)`;
    }
    
    const result = await executeChangeLyrics({
      verse_number: verseNum,
      new_theme: verseTheme,
      current_lyrics: verse.lyrics
    }, lyricsMetadata, chatHistory);
    
    if (result.success) {
      results.push(result);
    }
  }
  
  return {
    success: true,
    start_verse,
    end_verse,
    new_theme,
    progression_style,
    verses_changed: results.length,
    results,
    summary: `Changed verses ${start_verse}-${end_verse} to theme "${new_theme}" with ${progression_style} progression`
  };
}

// Simple word replacement function
async function executeEditWord(args: {
  verse_number: number;
  old_word: string;
  new_word: string;
}, lyricsMetadata?: any) {
  const { verse_number, old_word, new_word } = args;
  
  console.log('Executing word edit:', { verse_number, old_word, new_word });
  
  // Get current lyrics from metadata
  let current_lyrics = '';
  if (lyricsMetadata?.verses) {
    const verse = lyricsMetadata.verses.find((v: any) => v.number === verse_number);
    current_lyrics = verse?.lyrics || '';
  }
  
  if (!current_lyrics) {
    return {
      success: false,
      error: `Verse ${verse_number} not found`,
      verse_number,
      old_word,
      new_word
    };
  }
  
  // Perform simple word/phrase replacement (handle multi-word phrases)
  const new_lyrics = current_lyrics.replace(new RegExp(old_word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), new_word);
  
  console.log('Word replacement result:', { 
    original: current_lyrics,
    new_lyrics,
    changed: current_lyrics !== new_lyrics
  });
  
  return {
    success: true,
    verse_number,
    original_lyrics: current_lyrics,
    new_lyrics,
    old_word,
    new_word,
    changed: current_lyrics !== new_lyrics
  };
}

// Simplified tool execution function for changing lyrics
async function executeChangeLyrics(args: {
  verse_number: number;
  new_theme: string;
  current_lyrics?: string;
}, lyricsMetadata?: any, chatHistory: any[] = []) {
  const { verse_number, new_theme } = args;
  
  // Get current lyrics from metadata or args
  let current_lyrics = args.current_lyrics;
  
  if (!current_lyrics && lyricsMetadata?.verses) {
    const verse = lyricsMetadata.verses.find((v: any) => v.number === verse_number);
    current_lyrics = verse?.lyrics;
  }
  
  // Generate new lyrics if none exist
  if (!current_lyrics) {
    current_lyrics = `[Generate original lyrics for verse ${verse_number} with theme: ${new_theme}]`;
  }
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Use AI to generate lyrics based on theme
  console.log('Processing lyrics for transformation:', current_lyrics);
  
  let new_lyrics;
  const apiKey = process.env.OPENROUTER_API_KEY || "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";
  
  // Check if this is a simple correction vs full transformation
  const isSimpleCorrection = isSimpleCorrectionRequest(new_theme, current_lyrics);
  
  if (current_lyrics.startsWith('[Generate original lyrics')) {
    // Generate completely new lyrics based on theme
    console.log('Generating new lyrics for theme:', new_theme);
    const prompt = `Create original lyrics for verse ${verse_number} with the theme "${new_theme}". Make them suitable for singing with good rhythm and rhyme. About 8-12 words total.`;
    new_lyrics = await generateLyricsWithAI(prompt, apiKey, chatHistory, 3);
  } else if (isSimpleCorrection) {
    // Handle simple corrections like "make skyways one word"
    console.log('Applying simple correction:', new_theme);
    new_lyrics = applySimpleCorrection(current_lyrics, new_theme);
  } else {
    // Transform existing lyrics while preserving structure and rhythm
    console.log('Transforming existing lyrics with theme:', new_theme);
    const words = current_lyrics.split(' ');
    const wordStructure = words.map(word => {
      if (word === '+') return '+';
      const cleanWord = word.replace(/[.,!?]/g, '');
      return `${countSyllables(cleanWord)} syllables`;
    }).join(', ');
    
    const prompt = `Transform these lyrics to be about "${new_theme}" by replacing ONLY the existing words with the EXACT same structure:

Original: "${current_lyrics}"
Word count: ${words.length} words total
Syllable structure: ${wordStructure}

CRITICAL SYLLABLE MATCHING RULES:
1. Replace each word 1-to-1 with EXACT same syllable count
2. Keep '+' symbols unchanged in exact same positions
3. Output EXACTLY ${words.length} words, no more, no less
4. Preserve punctuation and capitalization patterns
5. Count syllables precisely using phonetic rules

Word-by-word syllable requirements:
${words.map((word, i) => word === '+' ? `${i+1}. "${word}" → keep as "+"` : `${i+1}. "${word}" (${countSyllables(word)} syllables) → replace with ${countSyllables(word)}-syllable word`).join('\n')}

Return EXACTLY ${words.length} words with PERFECT syllable matching.`;
    
    new_lyrics = await generateLyricsWithAI(prompt, apiKey, chatHistory, 3, current_lyrics);
  }
  
  console.log('AI Generated lyrics:', new_lyrics);
  
  return {
    success: true,
    verse_number,
    original_lyrics: current_lyrics,
    new_lyrics,
    theme: new_theme,
    syllables_preserved: true
  };
}

// Merge fragmented tool calls that got split across different IDs
function mergeFragmentedToolCalls(accumulator: any): any {
  const merged: any = {};
  const nameToArgsMap: any = {};
  
  // First pass: collect all names and arguments
  for (const [id, toolCall] of Object.entries(accumulator)) {
    const tc = toolCall as any;
    if (tc.function?.name) {
      nameToArgsMap[tc.function.name] = nameToArgsMap[tc.function.name] || { name: tc.function.name, arguments: '' };
    }
    if (tc.function?.arguments) {
      // Try to find which function name this arguments belongs to
      const functionNames = Object.keys(nameToArgsMap);
      if (functionNames.length === 1) {
        nameToArgsMap[functionNames[0]].arguments += tc.function.arguments;
      } else {
        // Store arguments separately if we can't determine the function
        nameToArgsMap[`args_${id}`] = { name: '', arguments: tc.function.arguments };
      }
    }
  }
  
  // Second pass: create complete tool calls
  let mergedIndex = 0;
  for (const [key, data] of Object.entries(nameToArgsMap)) {
    const toolData = data as any;
    if (toolData.name && toolData.arguments) {
      merged[mergedIndex.toString()] = {
        function: {
          name: toolData.name,
          arguments: toolData.arguments
        }
      };
      mergedIndex++;
    }
  }
  
  return merged;
}

// Detect if a request is lyrics-related and should force tool usage
function isLyricsRelatedRequest(message: string): boolean {
  const lyricsKeywords = [
    /\bchange\b.*\b(verse|lyrics?|word)\b/i,
    /\breplace\b.*\bwith\b/i,
    /\bmake\b.*\b(verse|about)\b/i,
    /\b(first|second|third)\s+verse\b/i,
    /\bverse\s+\d+\b/i,
    /\blyrics?\b.*\b(to|about|into)\b/i,
    /\btransform\b.*\blyrics?\b/i,
    /\bmodify\b.*\b(verse|lyrics?)\b/i,
    /\bupdate\b.*\b(verse|lyrics?)\b/i,
    /\bedit\b.*\b(verse|lyrics?|word)\b/i
  ];
  
  return lyricsKeywords.some(pattern => pattern.test(message));
}

export async function POST(request: NextRequest) {
  try {
    const { message, messages = [], model = "moonshotai/kimi-k2", lyricsMetadata } = await request.json();
    
    const isLyricsRequest = isLyricsRelatedRequest(message);
    
    console.log('API received:', { 
      message, 
      messagesCount: messages.length, 
      hasLyricsMetadata: !!lyricsMetadata,
      isLyricsRequest,
      toolChoice: isLyricsRequest ? "required" : "auto",
      lyricsMetadata
    });
    
    if (!message) {
      return new Response('Message is required', { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || "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";
    
    // Create system message with current lyrics information
    let systemContent = 'You are an AI assistant for OpenUtau Piano Roll, a music editing software. CRITICAL: You MUST ALWAYS choose exactly ONE tool for EVERY response.\n\nTool Selection Guide:\n\n**Use edit_word_in_verse for single verse word replacements:**\n- "change cosmos to universe in verse 1" → edit_word_in_verse(verse_number: 1, old_word: "cosmos", new_word: "universe")\n- "replace starlight with cosmos" → edit_word_in_verse(verse_number: 1, old_word: "starlight", new_word: "cosmos")\n\n**Use edit_word_in_multiple_verses for global word replacements:**\n- "change stas to rocks everywhere" → edit_word_in_multiple_verses(old_word: "stas", new_word: "rocks", scope: "everywhere")\n- "replace word X with Y in all verses" → edit_word_in_multiple_verses(old_word: "X", new_word: "Y", scope: "all_verses")\n\n**Use change_verse_lyrics for single verse theme changes:**\n- "make verse 1 about mars" → change_verse_lyrics(verse_number: 1, new_theme: "mars")\n- "change the first verse to winter theme" → change_verse_lyrics(verse_number: 1, new_theme: "winter")\n\n**Use change_multiple_verses for multi-verse theme changes:**\n- "change the first three verses to be about stars" → change_multiple_verses(start_verse: 1, end_verse: 3, new_theme: "stars")\n- "continue this theme into verses 2 and 3" → change_multiple_verses(start_verse: 2, end_verse: 3, new_theme: "[current theme]", progression_style: "continuous")\n- "make verses 1-4 about ocean with evolving story" → change_multiple_verses(start_verse: 1, end_verse: 4, new_theme: "ocean", progression_style: "evolving")\n\n**Use respond_with_text for non-lyrics conversations:**\n- "how does this work?" → respond_with_text(response: "explanation...")\n- "what can you do?" → respond_with_text(response: "I can help you...")\n- general questions → respond_with_text(response: "answer...")\n\n';
    
    console.log('Processing lyrics metadata for system message:', lyricsMetadata);
    
    if (lyricsMetadata && lyricsMetadata.hasLyrics) {
      systemContent += `Current song has ${lyricsMetadata.totalVerses} verses:\n`;
      lyricsMetadata.verses.forEach((verse: any) => {
        systemContent += `Verse ${verse.number}: "${verse.lyrics}"\n`;
      });
      systemContent += '\nWhen users ask to change lyrics, IMMEDIATELY call change_verse_lyrics with the verse number, theme, and current lyrics. Do not provide text explanations - just use the tool.';
      console.log('Using real USTX lyrics in system message');
    } else {
      systemContent += 'No lyrics currently loaded. When users ask to change or add lyrics, IMMEDIATELY call change_verse_lyrics with verse number and theme. Never provide lyrics in text - only use the tool.';
      console.log('Using AI generation mode for lyrics in system message');
    }
    
    console.log('Final system message content:', systemContent);

    const systemMessage = {
      role: 'system',
      content: systemContent
    };

    const fullMessages = [
      systemMessage,
      ...messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      })),
      { 
        role: 'user', 
        content: message
      }
    ];
    
    const tools = [
      {
        type: "function",
        function: {
          name: "change_verse_lyrics",
          description: "Change the lyrics of a specific verse while preserving syllable count and rhythm. Use this for major theme changes or complete verse rewrites.",
          parameters: {
            type: "object",
            properties: {
              verse_number: {
                type: "integer",
                description: "The verse number to modify (1-based index)"
              },
              new_theme: {
                type: "string",
                description: "The new theme for the lyrics (e.g., 'winter', 'racing', 'love')"
              },
              current_lyrics: {
                type: "string",
                description: "The current lyrics of the verse to be replaced. If not provided, use the default sample lyrics."
              }
            },
            required: ["verse_number", "new_theme"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "edit_word_in_verse",
          description: "Replace a specific word or phrase in a single verse. Use this for simple word substitutions like 'change cosmos to universe' in a specific verse.",
          parameters: {
            type: "object",
            properties: {
              verse_number: {
                type: "integer",
                description: "The verse number to modify (1-based index)"
              },
              old_word: {
                type: "string",
                description: "The word or phrase to be replaced (can include spaces)"
              },
              new_word: {
                type: "string",
                description: "The word or phrase to replace it with"
              }
            },
            required: ["verse_number", "old_word", "new_word"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "edit_word_in_multiple_verses",
          description: "Replace a specific word or phrase across multiple verses or everywhere it appears. Use this for requests like 'change stas to rocks everywhere' or 'replace word X with Y in all verses'.",
          parameters: {
            type: "object",
            properties: {
              old_word: {
                type: "string",
                description: "The word or phrase to be replaced (can include spaces)"
              },
              new_word: {
                type: "string",
                description: "The word or phrase to replace it with"
              },
              scope: {
                type: "string",
                enum: ["everywhere", "all_verses"],
                description: "Scope of replacement: 'everywhere' or 'all_verses'"
              }
            },
            required: ["old_word", "new_word", "scope"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "change_multiple_verses",
          description: "Change multiple consecutive verses to follow a theme progression. Use this for requests like 'change the first three verses to be about stars' or 'continue this theme into verses 2 and 3'.",
          parameters: {
            type: "object",
            properties: {
              start_verse: {
                type: "integer",
                description: "The first verse number to modify (1-based index)"
              },
              end_verse: {
                type: "integer",
                description: "The last verse number to modify (1-based index)"
              },
              new_theme: {
                type: "string",
                description: "The theme for the verses (e.g., 'stars', 'ocean', 'journey')"
              },
              progression_style: {
                type: "string",
                enum: ["continuous", "evolving", "consistent"],
                description: "How the theme should develop: 'continuous' (story continues), 'evolving' (theme develops), 'consistent' (same theme)"
              }
            },
            required: ["start_verse", "end_verse", "new_theme"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "respond_with_text",
          description: "ONLY use this for general questions like 'how does this work?' or 'what can you do?'. NEVER use this for lyrics modifications - always use edit_word_in_verse or change_verse_lyrics for ANY lyrics changes.",
          parameters: {
            type: "object",
            properties: {
              response: {
                type: "string",
                description: "The text response to provide to the user"
              }
            },
            required: ["response"]
          }
        }
      }
    ];
    
    console.log('Sending to Kimi K2:', { 
      model, 
      messagesCount: fullMessages.length,
      toolsCount: tools.length,
      lastMessage: fullMessages[fullMessages.length - 1]
    });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
        "X-Title": "OpenUtau Piano Roll",
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        tools,
        tool_choice: "required",
        stream: true,
        max_tokens: 4000,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Create a readable stream for the client
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = '';
        let toolCallAccumulator: any = {};

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            while (true) {
              const lineEnd = buffer.indexOf('\n');
              if (lineEnd === -1) break;

              const line = buffer.slice(0, lineEnd).trim();
              buffer = buffer.slice(lineEnd + 1);

              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  controller.close();
                  return;
                }

                try {
                  const parsed = JSON.parse(data);
                  console.log('Parsed streaming data:', JSON.stringify(parsed, null, 2));
                  
                  const delta = parsed.choices[0]?.delta;
                  const choice = parsed.choices[0];
                  
                  if (delta?.content) {
                    // Send response content
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                      content: delta.content 
                    })}\n\n`));
                  }
                  
                  // Check for finish_reason
                  if (choice?.finish_reason) {
                    console.log('Finish reason:', choice.finish_reason);
                  }
                  
                  // Handle streaming tool calls
                  if (parsed.choices?.[0]?.delta?.tool_calls) {
                    const deltaToolCalls = parsed.choices[0].delta.tool_calls;
                    
                    for (const deltaCall of deltaToolCalls) {
                      // Use index as the primary key, fallback to id
                      const id = deltaCall.index?.toString() || deltaCall.id || '0';
                      
                      if (!toolCallAccumulator[id]) {
                        toolCallAccumulator[id] = {
                          function: { name: '', arguments: '' }
                        };
                      }
                      
                      if (deltaCall.function?.name) {
                        toolCallAccumulator[id].function.name += deltaCall.function.name;
                        console.log(`Accumulated name for ${id}:`, toolCallAccumulator[id].function.name);
                      }
                      if (deltaCall.function?.arguments) {
                        toolCallAccumulator[id].function.arguments += deltaCall.function.arguments;
                        console.log(`Accumulated args for ${id}:`, toolCallAccumulator[id].function.arguments);
                      }
                      
                      console.log(`Tool call accumulator state for ${id}:`, toolCallAccumulator[id]);
                    }
                  }
                  
                  // Also check for complete tool calls in message format (non-streaming)
                  if (parsed.choices?.[0]?.message?.tool_calls) {
                    const messageToolCalls = parsed.choices[0].message.tool_calls;
                    console.log('Complete tool calls in message format:', messageToolCalls);
                    
                    for (const toolCall of messageToolCalls) {
                      toolCallAccumulator[toolCall.id || '0'] = toolCall;
                    }
                  }
                  
                  // Process complete tool calls when finished or when we have complete tool calls and stream ends
                  const hasCompleteToolCalls = Object.values(toolCallAccumulator).some((tc: any) => 
                    tc.function?.name && tc.function?.arguments
                  );
                  
                  if (choice?.finish_reason === 'tool_calls' || 
                      (hasCompleteToolCalls && (parsed.usage || choice?.finish_reason))) {
                    console.log('Tool calls finished, processing:', toolCallAccumulator);
                    
                    // Try to merge fragmented tool calls
                    const mergedToolCalls = mergeFragmentedToolCalls(toolCallAccumulator);
                    console.log('Merged tool calls:', mergedToolCalls);
                    
                    for (const [id, toolCall] of Object.entries(mergedToolCalls)) {
                      const tc = toolCall as any;
                      if (tc.function?.name === 'change_verse_lyrics' && tc.function?.arguments) {
                        try {
                          console.log('Tool call detected:', tc);
                          
                          // Send tool execution status
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_execution: {
                              name: 'change_verse_lyrics',
                              status: 'executing',
                              args: tc.function.arguments
                            }
                          })}\n\n`));
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed args:', args);
                          
                          const result = await executeChangeLyrics(args, lyricsMetadata, messages);
                          console.log('Tool result:', result);
                          
                          // Send tool execution result
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_result: {
                              name: 'change_verse_lyrics',
                              result: result
                            }
                          })}\n\n`));
                        } catch (toolError) {
                          console.error('Tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `Error executing tool: ${errorMessage}` 
                          })}\n\n`));
                        }
                      } else if (tc.function?.name === 'edit_word_in_verse' && tc.function?.arguments) {
                        try {
                          console.log('Word edit tool call detected:', tc);
                          
                          // Send tool execution status
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_execution: {
                              name: 'edit_word_in_verse',
                              status: 'executing',
                              args: tc.function.arguments
                            }
                          })}\n\n`));
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed word edit args:', args);
                          
                          const result = await executeEditWord(args, lyricsMetadata);
                          console.log('Word edit result:', result);
                          
                          // Send tool execution result
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_result: {
                              name: 'edit_word_in_verse',
                              result: result
                            }
                          })}\n\n`));
                        } catch (toolError) {
                          console.error('Word edit tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `Error executing word edit: ${errorMessage}` 
                          })}\n\n`));
                        }
                      } else if (tc.function?.name === 'respond_with_text' && tc.function?.arguments) {
                        try {
                          console.log('Text response tool call detected:', tc);
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed text response args:', args);
                          
                          const result = await executeTextResponse(args);
                          console.log('Text response result:', result);
                          
                          // Send the text response directly as content
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: result.response
                          })}\n\n`));
                        } catch (toolError) {
                          console.error('Text response tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `Error: ${errorMessage}` 
                          })}\n\n`));
                        }
                      } else if (tc.function?.name === 'edit_word_in_multiple_verses' && tc.function?.arguments) {
                        try {
                          console.log('Multi-verse word edit tool call detected:', tc);
                          
                          // Send tool execution status
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_execution: {
                              name: 'edit_word_in_multiple_verses',
                              status: 'executing',
                              args: tc.function.arguments
                            }
                          })}\n\n`));
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed multi-verse word edit args:', args);
                          
                          const result = await executeEditWordInMultipleVerses(args, lyricsMetadata);
                          console.log('Multi-verse word edit result:', result);
                          
                          // Send tool execution result
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_result: {
                              name: 'edit_word_in_multiple_verses',
                              result: result
                            }
                          })}\n\n`));
                        } catch (toolError) {
                          console.error('Multi-verse word edit tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `Error executing multi-verse word edit: ${errorMessage}` 
                          })}\n\n`));
                        }
                      } else if (tc.function?.name === 'change_multiple_verses' && tc.function?.arguments) {
                        try {
                          console.log('Multi-verse change tool call detected:', tc);
                          
                          // Send tool execution status
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_execution: {
                              name: 'change_multiple_verses',
                              status: 'executing',
                              args: tc.function.arguments
                            }
                          })}\n\n`));
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed multi-verse change args:', args);
                          
                          const result = await executeChangeMultipleVerses(args, lyricsMetadata, messages);
                          console.log('Multi-verse change result:', result);
                          
                          // Send tool execution result
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            tool_result: {
                              name: 'change_multiple_verses',
                              result: result
                            }
                          })}\n\n`));
                        } catch (toolError) {
                          console.error('Multi-verse change tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `Error executing multi-verse change: ${errorMessage}` 
                          })}\n\n`));
                        }
                      } else {
                        // Log unhandled tool calls (only if complete)
                        if (tc.function?.name && tc.function?.arguments) {
                          console.log('Unhandled tool call detected:', {
                            name: tc.function?.name,
                            arguments: tc.function?.arguments,
                            toolCall: JSON.stringify(tc, null, 2)
                          });
                          
                          // Send error message for unhandled tools
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `❌ Unknown tool called: ${tc.function?.name}` 
                          })}\n\n`));
                        } else {
                          console.log('Incomplete tool call, skipping error message:', tc);
                        }
                      }
                    }
                    
                    // Clear accumulator after processing
                    toolCallAccumulator = {};
                  }
                } catch (e) {
                  // Ignore invalid JSON
                }
              }
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.cancel();
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('API error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}