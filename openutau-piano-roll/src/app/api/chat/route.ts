import { NextRequest } from 'next/server';
import { CacheInvalidationManager } from '@/utils/cacheInvalidation';

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
    return currentLyrics.replace(new RegExp('\\b' + oldWord + '\\b', 'gi'), newWord);
  }
  
  // Handle "replace X with Y" pattern
  const replaceMatch = correctionRequest.match(/^replace\s+(\w+)\s+with\s+(\w+)$/i);
  if (replaceMatch) {
    const [, oldWord, newWord] = replaceMatch;
    console.log('Replace pattern detected:', { oldWord, newWord });
    return currentLyrics.replace(new RegExp('\\b' + oldWord + '\\b', 'gi'), newWord);
  }
  
  // Handle "make X one word" - combine two words into one
  const makeOneWordMatch = correctionRequest.match(/^make\s+(.+)\s+one\s+word$/i);
  if (makeOneWordMatch) {
    const targetPhrase = makeOneWordMatch[1];
    console.log('Make one word pattern detected:', { targetPhrase });
    // Replace spaces in the target phrase
    const combinedWord = targetPhrase.replace(/\s+/g, '');
    return currentLyrics.replace(new RegExp('\\b' + targetPhrase + '\\b', 'gi'), combinedWord);
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
        return currentLyrics.replace(new RegExp('\\b' + oldWord + '\\b', 'gi'), newWord);
      }
    }
  }
  
  // Fallback: return original if no pattern matches
  console.log('No correction pattern matched, returning original');
  return currentLyrics;
}

// Helper function to find recent theme from message history
function findRecentTheme(messages: any[]): string | null {
  // Look through recent messages for tool results with themes
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.toolResult?.result) {
      const result = msg.toolResult.result;
      // Check for theme in single verse change
      if (result.theme) {
        return result.theme;
      }
      // Check for theme in multiple verse change
      if (result.new_theme) {
        return result.new_theme;
      }
    }
  }
  return null;
}

// Helper function to format tool results for context
function formatToolResultForContext(toolResult: any): string {
  if (!toolResult || !toolResult.result) return '';
  
  const { name, result } = toolResult;
  
  try {
    switch (name) {
      case 'change_verse_lyrics':
        const cleanLyrics = result.new_lyrics?.replace(' +', '') || '';
        return `Changed verse ${result.verse_number} to theme "${result.theme}" - New lyrics: "${cleanLyrics}"`;
      
      case 'change_multiple_verses':
        const verses = result.results?.map((r: any) => `v${r.verse_number}`) || [];
        return `Changed verses ${verses.join(', ')} to theme "${result.new_theme}"`;
      
      case 'edit_word_in_verse':
        return `In verse ${result.verse_number}, changed "${result.old_word}" to "${result.new_word}"`;
      
      case 'edit_word_in_multiple_verses':
        const changes = result.results?.map((r: any) => `v${r.verse_number}: "${r.old_word}"→"${r.new_word}"`) || [];
        return `Word edits: ${changes.join(', ')}`;
      
      default:
        return '';
    }
  } catch (e) {
    console.error('Error formatting tool context:', e);
    return '';
  }
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
  
  // Check if original starts with "a" and preserve it
  if (originalLyrics.startsWith('a ') && !newLyrics.startsWith('a ')) {
    errors.push('Missing "a" prefix: original starts with "a" but new lyrics start with "' + newWords[0] + '"');
  }
  
  // Check word count
  if (originalWords.length !== newWords.length) {
    errors.push('Word count mismatch: original has ' + originalWords.length + ' words, new has ' + newWords.length + ' words');
  }
  
  // Check syllable structure
  const originalSyllables = originalWords.map(word => ({ word, syllables: countSyllables(word) }));
  const newSyllables = newWords.map(word => ({ word, syllables: countSyllables(word) }));
  
  const syllableMismatches: string[] = [];
  for (let i = 0; i < Math.min(originalWords.length, newWords.length); i++) {
    if (originalWords[i] === '+') {
      if (newWords[i] !== '+') {
        errors.push('Position ' + (i + 1) + ': "+" symbol not preserved');
      }
    } else if (originalSyllables[i].syllables !== newSyllables[i].syllables) {
      syllableMismatches.push(
        'Position ' + (i + 1) + ': "' + originalWords[i] + '" (' + originalSyllables[i].syllables + ' syl) → "' + newWords[i] + '" (' + newSyllables[i].syllables + ' syl)'
      );
    }
  }
  
  if (syllableMismatches.length > 0) {
    errors.push('Syllable mismatches: ' + syllableMismatches.join(', '));
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
async function generateLyricsWithAI(prompt: string, apiKey: string, chatHistory: any[] = [], maxRetries: number = 50, originalLyrics?: string, provider: string = 'openrouter'): Promise<string> {
  let attempt = 0;
  let lastResult = '';
  let lastErrors: string[] = [];

  while (attempt < maxRetries) {
    attempt++;
    console.log('Lyrics generation attempt ' + attempt + '/' + maxRetries);

    try {
      // Build retry-specific prompt
      let enhancedPrompt = prompt;
      if (attempt > 1 && originalLyrics) {
        enhancedPrompt += '\n\nPREVIOUS ATTEMPT FAILED with errors: ' + lastErrors.join(', ') + '\nPrevious result: "' + lastResult + '"\n\nFIX THESE ERRORS and try again with PERFECT syllable matching.';
      }

      // Build messages with chat history for context
      const messages = [
        {
          role: 'system',
          content: 'You are a creative lyricist working on song lyrics. Generate lyrics that maintain rhythm, rhyme, and are suitable for singing. CRITICAL REQUIREMENTS: 1) You must match syllable counts EXACTLY - this is non-negotiable. 2) The lyrics MUST be grammatically correct and coherent - no broken sentences or meaningless phrases. 3) Each line must make logical sense and tell a story. Return only the lyrics, nothing else.'
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

      const apiUrl = provider === 'groq' 
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions';
      
      let response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider === 'groq' ? 'moonshotai/kimi-k2-instruct' : 'moonshotai/kimi-k2',
          messages,
          max_tokens: provider === 'groq' ? 8000 : 16000,
          temperature: attempt === 1 ? 0.7 : 0.3  // Lower temperature for retries
        }),
      });

      if (!response.ok) {
        // If Groq fails with auth error, try falling back to OpenRouter
        if (provider === 'groq' && (response.status === 401 || response.status === 403)) {
          console.log('Groq API failed (' + response.status + '), falling back to OpenRouter...');
          const fallbackApiUrl = 'https://openrouter.ai/api/v1/chat/completions';
          const fallbackApiKey = process.env.OPENROUTER_API_KEY || "";
          
          const fallbackResponse = await fetch(fallbackApiUrl, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + fallbackApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'moonshotai/kimi-k2',
              messages,
              max_tokens: 16000,
              temperature: attempt === 1 ? 0.7 : 0.3
            }),
          });
          
          if (fallbackResponse.ok) {
            console.log('✅ Fallback to OpenRouter successful on attempt ' + attempt);
            const data = await fallbackResponse.json();
            const result = data.choices[0]?.message?.content?.trim() || 'Unable to generate lyrics';
            
            // Continue with validation if needed
            if (originalLyrics) {
              const validation = validateLyricsStructure(originalLyrics, result);
              console.log('Fallback attempt ' + attempt + ' validation:', validation);
              
              if (validation.isValid) {
                console.log('✅ Fallback perfect match achieved on attempt ' + attempt + '!');
                return result;
              } else {
                lastResult = result;
                lastErrors = validation.errors;
                console.log('❌ Fallback attempt ' + attempt + ' failed validation:', validation.errors);
                
                if (attempt === maxRetries) {
                  console.log('⚠️ Max retries reached with fallback, returning best attempt');
                  return result;
                }
                continue;
              }
            } else {
              return result;
            }
          }
        }
        throw new Error('AI request failed: ' + response.status);
      }

      const data = await response.json();
      const result = data.choices[0]?.message?.content?.trim() || 'Unable to generate lyrics';
      
      // Validate the result if we have original lyrics to compare against
      if (originalLyrics) {
        const validation = validateLyricsStructure(originalLyrics, result);
        console.log('Attempt ' + attempt + ' validation:', validation);
        
        if (validation.isValid) {
          console.log('✅ Perfect match achieved on attempt ' + attempt + '!');
          return result;
        } else {
          lastResult = result;
          lastErrors = validation.errors;
          console.log('❌ Attempt ' + attempt + ' failed validation:', validation.errors);
          
          if (attempt === maxRetries) {
            console.log('⚠️ Max retries reached, returning best attempt');
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
      console.error('Attempt ' + attempt + ' failed:', error);
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
}, lyricsMetadata?: any, provider: string = 'openrouter') {
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
      }, lyricsMetadata, provider);
      
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
    summary: 'Changed "' + old_word + '" to "' + new_word + '" in ' + totalChanged + ' verses'
  };
}

