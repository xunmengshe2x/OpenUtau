'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { USTXData, USTXNote, PitchPoint } from '@/types/openutau';
import { VersePitchExtractor, VersePitchData } from '@/utils/pitchUtils';

interface VersePianoRollProps {
  ustxData: USTXData;
  verseNumber: number;
  versePitchData: VersePitchData;
  onPitchChange?: (noteIndex: number, pitchPoints: PitchPoint[]) => void;
  onClose?: () => void;
  onApply?: () => void;
}

const VersePianoRoll: React.FC<VersePianoRollProps> = ({ 
  ustxData, 
  verseNumber, 
  versePitchData,
  onPitchChange,
  onClose,
  onApply
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Constants
  const keyHeight = 16;  // Smaller than full piano roll
  const beatWidth = 120; // More zoomed in for verse view
  const pianoWidth = 60;
  
  // Calculate pitch range based on verse notes
  const verseNotes = versePitchData.notes.map(n => n.note);
  const minTone = Math.min(...verseNotes.map(n => n.tone)) - 2;
  const maxTone = Math.max(...verseNotes.map(n => n.tone)) + 2;
  const visibleKeys = maxTone - minTone + 1;
  const totalHeight = visibleKeys * keyHeight;
  
  // Calculate width based on verse duration
  const bpm = ustxData.bpm || 120;
  const resolution = ustxData.resolution || 480;
  const beatsPerSecond = bpm / 60;
  const ticksPerBeat = resolution;
  const verseDurationTicks = versePitchData.timeRange.endMs - versePitchData.timeRange.startMs;
  const totalWidth = Math.max(800, (verseDurationTicks / (ticksPerBeat * 1000 / beatsPerSecond)) * beatWidth);
  
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'note' | 'pitch'>('pitch');
  
  // Convert tone to Y position
  const toneToY = (tone: number) => {
    return (maxTone - tone) * keyHeight;
  };
  
  // Convert Y position to tone
  const yToTone = (y: number) => {
    return maxTone - Math.floor(y / keyHeight);
  };
  
  // Convert position to X coordinate
  const positionToX = (position: number) => {
    const relativePosition = position - versePitchData.timeRange.startMs;
    return pianoWidth + (relativePosition / versePitchData.timeRange.durationMs) * (totalWidth - pianoWidth);
  };
  
  // Get note name from MIDI number
  const getNoteLabel = (tone: number) => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(tone / 12) - 1;
    const note = notes[tone % 12];
    return `${note}${octave}`;
  };
  
  // Check if key is black key
  const isBlackKey = (tone: number) => {
    const noteIndex = tone % 12;
    return [1, 3, 6, 8, 10].includes(noteIndex); // C#, D#, F#, G#, A#
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (!svgRef.current) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if clicking on a note
    const clickedNoteIndex = versePitchData.notes.findIndex(noteData => {
      const note = noteData.note;
      const noteX = positionToX(note.position * (60 * 1000) / (bpm * resolution));
      const noteWidth = (note.duration * (60 * 1000) / (bpm * resolution)) / versePitchData.timeRange.durationMs * (totalWidth - pianoWidth);
      const noteY = toneToY(note.tone);
      
      return x >= noteX && x <= noteX + noteWidth && 
             y >= noteY && y <= noteY + keyHeight;
    });
    
    if (clickedNoteIndex !== -1) {
      setSelectedNoteIndex(clickedNoteIndex);
      setIsDragging(true);
      setDragMode('pitch');
    }
  }, [versePitchData, bpm, resolution, totalWidth]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (!isDragging || selectedNoteIndex === null || !svgRef.current) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const newTone = yToTone(y);
    
    // Update pitch if in pitch drag mode
    if (dragMode === 'pitch' && onPitchChange) {
      // For now, just change the base tone - could be enhanced to modify pitch curves
      const pitchPoints: PitchPoint[] = [
        { x: -25, y: 0, shape: 'io' as any },
        { x: 25, y: 0, shape: 'io' as any }
      ];
      onPitchChange(selectedNoteIndex, pitchPoints);
    }
  }, [isDragging, selectedNoteIndex, dragMode, onPitchChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <div>
          <h3 className="text-lg font-semibold">Verse {verseNumber} - Piano Roll</h3>
          <p className="text-sm text-gray-400">
            {versePitchData.notes.length} notes • {Math.round(versePitchData.timeRange.durationMs / 1000)}s
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={onApply}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
          >
            Apply Changes
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="p-2 bg-blue-900/20 border-b border-blue-700/30">
        <p className="text-xs text-blue-300">
          💡 Click and drag notes to change pitch • Right-click to add/edit pitch curves
        </p>
      </div>

      {/* Piano Roll Container */}
      <div 
        ref={containerRef}
        className="flex-1 relative overflow-auto bg-gray-850"
        style={{ height: totalHeight + 40 }}
      >
        {/* Piano Keys */}
        <div 
          className="absolute left-0 top-0 z-10 bg-gray-800 border-r border-gray-600"
          style={{ width: pianoWidth, height: totalHeight }}
        >
          {Array.from({ length: visibleKeys }, (_, i) => {
            const tone = maxTone - i;
            const isBlack = isBlackKey(tone);
            
            return (
              <div
                key={tone}
                className={`
                  border-b border-gray-600 flex items-center justify-end pr-2 text-xs
                  ${isBlack 
                    ? 'bg-gray-900 text-gray-300' 
                    : 'bg-gray-100 text-gray-800'
                  }
                `}
                style={{ 
                  height: keyHeight,
                  top: i * keyHeight 
                }}
              >
                {!isBlack && getNoteLabel(tone)}
              </div>
            );
          })}
        </div>

        {/* Main Roll Area */}
        <svg
          ref={svgRef}
          className="absolute"
          style={{ 
            left: pianoWidth, 
            width: totalWidth - pianoWidth, 
            height: totalHeight,
            cursor: isDragging ? 'grabbing' : 'default'
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Grid Lines */}
          <defs>
            <pattern id="grid" width="30" height={keyHeight} patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 16" fill="none" stroke="#374151" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          {/* Beat Lines */}
          {Array.from({ length: Math.ceil(totalWidth / beatWidth) }, (_, i) => (
            <line
              key={i}
              x1={i * beatWidth}
              y1={0}
              x2={i * beatWidth}
              y2={totalHeight}
              stroke="#6B7280"
              strokeWidth={i % 4 === 0 ? "1" : "0.5"}
              opacity={0.3}
            />
          ))}

          {/* Notes */}
          {versePitchData.notes.map((noteData, index) => {
            const note = noteData.note;
            const msPerTick = (60 * 1000) / (bpm * resolution);
            const noteStartMs = note.position * msPerTick;
            const noteDurationMs = note.duration * msPerTick;
            
            const x = positionToX(noteStartMs);
            const width = (noteDurationMs / versePitchData.timeRange.durationMs) * (totalWidth - pianoWidth);
            const y = toneToY(note.tone);
            const isSelected = selectedNoteIndex === index;
            
            return (
              <g key={index}>
                {/* Note Rectangle */}
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={keyHeight - 1}
                  fill={isSelected ? "#8B5CF6" : "#3B82F6"}
                  stroke={isSelected ? "#A78BFA" : "#60A5FA"}
                  strokeWidth={isSelected ? "2" : "1"}
                  rx="2"
                  className="hover:brightness-110 cursor-pointer transition-all"
                />
                
                {/* Note Label */}
                <text
                  x={x + 4}
                  y={y + keyHeight - 3}
                  fontSize="10"
                  fill="white"
                  className="pointer-events-none select-none"
                >
                  {note.lyric}
                </text>
                
                {/* Pitch Curve */}
                {note.pitch?.data && note.pitch.data.length > 1 && (
                  <polyline
                    points={note.pitch.data.map((point, i) => {
                      const pointX = x + (point.x / noteDurationMs) * width;
                      const pointY = y + keyHeight/2 - (point.y * 0.1 * keyHeight/2); // Convert 0.1 semitones to pixels
                      return `${pointX},${pointY}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="2"
                    opacity="0.8"
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default VersePianoRoll;