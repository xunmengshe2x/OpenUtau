import { useState, useCallback } from 'react';
import { USTXData } from '@/types/openutau';
import { USTXLyricsManager } from '@/utils/ustxLyricsUtils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolExecution?: any;
  toolResult?: any;
  type?: string;
  pitchControlData?: {
    verse?: number;
    originalMessage: string;
  };
  verseClarificationData?: {
    availableVerses: Array<{ verseNumber: number; lyrics: string; noteCount: number }>;
    originalMessage: string;
  };
  batchOperation?: {
    completed_batch: number;
    next_batch: {
      start: number;
      end: number;
      theme: string;
    };
    total_verses: number;
    original_request: string;
  };
}

export function useStreamingChat(ustxData?: USTXData, onUSTXUpdate?: (newData: USTXData) => void, cachedVerseDetection?: any[]) {
  const [messages, setMessages] = useState<Message[]>([]);
  // Note: Removed caching since tools handle their own data fetching
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (content: string, model?: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };

    // Capture current messages before updating state
    const currentMessages = messages;
    
    // Prepare message history in correct format for API
    const messageHistory = currentMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Send USTX data directly to backend - let tools handle their own data fetching
    let lyricsMetadata = null;
    if (ustxData) {
      // Just pass the USTX data - don't do expensive CLI calls here
      lyricsMetadata = {
        ustxData: ustxData,
        hasLyrics: true, // Tools will determine this when needed
        cachedVerseDetection: cachedVerseDetection || null // Pass cached data to prevent re-detection
      };
    }

    console.log('Frontend sending:', { 
      message: content, 
      messageHistoryCount: messageHistory.length, 
      hasUSTXData: !!ustxData,
      lyricsMetadata
    });

    // Update UI immediately
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setIsLoading(true);

    try {
      // Create AbortController with 10-minute timeout for large operations
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 minutes
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          messages: messageHistory,
          model,
          lyricsMetadata: lyricsMetadata ? {
            ...lyricsMetadata,
            ustxData: ustxData  // Include original USTX data for pitch modifications
          } : null,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId); // Clear timeout if request completes

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

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
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              
              // Handle USTX updates from pitch modifications
              if (parsed.type === 'ustx_update' && parsed.ustxData && onUSTXUpdate) {
                console.log('Received USTX update from pitch modification:', {
                  hasVoiceParts: !!parsed.ustxData.voice_parts,
                  voicePartsCount: parsed.ustxData.voice_parts?.length,
                  totalNotes: parsed.ustxData.voice_parts?.reduce((sum: number, part: any) => sum + (part.notes?.length || 0), 0)
                });
                onUSTXUpdate(parsed.ustxData);
                continue;
              }

              // Handle verse clarification request
              if (parsed.type === 'verse_clarification_request') {
                console.log('Received verse clarification request:', parsed);
                // The clarification message is already in the regular content flow
                // We just need to store the metadata for potential future use
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMessage.id 
                      ? { 
                          ...msg,
                          type: 'verse_clarification_request',
                          verseClarificationData: {
                            availableVerses: parsed.availableVerses,
                            originalMessage: parsed.originalMessage
                          }
                        }
                      : msg
                  )
                );
                continue;
              }

              // Handle pitch control panel (legacy)
              if (parsed.type === 'pitch_control_panel') {
                setMessages(prev => [
                  ...prev,
                  {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: '🎛️ Pitch Controls',
                    timestamp: new Date(),
                    type: 'pitch_control_panel',
                    pitchControlData: {
                      verse: parsed.verse,
                      originalMessage: parsed.message
                    }
                  }
                ]);
                continue;
              }

              // Handle message content from pitch modifications
              if (parsed.type === 'message' && parsed.content) {
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMessage.id 
                      ? { ...msg, content: msg.content + parsed.content }
                      : msg
                  )
                );
                continue;
              }
              
              if (parsed.content) {
                setMessages(prev => 
                  prev.map(msg => {
                    if (msg.id === assistantMessage.id) {
                      const newContent = msg.content + parsed.content;
                      
                      // Check if content contains batch operation JSON
                      let batchOperation = undefined;
                      try {
                        // Look for JSON in the content that indicates batch operation
                        const jsonMatch = newContent.match(/\{"batch_operation":\s*true[^}]*\}/);
                        if (jsonMatch) {
                          batchOperation = JSON.parse(jsonMatch[0]);
                        }
                      } catch (e) {
                        // Not a batch operation, continue normally
                      }
                      
                      return { 
                        ...msg, 
                        content: newContent,
                        batchOperation 
                      };
                    }
                    return msg;
                  })
                );
              }
              
              if (parsed.tool_execution) {
                // Handle tool execution status
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMessage.id 
                      ? { 
                          ...msg, 
                          content: msg.content + `\n\n🔧 Executing ${parsed.tool_execution.name}...`,
                          toolExecution: parsed.tool_execution
                        }
                      : msg
                  )
                );
              }
              
              if (parsed.tool_result) {
                // Handle tool execution result
                const result = parsed.tool_result.result;
                const toolName = parsed.tool_result.name;
                console.log('Frontend received tool result:', { toolName, result });
                
                // Update USTX data locally using USTXLyricsManager
                console.log('Checking USTX update conditions:', {
                  hasUSTXData: !!ustxData,
                  hasCallback: !!onUSTXUpdate,
                  verseNumber: result.verse_number,
                  newLyrics: result.new_lyrics,
                  toolName: toolName,
                  resultKeys: Object.keys(result)
                });

                // Handle single verse updates
                if (ustxData && onUSTXUpdate && result.verse_number && result.new_lyrics) {
                  try {
                    console.log('Creating USTXLyricsManager with data:', {
                      hasVoiceParts: !!ustxData.voice_parts,
                      voicePartsCount: ustxData.voice_parts?.length
                    });
                    
                    const lyricsManager = new USTXLyricsManager(ustxData);
                    const updatedUSTX = await lyricsManager.updateVerseLyrics(result.verse_number, result.new_lyrics, 'fem_1_ln');
                    
                    console.log('USTX update completed, calling callback with updated data');
                    console.log('Updated USTX has voice parts:', !!updatedUSTX.voice_parts);
                    
                    onUSTXUpdate(updatedUSTX);
                    console.log('onUSTXUpdate callback called successfully');
                    
                    // USTX updated - no caching to clear
                  } catch (error) {
                    console.error('Error updating USTX locally:', error);
                    // Continue without crashing - show the result even if USTX update fails
                  }
                }
                // Handle multi-verse updates (change_multiple_verses, edit_word_in_multiple_verses)
                else if (ustxData && onUSTXUpdate && result.results && Array.isArray(result.results)) {
                  try {
                    console.log('Processing multi-verse update:', {
                      toolName,
                      resultsCount: result.results.length,
                      hasVoiceParts: !!ustxData.voice_parts,
                      voicePartsCount: ustxData.voice_parts?.length
                    });
                    
                    // Extract verse updates from results array
                    const verseUpdates = result.results
                      .filter((r: any) => r.verse_number && r.new_lyrics)
                      .map((r: any) => ({
                        verse_number: r.verse_number,
                        new_lyrics: r.new_lyrics
                      }));
                    
                    if (verseUpdates.length > 0) {
                      const lyricsManager = new USTXLyricsManager(ustxData);
                      
                      // Use streaming update to update UI progressively
                      const finalUSTX = await lyricsManager.updateMultipleVersesStreaming(
                        verseUpdates,
                        (updatedUSTX, verseNumber, progress) => {
                          console.log(`Verse ${verseNumber} updated (${progress.current}/${progress.total}), calling callback`);
                          onUSTXUpdate(updatedUSTX);
                          
                          // USTX updated - no caching to clear
                        }
                      );
                      
                      console.log('Multi-verse streaming USTX update completed');
                    }
                  } catch (error) {
                    console.error('Error updating multi-verse USTX locally:', error);
                    // Continue without crashing - show the result even if USTX update fails
                  }
                } else {
                  console.log('Skipping USTX update - missing requirements:', { 
                    hasUSTXData: !!ustxData,
                    hasCallback: !!onUSTXUpdate,
                    singleVerse: { hasVerseNumber: !!result.verse_number, hasNewLyrics: !!result.new_lyrics },
                    multiVerse: { hasResults: !!result.results, isArray: Array.isArray(result.results) }
                  });
                }
                
                // Handle different tool result formats
                let successMessage = '';
                if (toolName === 'edit_word_in_verse') {
                  successMessage = `\n\n✅ **Word Edited Successfully!**\n\n` +
                    `**Verse ${result.verse_number}**: Changed "${result.old_word}" to "${result.new_word}"\n\n` +
                    `**Original:** ${result.original_lyrics}\n\n` +
                    `**New:** ${result.new_lyrics}`;
                } else if (toolName === 'edit_word_in_multiple_verses') {
                  successMessage = `\n\n✅ **Multi-Verse Word Edit Completed!**\n\n` +
                    `**${result.summary}**\n\n` +
                    `**Details:**\n` +
                    result.results.map((r: any) => 
                      `• Verse ${r.verse_number}: "${r.old_word}" → "${r.new_word}"`
                    ).join('\n');
                } else if (toolName === 'change_multiple_verses') {
                  successMessage = `\n\n✅ **Multi-Verse Theme Change Completed!**\n\n` +
                    `**${result.summary}**\n\n` +
                    `**Details:**\n` +
                    result.results.map((r: any) => 
                      `• Verse ${r.verse_number}: Changed to "${r.theme || result.new_theme}"\n` +
                      `  Original: ${r.original_lyrics}\n` +
                      `  New: ${r.new_lyrics}`
                    ).join('\n\n');
                } else {
                  // Default change_verse_lyrics format
                  successMessage = `\n\n✅ **Lyrics Updated Successfully!**\n\n` +
                    `**Verse ${result.verse_number}** changed to theme: **${result.theme || 'custom'}**\n\n` +
                    `**Original:** ${result.original_lyrics}\n\n` +
                    `**New:** ${result.new_lyrics}\n\n` +
                    `*Syllables preserved: ${result.syllables_preserved ? '✓' : '✗'}*`;
                }
                
                // Check for batch operation metadata in tool result
                let batchOperation = undefined;
                if (result.batch_operation) {
                  batchOperation = result.batch_operation;
                }
                
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMessage.id 
                      ? { 
                          ...msg, 
                          content: msg.content + successMessage,
                          toolResult: parsed.tool_result,
                          batchOperation
                        }
                      : msg
                  )
                );
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      }

      // Mark streaming as complete
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { ...msg, isStreaming: false }
            : msg
        )
      );
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { 
                ...msg, 
                content: 'Sorry, there was an error processing your request.',
                isStreaming: false 
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [messages, ustxData, onUSTXUpdate, cachedVerseDetection]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const continueBatchOperation = useCallback(async (batchInfo: any, model?: string) => {
    const continueMessage = `Continue batch operation: change verses ${batchInfo.next_batch.start}-${batchInfo.next_batch.end} to theme "${batchInfo.next_batch.theme}"`;
    return sendMessage(continueMessage, model);
  }, [sendMessage]);

  return {
    messages,
    sendMessage,
    clearMessages,
    isLoading,
    continueBatchOperation,
  };
}