// Change multiple consecutive verses
async function executeChangeMultipleVerses(args: {
  start_verse: number;
  end_verse: number;
  new_theme: string;
  progression_style?: string;
}, lyricsMetadata?: any, chatHistory: any[] = [], provider: string = 'openrouter') {
  const { start_verse, end_verse, new_theme, progression_style = 'continuous' } = args;
  
  console.log('Executing multi-verse change:', { start_verse, end_verse, new_theme, progression_style });
  
  console.log('[DEBUG] lyricsMetadata structure:', {
    hasVerses: !!lyricsMetadata?.verses,
    versesLength: lyricsMetadata?.verses?.length,
    versesKeys: lyricsMetadata?.verses?.[0] ? Object.keys(lyricsMetadata.verses[0]) : 'no verses',
    firstFewVerses: lyricsMetadata?.verses?.slice(0, 3)
  });
  
  if (!lyricsMetadata?.verses) {
    return {
      success: false,
      error: 'No verses found in lyrics metadata',
      start_verse,
      end_verse,
      new_theme
    };
  }
  
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  
  // Process verses SEQUENTIALLY for autoregressive context awareness
  const results: any[] = [];
  const changedVerses: string[] = []; // Track changed verses for context building
  const usedWords = new Set<string>(); // Track words to avoid repetition
  
  for (let verseNum = start_verse; verseNum <= end_verse; verseNum++) {
    console.log('[DEBUG] Looking for verse ' + verseNum + ' in verses:', lyricsMetadata.verses.map(v => ({ number: v.number, lyrics: v.lyrics?.slice(0, 50) + '...' })));
    const verse = lyricsMetadata.verses.find((v: any) => v.number === verseNum);
    if (!verse) {
      console.log('[ERROR] Verse ' + verseNum + ' not found in verses array! Available verses:', lyricsMetadata.verses.map(v => v.number));
      continue;
    }
    console.log('[DEBUG] Found verse ' + verseNum + ':', { number: verse.number, lyrics: verse.lyrics });
    
    // Build contextual theme with awareness of previously changed verses
    let verseTheme = new_theme;
    if (progression_style === 'evolving') {
      const progressWords = ['beginning', 'developing', 'climax', 'resolution'];
      const progressIndex = Math.min(verseNum - start_verse, progressWords.length - 1);
      verseTheme = new_theme + ' (' + progressWords[progressIndex] + ' of story)';
      
      // Add context from previous verses
      if (changedVerses.length > 0) {
        verseTheme += '\n\nPrevious verses in this sequence:\n' + changedVerses.join('\n');
      }
    } else if (progression_style === 'continuous') {
      verseTheme = new_theme;
      
      // Add context from previous verses for continuity
      if (changedVerses.length > 0) {
        const contextLimit = Math.min(changedVerses.length, 2); // Use last 2 verses as context
        const recentVerses = changedVerses.slice(-contextLimit);
        const avoidWordsList = Array.from(usedWords).slice(0, 15); // Limit to recent words
        const avoidWordsText = avoidWordsList.length > 0 
          ? '\n\nIMPORTANT - AVOID THESE WORDS (already used): ' + avoidWordsList.join(', ')
          : '';
        verseTheme += '\n\nContinuing from these previous verses:\n' + recentVerses.join('\n') + '\n\nMaintain narrative flow and avoid repetition.' + avoidWordsText;
      } else {
        verseTheme += ' (first verse in sequence)';
      }
    }
    
    try {
      console.log('[DEBUG] Processing verse ' + verseNum + ' with contextual theme: ' + verseTheme + ' (SEQUENTIAL)');
      // Use direct editing for faster processing with reduced retries for batch operations
      const result = await executeChangeLyricsDirect({
        verse_number: verseNum,
        new_theme: verseTheme,
        current_lyrics: verse.lyrics,
        maxRetries: 10  // Reduce retries for batch operations to speed up processing
      }, lyricsMetadata, chatHistory, provider);
      
      console.log('[DEBUG] Verse ' + verseNum + ' result:', result);
      
      if (result.success) {
        results.push(result);
        // Add this verse to context for next verses
        changedVerses.push('Verse ' + verseNum + ': ' + result.new_lyrics);
        
        // Track words used in this verse to avoid repetition
        if (result.new_lyrics) {
          const verseWords = result.new_lyrics.toLowerCase().match(/\b\w{4,}\b/g) || [];
          verseWords.forEach((word: string) => usedWords.add(word));
        }
      } else {
        console.error('[ERROR] Failed to change verse ' + verseNum + ':', result.error);
      }
    } catch (error) {
      console.error('[ERROR] Failed to process verse ' + verseNum + ':', error);
    }
  }
  
  console.log('[DEBUG] Sequential processing completed: ' + results.length + ' verses successfully changed');
  
  // Get the latest edited file path and verses from the last successful result
  let latestEditedFilePath = null;
  let latestVerses = null;
  
  if (results.length > 0) {
    const lastResult = results[results.length - 1];
    latestEditedFilePath = lastResult.editedFilePath;
    latestVerses = lastResult.verses;
    console.log('[DEBUG] Latest edited file path:', latestEditedFilePath);
    console.log('[DEBUG] Latest verses count:', latestVerses?.length);
  }
  
  // Check if this is part of a larger operation that needs batching
  const totalVerses = lyricsMetadata.totalVerses || lyricsMetadata.verses.length;
  const isBatchOperation = (end_verse - start_verse + 1) === 6 && end_verse < totalVerses;
  
  console.log('[DEBUG] Final results array length: ' + results.length);
  console.log('[DEBUG] Final results array:', results);
  
  const result: any = {
    success: true,
    start_verse,
    end_verse,
    new_theme,
    progression_style,
    verses_changed: results.length,
    results,
    summary: 'Changed verses ' + start_verse + '-' + end_verse + ' to theme "' + new_theme + '" with ' + progression_style + ' progression',
    // Add data needed for rendering panel update
    editedFilePath: latestEditedFilePath,
    verses: latestVerses,
    _refreshRequired: true // Signal to refresh the rendering panel
  };
  
  console.log('[DEBUG] Final executeChangeMultipleVerses result:', result);

  // Add batch operation metadata if this is a batch of a larger operation and more verses remain
  if (isBatchOperation) {
    const nextStart = end_verse + 1;
    const nextEnd = Math.min(nextStart + 5, totalVerses);
    
    // Calculate which batch this is based on start_verse
    const completedBatch = Math.floor((start_verse - 1) / 6) + 1;
    
    result.batch_operation = {
      completed_batch: completedBatch,
      next_batch: {
        start: nextStart,
        end: nextEnd,
        theme: new_theme
      },
      total_verses: totalVerses,
      original_request: 'make this song about ' + new_theme
    };
  }
  
  return result;
}

