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
  onSegmentRender
}) => {
  const [lyricsLines, setLyricsLines] = useState<LyricsLine[]>([]);
  const [highlightedNoteIndex, setHighlightedNoteIndex] = useState<number>(-1);
  const [editingNoteIndex, setEditingNoteIndex] = useState<number>(-1);
  const [editingValue, setEditingValue] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Process USTX data into lyrics lines using enhanced USTXLyricsManager
  useEffect(() => {
    if (!ustxData?.voice_parts) return;

    console.log('LYRICS DISPLAY: Processing with phoneme data:', !!phonemeData);
    
    // Use USTXLyricsManager for consistent phrase detection
    const lyricsManager = new USTXLyricsManager(ustxData, phonemeData);
    const verses = lyricsManager.detectVerses();
    
    console.log('LYRICS DISPLAY: Detected verses:', verses.length);
    
    // Flatten all notes from all voice parts, filtering like USTXLyricsManager
    const allNotes = ustxData.voice_parts.flatMap(part => 
      part.notes || []
    )
    .filter(note => 
      note.lyric && 
      note.lyric.trim() !== '' && 
      !note.lyric.startsWith('+')  // Exclude syllable extensions like DiffSinger
    )
    .sort((a, b) => a.position - b.position);

    // Convert verses to display lines using the actual detected note indices
    const lines: LyricsLine[] = verses.map(verse => {
      // Use the actual note indices from phrase detection
      const verseNotes = allNotes.slice(verse.startNoteIndex, verse.endNoteIndex + 1);
      
      console.log(`LYRICS DISPLAY: Creating line: "${verse.lyrics}" (notes ${verse.startNoteIndex}-${verse.endNoteIndex})`);
      
      return {
        notes: verseNotes,
        startTime: verseNotes[0]?.position || 0,
        endTime: verseNotes[verseNotes.length - 1]?.position + verseNotes[verseNotes.length - 1]?.duration || 0,
        text: verse.lyrics,
      };
    }).filter(line => line.text.trim().length > 0);

    setLyricsLines(lines);
  }, [ustxData, phonemeData]);

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

  const handleLineRender = (lineIndex: number) => {
    const line = lyricsLines[lineIndex];
    if (!line || !onSegmentRender) return;

    const allNotes = ustxData?.voice_parts?.flatMap(part => part.notes || []) || [];
    const startNoteIndex = allNotes.indexOf(line.notes[0]);
    const endNoteIndex = allNotes.indexOf(line.notes[line.notes.length - 1]);

    if (startNoteIndex !== -1 && endNoteIndex !== -1) {
      onSegmentRender(startNoteIndex, endNoteIndex, lineIndex);
    }
  };

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
                <div className="flex flex-wrap gap-1 mb-2">
                  {line.notes.map((note, noteIndex) => {
                    const flatNoteIndex = ustxData.voice_parts
                      .flatMap(part => part.notes || [])
                      .indexOf(note);
                    
                    const isHighlighted = highlightedNoteIndex === flatNoteIndex;
                    const isEditing = editingNoteIndex === flatNoteIndex;
                    
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
                        key={noteIndex}
                        data-note-index={flatNoteIndex}
                        onClick={() => handleNoteClick(note)}
                        onDoubleClick={() => handleNoteDoubleClick(note, flatNoteIndex)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        animate={isHighlighted ? { 
                          scale: [1, 1.1, 1], 
                          boxShadow: '0 0 20px rgba(168, 85, 247, 0.5)' 
                        } : {}}
                        className={`
                          px-2 py-1 rounded cursor-pointer transition-all duration-200
                          ${isHighlighted 
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg' 
                            : 'bg-gray-600 hover:bg-gray-500 text-gray-100'
                          }
                        `}
                        title="Double-click to edit"
                      >
                        {note.lyric === '+' ? '' : (() => {
                          // Check if this note has an SP phoneme override
                          const hasSPOverride = note.phoneme_overrides?.some(override => override.phoneme === 'SP');
                          return hasSPOverride ? 'SP' : note.lyric;
                        })()}
                      </motion.span>
                    );
                  })}
                </div>
                
                {/* Line metadata */}
                <div className="text-xs text-gray-400 flex justify-between items-center">
                  <div>
                    <span>Line {lineIndex + 1}</span>
                    <span className="mx-2">•</span>
                    <span>{line.notes.length} notes</span>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleLineRender(lineIndex)}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs transition-colors"
                    title="Render this line"
                  >
                    🎵 Render
                  </motion.button>
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