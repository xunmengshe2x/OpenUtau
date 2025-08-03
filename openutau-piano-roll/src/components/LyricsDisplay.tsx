'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { USTXData, USTXNote, PhonemeTiming, DetailedPhonemeTiming } from '@/types/openutau';
import { USTXLyricsManager } from '@/utils/ustxLyricsUtils';

interface LyricsLine {
  notes: USTXNote[];
  startTime: number;
  endTime: number;
  text: string;
  startNoteIndex?: number;
  endNoteIndex?: number;
}

interface LyricsDisplayProps {
  ustxData?: USTXData;
  phonemeData?: DetailedPhonemeTiming[] | PhonemeTiming[];
  currentTime: number;
  isPlaying: boolean;
  playbackMode?: 'full' | 'segment';
  currentSegmentInfo?: {
    startNoteIndex: number;
    endNoteIndex: number;
    lineIndex: number;
  };
  onNoteClick?: (note: USTXNote) => void;
  onLyricEdit?: (noteIndex: number, newLyric: string) => void;
  onSegmentRender?: (startNoteIndex: number, endNoteIndex: number, lineIndex: number) => void;
  onSegmentPlay?: (audioUrl: string, lineIndex: number) => void;
  onSegmentComplete?: (lineIndex: number) => void;
  cachedVerseDetection?: any[];
  useGPU?: boolean;
}