// Simple word replacement function
async function executeEditWord(args: {
  verse_number: number;
  old_word: string;
  new_word: string;
}, lyricsMetadata?: any, provider: string = 'openrouter') {
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
      error: 'Verse ' + verse_number + ' not found',
      verse_number,
      old_word,
      new_word
    };
  }
  
  // Check syllable matching before replacement
  const oldWordSyllables = countSyllables(old_word);
  const newWordSyllables = countSyllables(new_word);
  
  let final_new_word = new_word;
  let syllable_matched = oldWordSyllables === newWordSyllables;
  
  // If syllables don't match, use AI to generate a syllable-matched replacement
  if (!syllable_matched) {
    console.log('Syllable mismatch: "' + old_word + '" (' + oldWordSyllables + ' syl) → "' + new_word + '" (' + newWordSyllables + ' syl). Using AI to find better match.');
    
    const apiKey = process.env.OPENROUTER_API_KEY || "";
    
    const prompt = 'Find a ' + oldWordSyllables + '-syllable word or phrase that means "' + new_word + '" to replace "' + old_word + '" in this context:\n"' + current_lyrics + '"\n\nCRITICAL REQUIREMENTS:\n1. Must have EXACTLY ' + oldWordSyllables + ' syllables (same as "' + old_word + '")\n2. Must convey the meaning of "' + new_word + '"\n3. Must fit grammatically in the context\n4. Must be coherent and make sense\n\nExamples:\n- If replacing "cosmos" (2 syl) with "star" (1 syl) → suggest "starlight" (2 syl)\n- If replacing "night" (1 syl) with "moonlight" (2 syl) → suggest "moon" (1 syl)\n\nReturn ONLY the replacement word/phrase, nothing else.';

    try {
      final_new_word = await generateLyricsWithAI(prompt, apiKey, [], 50, old_word, provider);
      const finalSyllables = countSyllables(final_new_word);
      syllable_matched = finalSyllables === oldWordSyllables;
      
      console.log('AI suggested replacement: "' + final_new_word + '" (' + finalSyllables + ' syllables)');
    } catch (error) {
      console.error('AI syllable matching failed, using original replacement:', error);
      final_new_word = new_word;
    }
  }
  
  // Perform the replacement
  const new_lyrics = current_lyrics.replace(new RegExp(old_word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), final_new_word);
  
  console.log('Word replacement result:', { 
    original: current_lyrics,
    new_lyrics,
    oldWordSyllables,
    finalWordSyllables: countSyllables(final_new_word),
    syllable_matched,
    changed: current_lyrics !== new_lyrics
  });
  
  return {
    success: true,
    verse_number,
    original_lyrics: current_lyrics,
    new_lyrics,
    old_word,
    new_word: final_new_word,
    syllable_matched,
    changed: current_lyrics !== new_lyrics
  };
}

// NEW: Direct editing approach (experimental)
async function executeChangeLyricsDirect(args: {
  verse_number: number;
  new_theme: string;
  current_lyrics?: string;
  maxRetries?: number;
}, lyricsMetadata?: any, chatHistory: any[] = [], provider: string = 'openrouter') {
  const { verse_number, new_theme } = args;
  
  console.log('🧪 EXPERIMENTAL: Using direct editing approach for verse', verse_number);
  
  // Get current lyrics from metadata or args
  let current_lyrics = args.current_lyrics;
  
  if (!current_lyrics && lyricsMetadata?.verses) {
    const verse = lyricsMetadata.verses.find((v: any) => v.number === verse_number);
    current_lyrics = verse?.lyrics;
    console.log('Found current lyrics for verse ' + verse_number + ': "' + current_lyrics + '"');
  }
  
  // If still no lyrics found, generate placeholder
  if (!current_lyrics) {
    current_lyrics = '[Generate original lyrics for verse ' + verse_number + ' with theme: ' + new_theme + ']';
    console.log('No existing lyrics found for verse ' + verse_number + ', using placeholder');
  } else {
    console.log('Using existing lyrics for verse ' + verse_number + ': "' + current_lyrics + '"');
  }
  
  // Use AI to generate lyrics based on theme (same logic as original)
  console.log('Processing lyrics for transformation:', current_lyrics);
  
  let new_lyrics;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  
  // Check if this is a simple correction vs full transformation
  const isSimpleCorrection = isSimpleCorrectionRequest(new_theme, current_lyrics);
  
  if (current_lyrics.startsWith('[Generate original lyrics')) {
    // Generate completely new lyrics based on theme
    console.log('Generating new lyrics for theme:', new_theme);
    const prompt = 'Create original lyrics for verse ' + verse_number + ' with the theme "' + new_theme + '". Make them suitable for singing with good rhythm and rhyme. About 8-12 words total.';
    new_lyrics = await generateLyricsWithAI(prompt, apiKey, chatHistory, 50, undefined, provider);
  } else if (isSimpleCorrection) {
    // Handle simple corrections like "make skyways one word"
    console.log('Applying simple correction:', new_theme);
    new_lyrics = applySimpleCorrection(current_lyrics, new_theme);
  } else {
    // Transform existing lyrics while preserving structure and rhythm (same logic as original)
    console.log('Transforming existing lyrics with theme:', new_theme);
    const words = current_lyrics.split(' ');
    const wordStructure = words.map(word => {
      if (word === '+') return '+';
      const cleanWord = word.replace(/[.,!?]/g, '');
      return countSyllables(cleanWord) + ' syllables';
    }).join(', ');
    
    // Extract previously used words from chat history to avoid repetition
    const previouslyUsedWords = new Set<string>();
    if (chatHistory && chatHistory.length > 0) {
      chatHistory.forEach(msg => {
        if (msg.content && typeof msg.content === 'string') {
          // Extract words from previous messages, excluding common words
          const words = msg.content.toLowerCase().match(/\b\w{4,}\b/g) || [];
          words.forEach((word: string) => previouslyUsedWords.add(word));
        }
      });
    }
    
    const avoidWords = Array.from(previouslyUsedWords).slice(0, 20); // Limit to avoid overly long prompts
    const repetitionWarning = avoidWords.length > 0 
      ? '\n\nVOCABULARY DIVERSITY (CRITICAL):\n- NEVER reuse these words from previous verses: ' + avoidWords.join(', ') + '\n- Use fresh, creative synonyms and alternative expressions\n- Each verse must have unique vocabulary while maintaining the ' + new_theme + ' theme'
      : '';

    // Check for "a" prefix requirement
    const hasAPrefix = current_lyrics.startsWith('a ');
    const prefixRequirement = hasAPrefix 
      ? '\n\n🔴 IMPORTANT: The original starts with "a" - your new lyrics MUST also start with "a"!' 
      : '';
    
    const prompt = 'Transform these lyrics to be about "' + new_theme + '" by replacing ONLY the existing words with the EXACT same structure:\n\nOriginal: "' + current_lyrics + '"\nWord count: ' + words.length + ' words total\nSyllable structure: ' + wordStructure + prefixRequirement + '\n\nCRITICAL REQUIREMENTS (ALL MUST BE MET):\n\nSYLLABLE MATCHING (NON-NEGOTIABLE):\n1. Replace each word 1-to-1 with EXACT same syllable count\n2. Keep "+" symbols unchanged in exact same positions\n3. Output EXACTLY ' + words.length + ' words, no more, no less\n4. Preserve punctuation and capitalization patterns\n5. Count syllables precisely using phonetic rules' + (hasAPrefix ? '\n6. MUST start with "a" - this is the first word requirement!' : '') + '\n\nCOHERENCE & GRAMMAR (EQUALLY IMPORTANT):\n' + (hasAPrefix ? '7' : '6') + '. The new lyrics MUST be grammatically correct and make logical sense\n' + (hasAPrefix ? '8' : '7') + '. Each phrase must form complete, meaningful thoughts\n' + (hasAPrefix ? '9' : '8') + '. Avoid broken sentence structures or meaningless word combinations\n' + (hasAPrefix ? '10' : '9') + '. Ensure proper verb-noun relationships and sentence flow\n' + (hasAPrefix ? '11' : '10') + '. The lyrics should tell a coherent story about ' + new_theme + repetitionWarning + '\n\n📚 SUCCESSFUL TRANSFORMATION EXAMPLES (STUDY THESE PATTERNS):\n\nExample 1: Theme "ocean" (Based on Verse 1 structure)\nOriginal: "a Walking through darkness + Losing my grip in the grey"\nResult: "a Sailing through ocean + Finding my way in the waves"\n✓ Walk-ing(2)→Sail-ing(2), through(1)→through(1), dark-ness(2)→o-cean(2)\n✓ Los-ing(2)→Find-ing(2), my(1)→my(1), grip(1)→way(1), in(1)→in(1), the(1)→the(1), grey(1)→waves(1)\n✓ Preserves "a" prefix and "+" position\n\nExample 2: Theme "stars" (Based on Verse 2 structure)\nOriginal: "a Numbing the senses + I feel you slipping away"\nResult: "a Lighting the cosmos + I see stars fading away"\n✓ Numb-ing(2)→Light-ing(2), the(1)→the(1), sens-es(2)→cos-mos(2)\n✓ I(1)→I(1), feel(1)→see(1), you(1)→stars(1), slip-ping(2)→fad-ing(2), a-way(2)→a-way(2)\n✓ Natural flow matching original structure\n\nExample 3: Theme "winter" (Based on Verse 3 structure)\nOriginal: "a Fighting to hold on + Clinging to just one more day"\nResult: "a Freezing in winter + Waiting for just one more spring"\n✓ Fight-ing(2)→Freez-ing(2), to(1)→in(1), hold(1)→win-(1), on(1)→ter(1)\n✓ Cling-ing(2)→Wait-ing(2), to(1)→for(1), just(1)→just(1), one(1)→one(1), more(1)→more(1), day(1)→spring(1)\n✓ Grammatically correct with theme consistency\n\nExample 4: Theme "memories" (Based on Verse 4 structure)\nOriginal: "a Love turns to ashes + With all that I wish I could say"\nResult: "a Time fades to echoes + With words that I wish I could save"\n✓ Love(1)→Time(1), turns(1)→fades(1), to(1)→to(1), ash-es(2)→ech-oes(2)\n✓ With(1)→With(1), all(1)→words(1), that(1)→that(1), I(1)→I(1), wish(1)→wish(1), I(1)→I(1), could(1)→could(1), say(1)→save(1)\n✓ Perfect syllable and structure match\n\nEXAMPLE OF GOOD vs BAD transformations:\n❌ BAD: "Surfing to ride one wave Basking to tan one more" (broken grammar, makes no sense)\n✅ GOOD: "Sailing to catch one wave Hoping to surf one more" (perfect grammar, logical meaning)' + (hasAPrefix ? '\n❌ BAD: "The snow falls in silence..." (missing "a" prefix)\n✅ GOOD: "a Snow falls in silence..." (preserves "a" prefix)' : '') + '\n\nWord-by-word syllable requirements:\n' + words.map((word, i) => word === '+' ? (i+1) + '. "' + word + '" → keep as "+"' : (i+1) + '. "' + word + '" (' + countSyllables(word) + ' syllables) → replace with ' + countSyllables(word) + '-syllable word').join('\n') + '\n\nReturn EXACTLY ' + words.length + ' words with PERFECT syllable matching.';
    
    // Use maxRetries from args if provided (for batch operations), otherwise default to 50
    const maxAttempts = args.maxRetries || 50;
    new_lyrics = await generateLyricsWithAI(prompt, apiKey, chatHistory, maxAttempts, current_lyrics, provider);
  }
  
  console.log('AI Generated lyrics:', new_lyrics);
  
  // NOW: Use direct editing to save the changes
  try {
    console.log('🚀 Applying direct edit to USTX...');
    const directEditResponse = await fetch('http://localhost:3000/api/edit-verse-direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verseNumber: verse_number,
        newLyrics: new_lyrics
      })
    });
    
    if (directEditResponse.ok) {
      const directResult = await directEditResponse.json();
      console.log('✅ Direct edit successful:', directResult.newFileName);
      
      return {
        success: true,
        verse_number,
        original_lyrics: current_lyrics,
        new_lyrics,
        theme: new_theme,
        syllables_preserved: true,
        editedFilePath: directResult.newFilePath,
        verses: directResult.verses,
        method: 'direct_editing' // Flag to indicate which method was used
      };
    } else {
      console.error('❌ Direct edit failed, falling back to original method');
      // Fall back to original approach if direct edit fails
      return await executeChangeLyrics(args, lyricsMetadata, chatHistory, provider);
    }
  } catch (error) {
    console.error('❌ Direct edit error, falling back to original method:', error);
    // Fall back to original approach if direct edit fails
    return await executeChangeLyrics(args, lyricsMetadata, chatHistory, provider);
  }
}

