'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { USTXData, USTXNote, PhonemeTiming } from '@/types/openutau';

interface PianoRollNote {
  id: number;
  start: number;
  duration: number;
  pitch: number;
  lyric: string;
  ustxNote: USTXNote;
  pitchCurve: Array<{time: number, deviation: number}>;
  phonemes: Array<{label: string, duration: number}>;
  isExtended: boolean;
}

interface PianoRollProps {
  ustxData?: USTXData;
  phonemeData?: PhonemeTiming[];
  onNoteSelect?: (note: PianoRollNote) => void;
  onNoteEdit?: (note: PianoRollNote) => void;
}

const PianoRoll: React.FC<PianoRollProps> = ({ ustxData, phonemeData, onNoteSelect }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pianoRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const phonemeRef = useRef<HTMLDivElement>(null);
  
  // Constants
  const keysCount = 128; // Full MIDI range (0-127)
  const keyHeight = 20;
  const pianoWidth = 80;
  const beatWidth = 100;
  const totalHeight = keysCount * keyHeight;
  
  // State
  const [notes, setNotes] = useState<PianoRollNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<PianoRollNote | null>(null);
  const [projectInfo, setProjectInfo] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [totalWidth, setTotalWidth] = useState(3200); // Dynamic width based on project length
  const [dragState, setDragState] = useState<{
    type: 'note' | 'resize' | 'pitch' | null;
    note?: PianoRollNote;
    pointIndex?: number;
    startX?: number;
    startY?: number;
    initialValue?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }>({ type: null });

  // Get phoneme data for a specific note
  const getPhonemeDataForNote = useCallback((noteIndex: number, noteDuration: number) => {
    if (!phonemeData) return [];
    
    const notePhonemes = phonemeData.filter(p => p.NoteIndex === noteIndex);
    if (notePhonemes.length === 0) return [];
    
    const phonemes: Array<{label: string, duration: number}> = [];
    let lastTime = 0;
    
    notePhonemes.forEach((ph, i) => {
      const nextTime = i < notePhonemes.length - 1 ? 
        notePhonemes[i + 1].TimeMs : 
        lastTime + (noteDuration * 100);
      
      phonemes.push({
        label: ph.Phoneme,
        duration: (nextTime - lastTime) / 1000
      });
      
      lastTime = nextTime;
    });
    
    return phonemes;
  }, [phonemeData]);

  // Convert USTX pitch curve to piano roll format
  const convertPitchCurve = useCallback((pitchData: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!pitchData || !pitchData.data) return [{ time: 0, deviation: 0 }];
    
    return pitchData.data.map((point: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      time: point.x,
      deviation: point.y * 0.1
    }));
  }, []);

  // Process USTX data
  const processUSTXData = useCallback(() => {
    if (!ustxData) return;
    
    const info = {
      name: ustxData.name || 'Untitled',
      resolution: ustxData.resolution || 480,
      bpm: ustxData.bpm || 120,
      tracks: ustxData.tracks || []
    };
    
    setProjectInfo(info);
    
    const ticksPerPixel = info.resolution / beatWidth;
    const newNotes: PianoRollNote[] = [];
    let maxEndPosition = 0;
    
    if (ustxData.voice_parts && ustxData.voice_parts.length > 0) {
      const part = ustxData.voice_parts[0];
      if (part.notes) {
        part.notes.forEach((note, index) => {
          const start = note.position / ticksPerPixel;
          const duration = note.duration / ticksPerPixel;
          const endPosition = start + duration;
          
          if (endPosition > maxEndPosition) {
            maxEndPosition = endPosition;
          }
          
          const pianoNote: PianoRollNote = {
            id: index,
            start,
            duration,
            pitch: note.tone, // Use full MIDI range 0-127
            lyric: note.lyric || '',
            ustxNote: note,
            pitchCurve: convertPitchCurve(note.pitch),
            phonemes: getPhonemeDataForNote(index, note.duration / ticksPerPixel),
            isExtended: note.lyric === '+'
          };
          newNotes.push(pianoNote);
        });
      }
    }
    
    // Calculate dynamic width with padding
    const minWidth = 8000; // Increased minimum to ensure scrollbar appears
    const padding = 3000; // Extra space at the end
    const calculatedWidth = Math.max(minWidth, maxEndPosition + padding);
    console.log('Setting totalWidth to:', calculatedWidth, 'maxEndPosition:', maxEndPosition);
    setTotalWidth(calculatedWidth);
    
    setNotes(newNotes);
  }, [ustxData, convertPitchCurve, getPhonemeDataForNote]);

  // Piano key utilities
  const midiToNoteName = (midi: number) => {
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const note = noteNames[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return note + octave;
  };

  const isBlackKey = (midi: number) => {
    const name = midiToNoteName(midi);
    return name.includes("#");
  };

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent, note: PianoRollNote) => {
    e.preventDefault();
    setSelectedNote(note);
    onNoteSelect?.(note);
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    setDragState({
      type: 'note',
      note,
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      initialValue: { start: note.start, pitch: note.pitch }
    });
  };


  const handleMouseUp = () => {
    setDragState({ type: null });
  };

  // Render functions
  const renderPiano = () => {
    const keys = [];
    for (let i = keysCount - 1; i >= 0; i--) {
      const midi = i; // Full MIDI range 0-127
      const isBlack = isBlackKey(midi);
      
      keys.push(
        <div
          key={i}
          className={`
            h-5 border-b border-gray-400 text-center text-xs leading-5
            ${isBlack ? 'bg-black text-white' : 'bg-white text-black'}
          `}
          style={{ fontSize: '8px' }}
        >
          {midiToNoteName(midi)}
        </div>
      );
    }
    
    return keys;
  };

  const renderGrid = () => {
    const lines = [];
    const innerHeight = keysCount * keyHeight;
    const gridWidth = Math.max(totalWidth, 10000); // Generate grid lines based on totalWidth
    
    // Horizontal lines
    for (let i = 0; i <= keysCount; i++) {
      lines.push(
        <div
          key={`h-${i}`}
          className="absolute bg-gray-600"
          style={{
            top: i * keyHeight,
            left: 0,
            width: gridWidth,
            height: 1
          }}
        />
      );
    }
    
    // Vertical lines (beats) - Add more subdivisions
    const subBeatWidth = beatWidth / 4; // Quarter beat subdivisions
    // Generate lines every 25px across the extended width
    for (let i = 0; i * subBeatWidth <= gridWidth; i++) {
      const isBeat = i % 4 === 0;
      const isMeasure = i % 16 === 0;
      
      lines.push(
        <div
          key={`v-${i}`}
          className={`absolute ${isMeasure ? 'bg-gray-400' : isBeat ? 'bg-gray-500' : 'bg-gray-700'}`}
          style={{
            left: i * subBeatWidth,
            top: 0,
            width: isMeasure ? 2 : isBeat ? 1 : 1,
            height: innerHeight,
            opacity: isBeat ? 1 : 0.3
          }}
        />
      );
    }
    
    return lines;
  };

  const renderNotes = () => {
    const innerHeight = keysCount * keyHeight;
    
    return notes.map(note => (
      <div
        key={note.id}
        className={`
          absolute border cursor-move text-xs p-1 overflow-hidden whitespace-nowrap
          ${note.isExtended 
            ? 'bg-orange-200 border-orange-400 border-dashed' 
            : 'bg-orange-400 border-orange-600'
          }
          ${selectedNote?.id === note.id ? 'ring-2 ring-blue-500' : ''}
        `}
        style={{
          left: note.start,
          top: innerHeight - (note.pitch + 1) * keyHeight,
          width: note.duration,
          height: keyHeight - 2
        }}
        onMouseDown={(e) => handleMouseDown(e, note)}
      >
        {note.lyric}
        {!note.isExtended && (
          <div 
            className="absolute right-0 top-0 w-2 h-full bg-white/70 cursor-e-resize"
            onMouseDown={(e) => {
              e.stopPropagation();
              // TODO: Implement resize
            }}
          />
        )}
      </div>
    ));
  };

  // OpenUtau-style interpolation functions
  const interpolateShape = (x0: number, x1: number, y0: number, y1: number, x: number, shape: string) => {
    if (x1 === x0) return y0;
    
    const t = (x - x0) / (x1 - x0);
    let ease = t;
    
    switch (shape) {
      case 'l': // Linear
        ease = t;
        break;
      case 'i': // Sine in
        ease = 1 - Math.cos(t * Math.PI / 2);
        break;
      case 'o': // Sine out
        ease = Math.sin(t * Math.PI / 2);
        break;
      case 'io': // Sine in-out
        ease = 0.5 * (1 - Math.cos(t * Math.PI));
        break;
      default:
        ease = t;
    }
    
    return y0 + (y1 - y0) * ease;
  };

  const renderPitchCurve = () => {
    if (!svgRef.current) return null;
    
    const innerHeight = keysCount * keyHeight;
    const allPoints: Array<{x: number, y: number, shape: string}> = [];
    
    // Collect all pitch points from all notes
    notes.forEach(note => {
      const baseY = innerHeight - (note.pitch + 1) * keyHeight + keyHeight / 2;
      note.pitchCurve.forEach(pt => {
        allPoints.push({
          x: note.start + pt.time,
          y: baseY - pt.deviation,
          shape: 'io' // Default to sine in-out
        });
      });
    });
    
    if (allPoints.length < 2) return null;
    
    // Sort points by x position
    allPoints.sort((a, b) => a.x - b.x);
    
    // Generate smooth curve using OpenUtau's sampling method
    const smoothPoints: Array<{x: number, y: number}> = [];
    
    for (let i = 0; i < allPoints.length - 1; i++) {
      const p0 = allPoints[i];
      const p1 = allPoints[i + 1];
      
      // Sample at 4-pixel intervals like OpenUtau
      const distance = p1.x - p0.x;
      const sampleInterval = 4;
      
      if (distance > sampleInterval) {
        for (let x = p0.x; x < p1.x; x += sampleInterval) {
          const y = interpolateShape(p0.x, p1.x, p0.y, p1.y, x, p0.shape);
          smoothPoints.push({ x, y });
        }
      }
      
      // Always add the end point
      smoothPoints.push({ x: p1.x, y: p1.y });
    }
    
    // Add the first point
    if (allPoints.length > 0) {
      smoothPoints.unshift({ x: allPoints[0].x, y: allPoints[0].y });
    }
    
    // Create smooth SVG path
    const pathData = smoothPoints.length > 0 ? 
      `M ${smoothPoints[0].x} ${smoothPoints[0].y} ` + 
      smoothPoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') : '';
    
    return (
      <g>
        <path
          d={pathData}
          stroke="#00ff00"
          strokeWidth="2"
          fill="none"
        />
        {/* Render control points */}
        {allPoints.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r="4"
            fill="#ff0000"
            stroke="#fff"
            strokeWidth="1"
            className="cursor-pointer"
          />
        ))}
      </g>
    );
  };

  const renderPhonemes = () => {
    return notes.map(note => {
      if (!note.phonemes || note.phonemes.length === 0) return null;
      
      const totalDuration = note.phonemes.reduce((sum, ph) => sum + ph.duration, 0);
      
      return (
        <div
          key={note.id}
          className="absolute h-full border border-gray-500"
          style={{
            left: note.start,
            width: note.duration
          }}
        >
          {note.phonemes.map((phoneme, i) => {
            const width = totalDuration > 0 ? (phoneme.duration / totalDuration) * note.duration : note.duration;
            return (
              <div
                key={i}
                className="inline-block h-full bg-blue-300 text-black text-center text-xs border-r border-gray-500 p-1"
                style={{ width }}
              >
                {phoneme.label}
              </div>
            );
          })}
        </div>
      );
    });
  };

  // Effects
  useEffect(() => {
    processUSTXData();
  }, [processUSTXData]);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (dragState.type === 'note' && dragState.note) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const deltaX = e.clientX - rect.left - (dragState.startX || 0);
        const deltaY = e.clientY - rect.top - (dragState.startY || 0);
        
        const newStart = Math.max(0, dragState.initialValue.start + deltaX);
        const newPitch = Math.max(0, Math.min(127, dragState.initialValue.pitch - Math.round(deltaY / keyHeight)));
        
        const updatedNotes = notes.map(n => 
          n.id === dragState.note!.id 
            ? { ...n, start: newStart, pitch: newPitch }
            : n
        );
        
        setNotes(updatedNotes);
      }
    };
    
    const handleGlobalMouseUp = () => {
      handleMouseUp();
    };
    
    if (dragState.type) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [dragState, notes, keyHeight]);

  if (!ustxData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Load a USTX file to begin
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-gray-900 text-white">
      {/* Main container */}
      <div className="w-full h-full flex flex-col">
        {/* Piano roll area */}
        <div className="flex-1 flex min-h-0">
          {/* Piano keys column */}
          <div 
            className="bg-gray-400 border-r border-gray-600 text-black flex-shrink-0"
            style={{ width: pianoWidth }}
          >
            <div 
              ref={pianoRef}
              className="overflow-y-auto"
              style={{ height: 'calc(100vh - 200px)', width: pianoWidth }}
              onScroll={(e) => {
                if (containerRef.current) {
                  containerRef.current.scrollTop = e.currentTarget.scrollTop;
                }
              }}
            >
              <div style={{ height: totalHeight, width: pianoWidth }}>
                {renderPiano()}
              </div>
            </div>
          </div>
          
          {/* Scrollable piano roll content */}
          <div className="flex-1 min-w-0 relative">
            <div 
              ref={containerRef}
              className="bg-gray-800 absolute inset-0 overflow-auto"
              onScroll={(e) => {
                // Sync vertical scroll with piano keys
                if (pianoRef.current) {
                  pianoRef.current.scrollTop = e.currentTarget.scrollTop;
                }
                // Sync horizontal scroll with phoneme panel by transforming it
                if (phonemeRef.current) {
                  phonemeRef.current.style.transform = `translateX(-${e.currentTarget.scrollLeft}px)`;
                }
              }}
            >
              {/* Force the content to be the exact totalWidth */}
              <div 
                className="relative bg-gray-800"
                style={{ 
                  width: totalWidth + 'px',
                  height: totalHeight + 'px',
                  minWidth: totalWidth + 'px',
                  minHeight: totalHeight + 'px'
                }}
              >
                {/* Grid */}
                <div className="absolute inset-0" style={{ width: totalWidth + 'px', height: totalHeight + 'px' }}>
                  {renderGrid()}
                </div>
                
                {/* Notes */}
                <div 
                  ref={notesRef}
                  className="absolute inset-0 z-10"
                  style={{ width: totalWidth + 'px', height: totalHeight + 'px' }}
                >
                  {renderNotes()}
                </div>
                
                {/* Pitch curve SVG */}
                <svg
                  ref={svgRef}
                  className="absolute inset-0 z-20 pointer-events-none"
                  style={{ width: totalWidth + 'px', height: totalHeight + 'px' }}
                >
                  {renderPitchCurve()}
                </svg>
              </div>
            </div>
          </div>
        </div>
        
        {/* Phoneme panel */}
        <div className="flex h-10 border-t border-gray-600">
          <div 
            className="bg-gray-700 border-r border-gray-600 flex-shrink-0"
            style={{ width: pianoWidth }}
          />
          <div className="flex-1 min-w-0 relative">
            <div 
              className="bg-gray-700 absolute inset-0 overflow-hidden"
            >
              <div 
                ref={phonemeRef}
                className="relative h-full"
                style={{ 
                  width: totalWidth + 'px',
                  minWidth: totalWidth + 'px',
                  height: '40px'
                }}
              >
                {renderPhonemes()}
              </div>
            </div>
          </div>
        </div>
        
        {/* Info panel */}
        <div className="bg-gray-800 border-t border-gray-600 p-2 text-sm">
          {projectInfo && (
            <div className="flex gap-4">
              <span>Project: {projectInfo.name}</span>
              <span>Resolution: {projectInfo.resolution}</span>
              <span>BPM: {projectInfo.bpm}</span>
              <span>Notes: {notes.length}</span>
              <span>Total Width: {totalWidth}px</span>
              {selectedNote && (
                <span>Selected: {selectedNote.lyric} (MIDI {selectedNote.pitch})</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PianoRoll;