const LyricsDisplay: React.FC<LyricsDisplayProps> = ({
  ustxData,
  phonemeData,
  currentTime,
  isPlaying,
  playbackMode = 'full',
  currentSegmentInfo,
  onNoteClick,
  onLyricEdit,
  onSegmentRender,
  onSegmentPlay,
  onSegmentComplete,
  cachedVerseDetection,
  useGPU = false
}) => {
  const [lyricsLines, setLyricsLines] = useState<LyricsLine[]>([]);
  const [highlightedNoteIndex, setHighlightedNoteIndex] = useState<number>(-1);
  const [editingNoteIndex, setEditingNoteIndex] = useState<number>(-1);
  const [editingValue, setEditingValue] = useState<string>('');
  const [renderedAudioUrls, setRenderedAudioUrls] = useState<Map<number, string>>(new Map());
  const [isPlayingLine, setIsPlayingLine] = useState<number>(-1);
  const [renderingLines, setRenderingLines] = useState<Set<number>>(new Set());
  const [renderStatus, setRenderStatus] = useState<string>('');
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Process USTX data into lyrics lines using DiffSinger-style phoneme processing
  useEffect(() => {
    if (!ustxData?.voice_parts) return;

    console.log('LYRICS DISPLAY: Processing with DiffSinger-style phoneme processing');
    
    const updateVersesWithCurrentLyrics = async (cachedVerses: any[]) => {
      console.log('LYRICS DISPLAY: Updating verses with current USTX lyrics');
      
      // Get current lyrical notes from USTX
      const fullNotes = ustxData.voice_parts!.flatMap(part => 
        part.notes || []
      )
      .filter(note => note.lyric && note.lyric.trim() !== '')
      .sort((a, b) => a.position - b.position);
      
      const lyricalNotes = fullNotes.filter(note => !note.lyric.startsWith('+'));
      
      // Update each cached verse with current lyrics using the same boundaries
      const updatedVerses = cachedVerses.map(verse => {
        const verseNotes = lyricalNotes.slice(verse.startNoteIndex, verse.endNoteIndex + 1);
        const currentLyrics = verseNotes.map(note => note.lyric).join(' ');
        
        console.log(`LYRICS DISPLAY: Verse ${verse.verseNumber} - cached: "${verse.lyrics}" → current: "${currentLyrics}"`);
        
        return {
          ...verse,
          lyrics: currentLyrics // Use current lyrics from USTX
        };
      });
      
      return updatedVerses;
    };

    const processVerses = async () => {
      try {
        // Use cached verse detection if available to prevent re-detection corruption
        if (cachedVerseDetection && cachedVerseDetection.length > 0) {
          console.log('LYRICS DISPLAY: Using cached verse detection (prevent re-detection corruption)');
          console.log('LYRICS DISPLAY: Cached verses:', cachedVerseDetection.map(v => `${v.verseNumber}: "${v.lyrics}"`));
          
          // Use cached boundaries but extract current lyrics from USTX
          const updatedVerses = await updateVersesWithCurrentLyrics(cachedVerseDetection);
          processVersesToLines(updatedVerses);
          return;
        }
        
        // If no cached data, detect verses (but this should be rare in copilot mode)
        console.log('LYRICS DISPLAY: No cached data available, detecting verses...');
        const lyricsManager = new USTXLyricsManager(ustxData, phonemeData);
        
        // Try CLI-based phrase detection first (most accurate)
        const verses = await lyricsManager.detectVersesWithCLI('fem_1_ln');
        
        console.log('LYRICS DISPLAY: CLI-based phrases detected:', verses.length);
        console.log('LYRICS DISPLAY: Verses:', verses.map(v => `${v.verseNumber}: "${v.lyrics}"`));

        // Process verses into display lines
        processVersesToLines(verses);
        
      } catch (error) {
        console.error('LYRICS DISPLAY: Error with CLI processing, falling back:', error);
        
        // Fallback to original method
        const lyricsManager = new USTXLyricsManager(ustxData, phonemeData);
        const verses = lyricsManager.detectVerses();
        
        console.log('LYRICS DISPLAY: Fallback verses detected:', verses.length);
        processVersesToLines(verses);
      }
    };

    const processVersesToLines = (verses: any[]) => {
      // Get ALL notes (including + syllables) for render button indexing
      const fullNotes = ustxData.voice_parts!.flatMap(part => 
        part.notes || []
      )
      .filter(note => note.lyric && note.lyric.trim() !== '')
      .sort((a, b) => a.position - b.position);

      // Get lyrical notes only (excluding + syllables) for display - same as detectVersesWithCLI
      const lyricalNotes = fullNotes.filter(note => !note.lyric.startsWith('+'));

      // Convert verses to display lines using the actual detected note indices
      const lines: LyricsLine[] = verses.map(verse => {
        // verse.startNoteIndex and endNoteIndex are indices into lyricalNotes array
        const verseNotes = lyricalNotes.slice(verse.startNoteIndex, verse.endNoteIndex + 1);
        
        // Convert lyrical note indices to full note indices for render button
        const firstVerseNote = verseNotes[0];
        const lastVerseNote = verseNotes[verseNotes.length - 1];
        
        let fullStartIndex = -1;
        let fullEndIndex = -1;
        
        if (firstVerseNote && lastVerseNote) {
          // Find these notes in the full notes array (including + syllables)
          fullStartIndex = fullNotes.findIndex(note => 
            note.position === firstVerseNote.position && note.lyric === firstVerseNote.lyric
          );
          fullEndIndex = fullNotes.findIndex(note => 
            note.position === lastVerseNote.position && note.lyric === lastVerseNote.lyric
          );
        }
        
        console.log(`LYRICS DISPLAY: Creating line: "${verse.lyrics}"`);
        console.log(`  → lyrical notes ${verse.startNoteIndex}-${verse.endNoteIndex}`);
        console.log(`  → full notes ${fullStartIndex}-${fullEndIndex} (for render)`);
        
        return {
          notes: verseNotes,
          startTime: verseNotes[0]?.position || 0,
          endTime: verseNotes[verseNotes.length - 1]?.position + verseNotes[verseNotes.length - 1]?.duration || 0,
          text: verse.lyrics,
          startNoteIndex: Math.max(0, fullStartIndex), // Use full note indices for render button
          endNoteIndex: Math.max(0, fullEndIndex),
        };
      }).filter(line => line.text.trim().length > 0);

      setLyricsLines(lines);
    };

    processVerses();
  }, [ustxData, phonemeData, cachedVerseDetection]);

  // Update highlighted note based on current playback time
  useEffect(() => {
    if (!isPlaying || !ustxData?.voice_parts) {
      setHighlightedNoteIndex(-1);
      return;
    }

    // Convert current time to ticks (approximate)
    const bpm = ustxData.bpm || 120;
    const resolution = ustxData.resolution || 480;
    const msPerTick = (60 * 1000) / (bpm * resolution);
    let currentTick = currentTime * 1000 / msPerTick;

    // Get all notes in flat array
    const allNotes = ustxData.voice_parts.flatMap(part => part.notes || []);
    
    let noteIndex = -1;

    if (playbackMode === 'segment' && currentSegmentInfo) {
      // For segment playback, adjust the timing calculation
      const segmentNotes = allNotes.slice(currentSegmentInfo.startNoteIndex, currentSegmentInfo.endNoteIndex + 1);
      
      if (segmentNotes.length > 0) {
        // Get the original start position of the segment
        const segmentStartPosition = segmentNotes[0].position;
        
        // Adjust current tick to account for segment offset
        const adjustedCurrentTick = currentTick + segmentStartPosition;
        
        // Find highlighted note within the segment
        for (let i = 0; i < segmentNotes.length; i++) {
          const note = segmentNotes[i];
          if (adjustedCurrentTick >= note.position && adjustedCurrentTick < note.position + note.duration) {
            noteIndex = currentSegmentInfo.startNoteIndex + i;
            break;
          }
        }
      }
    } else {
      // For full song playback, use original logic
      for (let i = 0; i < allNotes.length; i++) {
        const note = allNotes[i];
        if (currentTick >= note.position && currentTick < note.position + note.duration) {
          noteIndex = i;
          break;
        }
      }
    }

    setHighlightedNoteIndex(noteIndex);
  }, [currentTime, isPlaying, ustxData, playbackMode, currentSegmentInfo]);

  // Auto-scroll to highlighted lyrics
  useEffect(() => {
    if (highlightedNoteIndex !== -1 && containerRef.current) {
      const highlightedElement = containerRef.current.querySelector(
        `[data-note-index="${highlightedNoteIndex}"]`
      );
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [highlightedNoteIndex]);

  const handleNoteClick = (note: USTXNote) => {
    if (onNoteClick) {
      onNoteClick(note);
    }
  };

  const handleNoteDoubleClick = (note: USTXNote, flatNoteIndex: number) => {
    setEditingNoteIndex(flatNoteIndex);
    setEditingValue(note.lyric);
  };

  const handleEditComplete = (flatNoteIndex: number) => {
    if (onLyricEdit && editingValue.trim()) {
      onLyricEdit(flatNoteIndex, editingValue.trim());
    }
    setEditingNoteIndex(-1);
    setEditingValue('');
  };

  const handleEditCancel = () => {
    setEditingNoteIndex(-1);
    setEditingValue('');
  };

  const handleKeyPress = (e: React.KeyboardEvent, flatNoteIndex: number) => {
    if (e.key === 'Enter') {
      handleEditComplete(flatNoteIndex);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const handleLineRender = async (lineIndex: number) => {
    const line = lyricsLines[lineIndex];
    if (!line || !onSegmentRender) return;

    // Add to rendering set to show loading state
    setRenderingLines(prev => new Set(prev).add(lineIndex));
    setRenderStatus(`Rendering verse ${lineIndex + 1}...`);

    try {
      // Use the original startNoteIndex and endNoteIndex from CLI phrase detection
      if (line.startNoteIndex !== undefined && line.endNoteIndex !== undefined) {
        const audioUrl = await onSegmentRender(line.startNoteIndex, line.endNoteIndex, lineIndex);
        
        // Store the rendered audio URL
        if (audioUrl) {
          addRenderedSegment(lineIndex, audioUrl);
        }
        
        // Call completion callback
        if (onSegmentComplete) {
          onSegmentComplete(lineIndex);
        }
        
        setRenderStatus(`✅ Verse ${lineIndex + 1} rendered successfully!`);
        setTimeout(() => setRenderStatus(''), 3000);
      }
    } catch (error) {
      console.error('Render error:', error);
      setRenderStatus(`❌ Failed to render verse ${lineIndex + 1}`);
      setTimeout(() => setRenderStatus(''), 5000);
    } finally {
      // Remove from rendering set
      setRenderingLines(prev => {
        const newSet = new Set(prev);
        newSet.delete(lineIndex);
        return newSet;
      });
    }
  };

  const handleLinePlay = (lineIndex: number) => {
    const audioUrl = renderedAudioUrls.get(lineIndex);
    if (!audioUrl) return;

    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }

    // Create new audio element
    const audio = new Audio(audioUrl);
    audio.onplay = () => setIsPlayingLine(lineIndex);
    audio.onended = () => setIsPlayingLine(-1);
    audio.onerror = () => {
      console.error('Audio playback error');
      setIsPlayingLine(-1);
    };

    setCurrentAudio(audio);
    audio.play();

    // Notify parent component
    if (onSegmentPlay) {
      onSegmentPlay(audioUrl, lineIndex);
    }
  };

  const handleLineStop = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setIsPlayingLine(-1);
    }
  };

  // Add rendered segment URL
  const addRenderedSegment = (lineIndex: number, audioUrl: string) => {
    setRenderedAudioUrls(prev => new Map(prev).set(lineIndex, audioUrl));
  };

  // Cleanup audio when component unmounts
  React.useEffect(() => {
    return () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
    };
  }, [currentAudio]);


  if (!ustxData) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center h-full text-gray-400"
      >
        <div className="text-center">
          <p className="text-lg mb-2 text-white">No lyrics loaded</p>
          <p className="text-sm">Load a USTX file to see lyrics</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-full bg-gray-800"
    >
      {/* Header */}
      <motion.div 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="p-4 border-b border-gray-700 bg-gray-750"
      >
        <h2 className="text-lg font-semibold text-white">Lyrics</h2>
        <p className="text-sm text-gray-300">
          {ustxData.name} - {lyricsLines.length} lines
        </p>
        <p className="text-xs text-gray-400 mt-1">
          💡 Double-click lyrics to edit • Click 🎵 Render to preview line
        </p>
        
        {/* Render Status */}
        <AnimatePresence>
          {renderStatus && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`mt-2 p-2 rounded text-xs font-medium ${
                renderStatus.includes('✅') 
                  ? 'bg-green-500/20 text-green-200 border border-green-500/30'
                  : renderStatus.includes('❌')
                  ? 'bg-red-500/20 text-red-200 border border-red-500/30'
                  : 'bg-blue-500/20 text-blue-200 border border-blue-500/30'
              }`}
            >
              {renderStatus}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Lyrics Content */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        <AnimatePresence mode="popLayout">
          {lyricsLines.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center text-gray-400 py-8"
            >
              <p>No lyrics found in this project</p>
            </motion.div>
          ) : (
            lyricsLines.map((line, lineIndex) => (
              <motion.div
                key={lineIndex}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ delay: lineIndex * 0.1 }}
                className="p-3 rounded-lg border border-gray-600 bg-gray-700 hover:bg-gray-650 transition-colors"
              >
                {/* Full phrase text from CLI - prominently displayed */}
                <div className="mb-3 p-3 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg text-white font-semibold">
                  {line.text}
                </div>
                
                {/* Individual notes for editing - smaller and less prominent */}
                <details className="mb-2">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 mb-2">
                    Individual words ({line.text.split(' ').filter(word => word.trim()).length}) - from CLI phrase
                  </summary>
                  <div className="flex flex-wrap gap-1">
                    {line.text.split(' ').filter(word => word.trim()).map((word, wordIndex) => {
                    const isEditing = false; // Disable editing for now since we're using CLI text
                    
                    if (isEditing) {
                      return (
                        <motion.input
                          key={noteIndex}
                          initial={{ scale: 1.1 }}
                          animate={{ scale: 1 }}
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyPress={(e) => handleKeyPress(e, flatNoteIndex)}
                          onBlur={() => handleEditComplete(flatNoteIndex)}
                          autoFocus
                          className="px-2 py-1 rounded bg-yellow-500 text-black text-sm font-medium min-w-[40px] focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        />
                      );
                    }
                    
                    return (
                      <motion.span
                        key={`${lineIndex}-word-${wordIndex}`}
                        whileHover={{ scale: 1.05 }}
                        className="px-2 py-1 rounded text-xs bg-gray-600 text-gray-100 transition-all duration-200"
                        title="Word from CLI phrase"
                      >
                        {word}
                      </motion.span>
                    );
                  })}
                  </div>
                </details>
                
                {/* Line metadata and controls */}
                <div className="text-xs text-gray-400 flex justify-between items-center">
                  <div>
                    <span>Line {lineIndex + 1}</span>
                    <span className="mx-2">•</span>
                    <span>{line.text.split(' ').filter(word => word.trim()).length} words</span>
                    {useGPU && <span className="mx-2 text-green-400">⚡ GPU</span>}
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {/* Render Button */}
                    <motion.button
                      whileHover={{ scale: renderingLines.has(lineIndex) ? 1 : 1.1 }}
                      whileTap={{ scale: renderingLines.has(lineIndex) ? 1 : 0.9 }}
                      onClick={() => handleLineRender(lineIndex)}
                      disabled={renderingLines.has(lineIndex)}
                      className={`px-2 py-1 text-white rounded text-xs transition-all ${
                        renderingLines.has(lineIndex)
                          ? 'bg-orange-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-500'
                      }`}
                      title={renderingLines.has(lineIndex) ? 'Rendering...' : 'Render this line'}
                    >
                      {renderingLines.has(lineIndex) ? (
                        <div className="flex items-center space-x-1">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-3 h-3 border border-white border-t-transparent rounded-full"
                          />
                          <span>Rendering</span>
                        </div>
                      ) : (
                        '🎵 Render'
                      )}
                    </motion.button>

                    {/* Play Button (only show if audio is available) */}
                    {renderedAudioUrls.has(lineIndex) && (
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => isPlayingLine === lineIndex ? handleLineStop() : handleLinePlay(lineIndex)}
                        className={`px-2 py-1 text-white rounded text-xs transition-colors ${
                          isPlayingLine === lineIndex
                            ? 'bg-red-500 hover:bg-red-400'
                            : 'bg-green-600 hover:bg-green-500'
                        }`}
                        title={isPlayingLine === lineIndex ? 'Stop playback' : 'Play rendered segment'}
                      >
                        {isPlayingLine === lineIndex ? (
                          <div className="flex items-center space-x-1">
                            <div className="w-2 h-2 bg-white rounded-sm" />
                            <span>Stop</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1">
                            <div className="w-0 h-0 border-l-[4px] border-l-white border-y-[2px] border-y-transparent" />
                            <span>Play</span>
                          </div>
                        )}
                      </motion.button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Controls */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="p-4 border-t border-gray-700 bg-gray-750"
      >
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-4">
            <motion.span 
              animate={isPlaying ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 1, repeat: Infinity }}
              className="text-gray-300"
            >
              {isPlaying ? 'Playing' : 'Paused'}
            </motion.span>
            <AnimatePresence>
              {highlightedNoteIndex !== -1 && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="text-purple-400"
                >
                  Note {highlightedNoteIndex + 1} highlighted
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex items-center space-x-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setHighlightedNoteIndex(-1)}
              className="px-3 py-1 text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              Clear highlight
            </motion.button>
          </div>
        </div>
      </motion.div>

    </motion.div>
  );
};

export default LyricsDisplay;