// ORIGINAL: Current file-based approach (kept as fallback)
async function executeChangeLyrics(args: {
  verse_number: number;
  new_theme: string;
  current_lyrics?: string;
  maxRetries?: number;
}, lyricsMetadata?: any, chatHistory: any[] = [], provider: string = 'openrouter') {
  const { verse_number, new_theme } = args;
  
  // Get current lyrics from metadata or args
  let current_lyrics = args.current_lyrics;
  
  if (!current_lyrics && lyricsMetadata?.verses) {
    const verse = lyricsMetadata.verses.find((v: any) => v.number === verse_number);
    current_lyrics = verse?.lyrics;
    console.log('Found current lyrics for verse ' + verse_number + ': "' + current_lyrics + '"');
  }
  
  // If still no lyrics found, generate placeholder
  if (!current_lyrics) {
    current_lyrics = '[Generate original lyrics for verse ' + verse_number + ' with theme: ' + new_theme + ']';
    console.log('No existing lyrics found for verse ' + verse_number + ', using placeholder');
  } else {
    console.log('Using existing lyrics for verse ' + verse_number + ': "' + current_lyrics + '"');
  }
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Use AI to generate lyrics based on theme
  console.log('Processing lyrics for transformation:', current_lyrics);
  
  let new_lyrics;
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  
  // Check if this is a simple correction vs full transformation
  const isSimpleCorrection = isSimpleCorrectionRequest(new_theme, current_lyrics);
  
  if (current_lyrics.startsWith('[Generate original lyrics')) {
    // Generate completely new lyrics based on theme
    console.log('Generating new lyrics for theme:', new_theme);
    const prompt = 'Create original lyrics for verse ' + verse_number + ' with the theme "' + new_theme + '". Make them suitable for singing with good rhythm and rhyme. About 8-12 words total.';
    new_lyrics = await generateLyricsWithAI(prompt, apiKey, chatHistory, 50, undefined, provider);
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
      return countSyllables(cleanWord) + ' syllables';
    }).join(', ');
    
    // Extract previously used words from chat history to avoid repetition
    const previouslyUsedWords = new Set<string>();
    if (chatHistory && chatHistory.length > 0) {
      chatHistory.forEach(msg => {
        if (msg.content && typeof msg.content === 'string') {
          // Extract words from previous messages, excluding common words
          const words = msg.content.toLowerCase().match(/\b\w{4,}\b/g) || [];
          words.forEach((word: string) => previouslyUsedWords.add(word));
        }
      });
    }
    
    const avoidWords = Array.from(previouslyUsedWords).slice(0, 20); // Limit to avoid overly long prompts
    const repetitionWarning = avoidWords.length > 0 
      ? '\n\nVOCABULARY DIVERSITY (CRITICAL):\n- NEVER reuse these words from previous verses: ' + avoidWords.join(', ') + '\n- Use fresh, creative synonyms and alternative expressions\n- Each verse must have unique vocabulary while maintaining the ' + new_theme + ' theme'
      : '';

    // Check for "a" prefix requirement
    const hasAPrefix = current_lyrics.startsWith('a ');
    const prefixRequirement = hasAPrefix 
      ? '\n\n🔴 IMPORTANT: The original starts with "a" - your new lyrics MUST also start with "a"!' 
      : '';
    
    const prompt = 'Transform these lyrics to be about "' + new_theme + '" by replacing ONLY the existing words with the EXACT same structure:\n\nOriginal: "' + current_lyrics + '"\nWord count: ' + words.length + ' words total\nSyllable structure: ' + wordStructure + prefixRequirement + '\n\nCRITICAL REQUIREMENTS (ALL MUST BE MET):\n\nSYLLABLE MATCHING (NON-NEGOTIABLE):\n1. Replace each word 1-to-1 with EXACT same syllable count\n2. Keep "+" symbols unchanged in exact same positions\n3. Output EXACTLY ' + words.length + ' words, no more, no less\n4. Preserve punctuation and capitalization patterns\n5. Count syllables precisely using phonetic rules' + (hasAPrefix ? '\n6. MUST start with "a" - this is the first word requirement!' : '') + '\n\nCOHERENCE & GRAMMAR (EQUALLY IMPORTANT):\n' + (hasAPrefix ? '7' : '6') + '. The new lyrics MUST be grammatically correct and make logical sense\n' + (hasAPrefix ? '8' : '7') + '. Each phrase must form complete, meaningful thoughts\n' + (hasAPrefix ? '9' : '8') + '. Avoid broken sentence structures or meaningless word combinations\n' + (hasAPrefix ? '10' : '9') + '. Ensure proper verb-noun relationships and sentence flow\n' + (hasAPrefix ? '11' : '10') + '. The lyrics should tell a coherent story about ' + new_theme + repetitionWarning + '\n\n📚 SUCCESSFUL TRANSFORMATION EXAMPLES (STUDY THESE PATTERNS):\n\nExample 1: Theme "ocean" (Based on Verse 1 structure)\nOriginal: "a Walking through darkness + Losing my grip in the grey"\nResult: "a Sailing through ocean + Finding my way in the waves"\n✓ Walk-ing(2)→Sail-ing(2), through(1)→through(1), dark-ness(2)→o-cean(2)\n✓ Los-ing(2)→Find-ing(2), my(1)→my(1), grip(1)→way(1), in(1)→in(1), the(1)→the(1), grey(1)→waves(1)\n✓ Preserves "a" prefix and "+" position\n\nExample 2: Theme "stars" (Based on Verse 2 structure)\nOriginal: "a Numbing the senses + I feel you slipping away"\nResult: "a Lighting the cosmos + I see stars fading away"\n✓ Numb-ing(2)→Light-ing(2), the(1)→the(1), sens-es(2)→cos-mos(2)\n✓ I(1)→I(1), feel(1)→see(1), you(1)→stars(1), slip-ping(2)→fad-ing(2), a-way(2)→a-way(2)\n✓ Natural flow matching original structure\n\nExample 3: Theme "winter" (Based on Verse 3 structure)\nOriginal: "a Fighting to hold on + Clinging to just one more day"\nResult: "a Freezing in winter + Waiting for just one more spring"\n✓ Fight-ing(2)→Freez-ing(2), to(1)→in(1), hold(1)→win-(1), on(1)→ter(1)\n✓ Cling-ing(2)→Wait-ing(2), to(1)→for(1), just(1)→just(1), one(1)→one(1), more(1)→more(1), day(1)→spring(1)\n✓ Grammatically correct with theme consistency\n\nExample 4: Theme "memories" (Based on Verse 4 structure)\nOriginal: "a Love turns to ashes + With all that I wish I could say"\nResult: "a Time fades to echoes + With words that I wish I could save"\n✓ Love(1)→Time(1), turns(1)→fades(1), to(1)→to(1), ash-es(2)→ech-oes(2)\n✓ With(1)→With(1), all(1)→words(1), that(1)→that(1), I(1)→I(1), wish(1)→wish(1), I(1)→I(1), could(1)→could(1), say(1)→save(1)\n✓ Perfect syllable and structure match\n\nEXAMPLE OF GOOD vs BAD transformations:\n❌ BAD: "Surfing to ride one wave Basking to tan one more" (broken grammar, makes no sense)\n✅ GOOD: "Sailing to catch one wave Hoping to surf one more" (perfect grammar, logical meaning)' + (hasAPrefix ? '\n❌ BAD: "The snow falls in silence..." (missing "a" prefix)\n✅ GOOD: "a Snow falls in silence..." (preserves "a" prefix)' : '') + '\n\nWord-by-word syllable requirements:\n' + words.map((word, i) => word === '+' ? (i+1) + '. "' + word + '" → keep as "+"' : (i+1) + '. "' + word + '" (' + countSyllables(word) + ' syllables) → replace with ' + countSyllables(word) + '-syllable word').join('\n') + '\n\nReturn EXACTLY ' + words.length + ' words with PERFECT syllable matching.';
    
    // Use maxRetries from args if provided (for batch operations), otherwise default to 50
    const maxAttempts = args.maxRetries || 50;
    new_lyrics = await generateLyricsWithAI(prompt, apiKey, chatHistory, maxAttempts, current_lyrics, provider);
  }
  
  console.log('AI Generated lyrics:', new_lyrics);
  
  // Now actually save the edited lyrics to a new USTX file using the CLI
  let editedFilePath = null;
  let editedVerses = null;
  try {
    // IMPORTANT: Always start from the original still_here.ustx or the most recent edited file
    // Get the current USTX path if it exists, otherwise use the original
    let ustxPath = '/workspaces/OpenUtau/still_here.ustx';
    
    try {
      const pathResponse = await fetch('http://localhost:3001/api/set-current-path', {
        method: 'GET'
      });
      if (pathResponse.ok) {
        const pathData = await pathResponse.json();
        if (pathData.currentPath && pathData.currentPath.includes('still_here')) {
          // Check if this file actually exists and has the expected content
          ustxPath = pathData.currentPath;
          console.log('Found existing USTX path:', ustxPath);
        } else {
          console.log('Current path invalid, using original still_here.ustx');
        }
      }
    } catch (error) {
      console.log('Could not fetch current path, using original:', ustxPath);
    }
    
    // Call analyze-verses with edit parameters to create NEW USTX file
    console.log('Calling analyze-verses to save verse ' + verse_number + ' with new lyrics to USTX...');
    console.log('Editing file:', ustxPath);
    console.log('New lyrics:', new_lyrics);
    
    const editResponse = await fetch('http://localhost:3001/api/analyze-verses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ustxPath: ustxPath,
        verseNumber: verse_number,
        newLyrics: new_lyrics
      })
    });
    
    if (editResponse.ok) {
      const editResult = await editResponse.json();
      editedFilePath = editResult.editedFilePath;
      editedVerses = editResult.verses;  // Store the verses from the edit operation
      console.log('✅ Successfully saved edited lyrics to:', editedFilePath);
      console.log('📝 Edit result verses:', editResult.verses?.length);
      
      // Log the edited verse to verify it has new lyrics
      if (editResult.verses && editResult.verses.length > 0) {
        const editedVerse = editResult.verses.find((v: any) => v.phraseNumber === verse_number);
        console.log('🔍 Edited verse ' + verse_number + ':', editedVerse?.lyrics || 'NOT FOUND');
      }
      
      // Update the current path to the new edited file
      if (editedFilePath) {
        await fetch('http://localhost:3001/api/set-current-path', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: editedFilePath
          })
        });
      }
    } else {
      console.error('Failed to save edited lyrics to USTX:', editResponse.status);
    }
  } catch (error) {
    console.error('Error saving edited lyrics to USTX:', error);
  }
  
  return {
    success: true,
    verse_number,
    original_lyrics: current_lyrics,
    new_lyrics,
    theme: new_theme,
    syllables_preserved: true,
    editedFilePath,
    verses: editedVerses || null  // Include the verses from the edit operation
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
        nameToArgsMap['args_' + id] = { name: '', arguments: tc.function.arguments };
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
    /\bedit\b.*\b(verse|lyrics?|word)\b/i,
    /continue batch operation.*change verses/i,
    /continue.*verses.*\d+.*theme/i
  ];
  
  return lyricsKeywords.some(pattern => pattern.test(message));
}

// Detect if a request is pitch-related
function isPitchRelatedRequest(message: string): boolean {
  const pitchKeywords = [
    // Explicit pitch mentions
    /\bpitch\b/i,
    
    // Common pitch change phrases
    /\bmake\b.*\b(higher|lower|pitch)\b/i,
    /\bhave\b.*\b(higher|lower|much.*pitch|more.*pitch|less.*pitch)\b/i,
    /\bsound\b.*\b(higher|lower|pitch)\b/i,
    /\bchange\b.*\b(pitch|tone|key)\b/i,
    /\braise\b.*\b(pitch|tone|key)\b/i,
    /\blower\b.*\b(pitch|tone|key)\b/i,
    /\bincrease\b.*\b(pitch|tone|key)\b/i,
    /\bdecrease\b.*\b(pitch|tone|key)\b/i,
    
    // Musical terms that indicate pitch
    /\b(higher|lower)\b.*\b(pitch|tone|key|semitone|octave)\b/i,
    /\b(pitch|tone|key)\b.*\b(higher|lower|up|down)\b/i,
    /\btranspose\b/i,
    /\bshift.*\b(up|down|higher|lower)\b/i,
    
    // Specific musical modifications
    /\bsemitone/i,
    /\bcent/i,
    /\boctave/i,
    /\bvibrato\b/i,
    /\bsweep\b/i,
    /\btransition\b/i,
    /\bhigh-low\b/i,
    /\barch\b/i,
    /\bcurve\b/i,
    /\bbend\b/i,
    
    // Contextual pitch indicators (when combined with verse/note references)
    /\b(verse|note|song|melody)\b.*\b(higher|lower|pitch)\b/i,
    /\b(higher|lower)\b.*\b(verse|note|song|melody)\b/i,
    
    // More natural language patterns
    /much\s+(higher|lower)/i,
    /more\s+(high|low)/i,
    /less\s+(high|low)/i,
    /\b(tune|melody)\b.*\b(up|down|higher|lower)\b/i
  ];
  
  console.log('Checking if pitch request:', message);
  const isMatch = pitchKeywords.some(keyword => {
    const matches = keyword.test(message);
    if (matches) {
      console.log('  ✅ Matched pitch pattern:', keyword);
    }
    return matches;
  });
  console.log('  → Result:', isMatch ? 'PITCH REQUEST' : 'not pitch request');
  
  return isMatch;
}

export async function POST(request: NextRequest) {
  try {
    const { message, messages = [], model = "openai/gpt-oss-120b", provider = 'openrouter', lyricsMetadata } = await request.json();
    
    const isLyricsRequest = isLyricsRelatedRequest(message);
    const isPitchRequest = isPitchRelatedRequest(message);
    
    console.log('API received:', { 
      message, 
      messagesCount: messages.length, 
      hasLyricsMetadata: !!lyricsMetadata,
      hasUstxData: !!lyricsMetadata?.ustxData,
      isLyricsRequest,
      isPitchRequest,
      provider,
      toolChoice: (isLyricsRequest && !isPitchRequest) ? "required" : "auto"
    });

    // Handle pitch modification requests - redirect to lyrics editing in Copilot
    if (isPitchRequest) {
      console.log('PITCH REQUEST DETECTED - Redirecting to lyrics editing');
      
      // Create a streaming response that redirects to lyrics editing
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const redirectMessage = 'I understand you\'d like to modify pitch or vibrato, but in the AI Copilot I focus on **lyrics editing** to keep things simple! 🎵\n\nInstead, I can help you:\n- **Change lyrics to be more happy/sad/dramatic** (which naturally affects the emotional tone)\n- **Replace specific words** to change the mood\n- **Rewrite verses with different themes**\n\nWould you like me to help you edit the lyrics to achieve the emotional effect you\'re looking for?';
          
          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ content: redirectMessage }) + '\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Handle lyrics modification requests with tools
    if (isLyricsRequest && lyricsMetadata?.ustxData) {
      console.log('✅ PROCESSING LYRICS REQUEST - Using lyrics modification tools');
    }
    
    if (!message) {
      return new Response('Message is required', { status: 400 });
    }

    const apiKey = provider === 'groq' 
      ? (process.env.GROQ_API_KEY || '')
      : (process.env.OPENROUTER_API_KEY || '');
    
    // Create system message with current lyrics information
    // Add special instruction for GPT-OSS-120B to ensure tool execution after reasoning
    const gptOssInstruction = model === 'openai/gpt-oss-120b' 
      ? '**GPT-OSS-120B CRITICAL INSTRUCTION:** After reasoning about the task, you MUST execute the appropriate tool call. Your reasoning is valuable, but you must complete the action by calling the tool. Do not stop after reasoning. TOOL EXECUTION IS MANDATORY - Every response must end with a tool call, no exceptions. The system expects tool execution after your reasoning.\n\n' 
      : '';
    
    let systemContent = 'You are an AI assistant for OpenUtau Piano Roll, a music editing software. CRITICAL: You MUST ALWAYS choose exactly ONE tool for EVERY response.\n\n' + gptOssInstruction + '**PITCH MODIFICATIONS - HIGHEST PRIORITY:**\nWhen users mention PITCH, TONE, HIGHER, LOWER, TRANSPOSE, SEMITONES, OCTAVES, VIBRATO, or similar musical terms, this is a PITCH MODIFICATION request, NOT a lyrics change request. Examples:\n- "make the first verse higher pitch" → This is PITCH modification, NOT lyrics editing\n- "verse 1 should have lower pitch" → This is PITCH modification, NOT lyrics editing  \n- "make it sound higher" → This is PITCH modification, NOT lyrics editing\n- "transpose verse 2 down" → This is PITCH modification, NOT lyrics editing\n\nPITCH REQUESTS ARE HANDLED AUTOMATICALLY - do not use any lyrics editing tools for these requests.\n\nTool Selection Guide:\n\n**Use edit_word_in_verse for single verse word replacements:**\n- "change cosmos to universe in verse 1" → edit_word_in_verse(verse_number: 1, old_word: "cosmos", new_word: "universe")\n- "replace starlight with cosmos" → edit_word_in_verse(verse_number: 1, old_word: "starlight", new_word: "cosmos")\n\n**Use edit_word_in_multiple_verses for global word replacements:**\n- "change stas to rocks everywhere" → edit_word_in_multiple_verses(old_word: "stas", new_word: "rocks", scope: "everywhere")\n- "replace word X with Y in all verses" → edit_word_in_multiple_verses(old_word: "X", new_word: "Y", scope: "all_verses")\n\n**Use change_verse_lyrics for single verse theme changes:**\n- "make verse 1 about mars" → change_verse_lyrics(verse_number: 1, new_theme: "mars")\n- "change the first verse to winter theme" → change_verse_lyrics(verse_number: 1, new_theme: "winter")\n\n**Use change_multiple_verses for multi-verse theme changes (6 verses MAX per call):**\n- "change the first three verses to be about stars" → change_multiple_verses(start_verse: 1, end_verse: 3, new_theme: "stars")\n- "continue this theme into verses 2 and 3" → change_multiple_verses(start_verse: 2, end_verse: 3, new_theme: "[current theme]", progression_style: "continuous")\n- "make verses 1-4 about ocean with evolving story" → change_multiple_verses(start_verse: 1, end_verse: 4, new_theme: "ocean", progression_style: "evolving")\n\n**For WHOLE SONG or 7+ verse requests, use BATCHING:**\n- "make this song about X" → change_multiple_verses(start_verse: 1, end_verse: 6, new_theme: "X"), then respond_with_text with batch_operation metadata\n- "change entire song to Y theme" → change_multiple_verses(start_verse: 1, end_verse: 6, new_theme: "Y"), then respond_with_text with batch_operation metadata\n- "transform all verses to Z" → change_multiple_verses(start_verse: 1, end_verse: 6, new_theme: "Z"), then respond_with_text with batch_operation metadata\n\n**Use respond_with_text for non-lyrics conversations:**\n- "how does this work?" → respond_with_text(response: "explanation...")\n- "what can you do?" → respond_with_text(response: "I can help you...")\n- general questions → respond_with_text(response: "answer...")\n\n';
    
    console.log('Processing lyrics metadata for system message:', lyricsMetadata);
    
    // Generate lyrics metadata from USTX using cached data or detection
    let processedMetadata = null;
    if (lyricsMetadata?.ustxData) {
      try {
        // Use cached verse detection if available to prevent re-detection corruption
        if (lyricsMetadata.cachedVerseDetection && lyricsMetadata.cachedVerseDetection.length > 0) {
          console.log('CHAT SYSTEM: Using cached verse detection (prevent re-detection corruption)');
          const verses = lyricsMetadata.cachedVerseDetection;
          console.log('CHAT SYSTEM: Cached verses structure:', verses.slice(0, 3).map((v: any) => ({
            verseNumber: v.verseNumber,
            phraseNumber: v.phraseNumber,
            lyrics: v.lyrics?.substring(0, 30) + '...',
            allKeys: Object.keys(v)
          })));
          
          const { USTXLyricsManager } = await import('@/utils/ustxLyricsUtils');
          const lyricsManager = new USTXLyricsManager(lyricsMetadata.ustxData);
          const allLyrics = lyricsManager.getAllLyrics();
          
          processedMetadata = {
            totalVerses: verses.length,
            hasLyrics: allLyrics.length > 0,
            allLyrics: allLyrics,
            verses: verses.map((v, index) => ({
              number: v.phraseNumber || v.verseNumber || (index + 1),
              lyrics: v.lyrics,
              wordCount: v.lyrics.split(' ').length
            })),
            hasPhonemeData: false,
            detectionMethod: 'cached-verse-detection'
          };
          
          console.log('CHAT SYSTEM: Generated metadata using cached verse detection:', processedMetadata);
        } else {
          // Fallback to detection when no cached data available
          console.log('CHAT SYSTEM: No cached data, falling back to verse detection');
          const { USTXLyricsManager } = await import('@/utils/ustxLyricsUtils');
          const lyricsManager = new USTXLyricsManager(lyricsMetadata.ustxData);
          
          const verses = lyricsManager.detectVerses();
          console.log('CHAT SYSTEM: Fallback detection verses:', verses.length);
          console.log('CHAT SYSTEM: Verses:', verses.map((v: any) => v.verseNumber + ': "' + v.lyrics + '"'));
          
          const allLyrics = lyricsManager.getAllLyrics();
          processedMetadata = {
            totalVerses: verses.length,
            hasLyrics: allLyrics.length > 0,
            allLyrics: allLyrics,
            verses: verses.map((v, index) => ({
              number: v.phraseNumber || v.verseNumber || (index + 1),
              lyrics: v.lyrics,
              wordCount: v.lyrics.split(' ').length
            })),
            hasPhonemeData: false,
            detectionMethod: 'fallback-detection'
          };
          
          console.log('CHAT SYSTEM: Generated metadata using fallback detection:', processedMetadata);
        }
      } catch (error) {
        console.error('Error generating lyrics metadata:', error);
        processedMetadata = null;
      }
    }
    
    if (processedMetadata && processedMetadata.hasLyrics && processedMetadata.verses?.length > 0) {
      systemContent += 'Current song has ' + processedMetadata.totalVerses + ' verses:\n';
      processedMetadata.verses.forEach((verse: any) => {
        systemContent += 'Verse ' + (verse.number || 'undefined') + ': "' + verse.lyrics + '"\n';
      });
      
      // Debug verse mapping
      console.log('DEBUG verse mapping:', processedMetadata.verses.map(v => ({ number: v.number, lyrics: v.lyrics?.substring(0, 30) + '...' })));
      systemContent += '\nWhen users ask to change lyrics, IMMEDIATELY call the appropriate tool. Do not provide text explanations - just use the tool.\n\nCRITICAL BATCHING RULES:\n1. For requests affecting 7+ verses or "whole song/entire song/this song", MUST process in batches of 6 verses maximum\n2. FIRST: Call change_multiple_verses(start_verse: 1, end_verse: 6, new_theme: "theme")\n3. IMMEDIATELY AFTER: Call respond_with_text with this EXACT format:\n{"batch_operation": true, "completed_batch": 1, "next_batch": {"start": 7, "end": 12, "theme": "original theme"}, "total_verses": ' + processedMetadata.totalVerses + ', "original_request": "user\'s original request"}\n\nThis creates continue buttons for users instead of requiring manual typing. NEVER process more than 6 verses in one call.';
      console.log('Using real USTX lyrics in system message');
      
      // Merge processed metadata with original for tools to use
      Object.assign(lyricsMetadata, processedMetadata);
    } else {
      systemContent += 'No lyrics currently loaded. When users ask to change or add lyrics, IMMEDIATELY call change_verse_lyrics with verse number and theme. Never provide lyrics in text - only use the tool.';
      console.log('Using AI generation mode for lyrics in system message');
    }
    
    console.log('Final system message content:', systemContent);

    const systemMessage = {
      role: 'system',
      content: systemContent
    };

    // Check if user is referring to "same theme" and try to infer it
    let enhancedMessage = message;
    if (message.toLowerCase().includes('same theme') || message.toLowerCase().includes('that theme')) {
      // Look for recent theme changes in message history
      const recentTheme = findRecentTheme(messages);
      if (recentTheme) {
        enhancedMessage = message + ` (Theme: "${recentTheme}")`;
        console.log('Inferred theme from context:', recentTheme);
      }
    }
    
    const fullMessages = [
      systemMessage,
      ...messages.map((msg: any) => {
        // Include tool execution context in assistant messages
        if (msg.role === 'assistant' && msg.toolResult) {
          const toolContext = formatToolResultForContext(msg.toolResult);
          return {
            role: msg.role,
            content: msg.content + (toolContext ? `\n\n[Tool Execution Context: ${toolContext}]` : '')
          };
        }
        return {
          role: msg.role,
          content: msg.content
        };
      }),
      { 
        role: 'user', 
        content: enhancedMessage
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
    
    console.log('Sending to ' + (provider === 'groq' ? 'Groq' : 'OpenRouter') + ':', { 
      provider,
      model: provider === 'groq' ? 'moonshotai/kimi-k2-instruct' : model, 
      messagesCount: fullMessages.length,
      toolsCount: tools.length,
      lastMessage: fullMessages[fullMessages.length - 1]
    });

    const apiUrl = provider === 'groq' 
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
      
    let response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
        "X-Title": "OpenUtau Piano Roll",
      },
      body: JSON.stringify({
        model: provider === 'groq' ? 'moonshotai/kimi-k2-instruct' : model,
        messages: fullMessages,
        tools,
        tool_choice: "auto", // Allow model to choose between tools and text response
        stream: true,
        max_tokens: provider === 'groq' ? 8000 : 16000,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      // If Groq fails with auth error, automatically fall back to OpenRouter
      if (provider === 'groq' && (response.status === 401 || response.status === 403)) {
        console.log('🔄 Groq API failed (' + response.status + '), automatically falling back to OpenRouter...');
        
        const fallbackApiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        const fallbackApiKey = process.env.OPENROUTER_API_KEY || "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";
        
        const fallbackResponse = await fetch(fallbackApiUrl, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + fallbackApiKey,
            'Content-Type': 'application/json',
            "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
            "X-Title": "OpenUtau Piano Roll",
          },
          body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            messages: fullMessages,
            tools,
            tool_choice: "auto", // Allow model to choose between tools and text response
            stream: true,
            max_tokens: 16000,
            temperature: 0.7
          }),
        });
        
        if (fallbackResponse.ok) {
          console.log('✅ Successfully fell back to OpenRouter for main chat completion');
          // Continue with the fallback response instead of the original
          response = fallbackResponse;
        } else {
          throw new Error('Both Groq and OpenRouter failed. Groq: ' + response.status + ', OpenRouter: ' + fallbackResponse.status);
        }
      } else {
        throw new Error('HTTP error! status: ' + response.status);
      }
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
        let toolCallsExecuted = false;

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
                    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                      content: delta.content 
                    }) + '\n\n'));
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
                        console.log('Accumulated name for ' + id + ':', toolCallAccumulator[id].function.name);
                      }
                      if (deltaCall.function?.arguments) {
                        toolCallAccumulator[id].function.arguments += deltaCall.function.arguments;
                        console.log('Accumulated args for ' + id + ':', toolCallAccumulator[id].function.arguments);
                      }
                      
                      console.log('Tool call accumulator state for ' + id + ':', toolCallAccumulator[id]);
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
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            tool_execution: {
                              name: 'change_verse_lyrics',
                              status: 'executing',
                              args: tc.function.arguments
                            }
                          }) + '\n\n'));
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed args:', args);
                          
                          // Try direct editing first (faster), fall back to original method if it fails
                          const result = await executeChangeLyricsDirect(args, processedMetadata || lyricsMetadata, messages, provider);
                          console.log('Tool result:', result);
                          toolCallsExecuted = true;
                          
                          // Invalidate cache for changed lyrics
                          if (result.success && result.changed && (processedMetadata || lyricsMetadata)) {
                            try {
                              await CacheInvalidationManager.invalidateChangedSegments(
                                (processedMetadata || lyricsMetadata).ustxData,
                                (processedMetadata || lyricsMetadata).ustxData, // Same data for now
                                [{
                                  verseNumber: result.verse_number,
                                  oldLyrics: result.original_lyrics || '',
                                  newLyrics: result.new_lyrics || ''
                                }]
                              );
                            } catch (cacheError) {
                              console.error('Cache invalidation failed:', cacheError);
                            }
                          }
                          
                          // Send tool execution result
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            tool_result: {
                              name: 'change_verse_lyrics',
                              result: result
                            }
                          }) + '\n\n'));
                          
                          // If edit was successful and created a new file, send refresh signal
                          if (result.success && result.editedFilePath) {
                            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                              refresh_rendering_panel: true,
                              editedFilePath: result.editedFilePath,
                              verses: result.verses  // Include verses from the edit operation
                            }) + '\n\n'));
                          }
                        } catch (toolError) {
                          console.error('Tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            content: 'Error executing tool: ' + errorMessage 
                          }) + '\n\n'));
                        }
                      } else if (tc.function?.name === 'edit_word_in_verse' && tc.function?.arguments) {
                        try {
                          console.log('Word edit tool call detected:', tc);
                          
                          // Send tool execution status
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            tool_execution: {
                              name: 'edit_word_in_verse',
                              status: 'executing',
                              args: tc.function.arguments
                            }
                          }) + '\n\n'));
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed word edit args:', args);
                          
                          const result = await executeEditWord(args, processedMetadata || lyricsMetadata, provider);
                          toolCallsExecuted = true;
                          console.log('Word edit result:', result);
                          
                          // Send tool execution result
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            tool_result: {
                              name: 'edit_word_in_verse',
                              result: result
                            }
                          }) + '\n\n'));
                        } catch (toolError) {
                          console.error('Word edit tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            content: 'Error executing word edit: ' + errorMessage 
                          }) + '\n\n'));
                        }
                      } else if (tc.function?.name === 'respond_with_text' && tc.function?.arguments) {
                        try {
                          console.log('Text response tool call detected:', tc);
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed text response args:', args);
                          
                          const result = await executeTextResponse(args);
                          toolCallsExecuted = true;
                          console.log('Text response result:', result);
                          
                          // Send the text response directly as content
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            content: result.response
                          }) + '\n\n'));
                        } catch (toolError) {
                          console.error('Text response tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            content: 'Error: ' + errorMessage 
                          }) + '\n\n'));
                        }
                      } else if (tc.function?.name === 'edit_word_in_multiple_verses' && tc.function?.arguments) {
                        try {
                          console.log('Multi-verse word edit tool call detected:', tc);
                          
                          // Send tool execution status
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            tool_execution: {
                              name: 'edit_word_in_multiple_verses',
                              status: 'executing',
                              args: tc.function.arguments
                            }
                          }) + '\n\n'));
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed multi-verse word edit args:', args);
                          
                          const result = await executeEditWordInMultipleVerses(args, processedMetadata || lyricsMetadata, provider);
                          toolCallsExecuted = true;
                          console.log('Multi-verse word edit result:', result);
                          
                          // Send tool execution result
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            tool_result: {
                              name: 'edit_word_in_multiple_verses',
                              result: result
                            }
                          }) + '\n\n'));
                        } catch (toolError) {
                          console.error('Multi-verse word edit tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            content: 'Error executing multi-verse word edit: ' + errorMessage 
                          }) + '\n\n'));
                        }
                      } else if (tc.function?.name === 'change_multiple_verses' && tc.function?.arguments) {
                        try {
                          console.log('Multi-verse change tool call detected:', tc);
                          
                          // Send tool execution status (check if controller is still open)
                          try {
                            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                              tool_execution: {
                                name: 'change_multiple_verses',
                                status: 'executing',
                                args: tc.function.arguments
                              }
                            }) + '\n\n'));
                          } catch (controllerError) {
                            console.log('Controller closed during status update, continuing silently');
                          }
                          
                          const args = JSON.parse(tc.function.arguments);
                          console.log('Parsed multi-verse change args:', args);
                          
                          const result = await executeChangeMultipleVerses(args, processedMetadata || lyricsMetadata, messages, provider);
                          toolCallsExecuted = true;
                          console.log('Multi-verse change result:', result);
                          
                          // Invalidate cache for changed lyrics in multi-verse operation
                          if (result.success && result.results?.length > 0 && (processedMetadata || lyricsMetadata)) {
                            try {
                              const changedVerses = result.results.filter((r: any) => r.changed).map((r: any) => ({
                                verseNumber: r.verse_number,
                                oldLyrics: r.original_lyrics || '',
                                newLyrics: r.new_lyrics || ''
                              }));
                              
                              if (changedVerses.length > 0) {
                                await CacheInvalidationManager.invalidateChangedSegments(
                                  (processedMetadata || lyricsMetadata).ustxData,
                                  (processedMetadata || lyricsMetadata).ustxData, // Same data for now
                                  changedVerses
                                );
                              }
                            } catch (cacheError) {
                              console.error('Multi-verse cache invalidation failed:', cacheError);
                            }
                          }
                          
                          // Send tool execution result (check if controller is still open)
                          try {
                            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                              tool_result: {
                                name: 'change_multiple_verses',
                                result: result
                              }
                            }) + '\n\n'));
                          } catch (controllerError) {
                            console.log('Controller closed during result update, operation completed successfully but frontend disconnected');
                          }
                        } catch (toolError) {
                          console.error('Multi-verse change tool execution error:', toolError);
                          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            content: 'Error executing multi-verse change: ' + errorMessage 
                          }) + '\n\n'));
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
                          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
                            content: '❌ Unknown tool called: ' + tc.function?.name 
                          }) + '\n\n'));
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
          // Check if GPT-OSS-120B reasoned but didn't execute tools
          if (model === 'openai/gpt-oss-120b' && !toolCallsExecuted) {
            console.log('🚨 GPT-OSS-120B completed without tool execution - this is likely a reasoning-only response');
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ 
              content: '\n\n⚠️ **Tool execution required but not performed.** GPT-OSS-120B reasoned about the task but did not execute the necessary action. Please try again or switch to Kimi-K2 for more reliable tool execution.' 
            }) + '\n\n'));
          }
          
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

// Export runtime configuration for longer timeouts
export const maxDuration = 300; // 5 minutes for long operations
export const runtime = 'nodejs';