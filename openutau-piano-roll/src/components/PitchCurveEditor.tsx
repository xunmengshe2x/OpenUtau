'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

export interface PitchPoint {
  x: number; // Position along note (0-100%)
  y: number; // Pitch offset in cents (-1200 to +1200)
}

export interface PitchCurve {
  id: string;
  noteIndex: number;
  points: PitchPoint[];
  shape: 'linear' | 'arch' | 'valley' | 'wave' | 'custom';
  color?: string;
  name?: string;
  isVibrato?: boolean;
}

interface PitchCurveEditorProps {
  verse?: number;
  curves: PitchCurve[];
  onCurvesChange: (curves: PitchCurve[]) => void;
  onClose: () => void;
  noteCount?: number;
}

export default function PitchCurveEditor({ 
  verse, 
  curves, 
  onCurvesChange, 
  onClose, 
  noteCount = 8 
}: PitchCurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedCurve, setSelectedCurve] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<'draw' | 'erase'>('draw');

  // Canvas dimensions
  const canvasWidth = 800;
  const canvasHeight = 400;
  const noteWidth = canvasWidth / noteCount;
  const centerY = canvasHeight / 2;
  const maxPitchCents = 600; // ±600 cents range

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw background
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw grid lines
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;

    // Vertical lines (note separators)
    for (let i = 0; i <= noteCount; i++) {
      const x = i * noteWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    // Horizontal lines (pitch levels)
    const pitchLines = [-600, -300, 0, 300, 600]; // cents
    pitchLines.forEach(cents => {
      const y = centerY - (cents / maxPitchCents) * (canvasHeight / 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      if (cents === 0) {
        ctx.strokeStyle = '#6b7280'; // Center line more visible
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
    });

    // Draw note labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < noteCount; i++) {
      const x = (i + 0.5) * noteWidth;
      ctx.fillText(`Note ${i + 1}`, x, 20);
    }

    // Draw pitch level labels
    ctx.textAlign = 'left';
    pitchLines.forEach(cents => {
      const y = centerY - (cents / maxPitchCents) * (canvasHeight / 2);
      ctx.fillText(`${cents > 0 ? '+' : ''}${cents}¢`, 5, y - 5);
    });

    // Draw curves
    curves.forEach(curve => {
      const startX = curve.noteIndex * noteWidth;
      const endX = (curve.noteIndex + 1) * noteWidth;

      ctx.strokeStyle = selectedCurve === curve.id ? '#3b82f6' : '#10b981';
      ctx.lineWidth = selectedCurve === curve.id ? 3 : 2;
      ctx.beginPath();

      if (curve.points.length === 0) return;

      // Draw curve
      curve.points.forEach((point, index) => {
        const x = startX + (point.x / 100) * noteWidth;
        const y = centerY - (point.y / maxPitchCents) * (canvasHeight / 2);
        
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw control points
      ctx.fillStyle = selectedCurve === curve.id ? '#3b82f6' : '#10b981';
      curve.points.forEach(point => {
        const x = startX + (point.x / 100) * noteWidth;
        const y = centerY - (point.y / maxPitchCents) * (canvasHeight / 2);
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    });
  }, [curves, selectedCurve, noteCount, canvasWidth, canvasHeight, noteWidth, centerY, maxPitchCents]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCanvasCoordinates = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(event);
    const noteIndex = Math.floor(x / noteWidth);
    
    if (noteIndex >= noteCount || noteIndex < 0) return;

    setIsDrawing(true);

    if (drawMode === 'draw') {
      // Create or modify curve
      const existingCurve = curves.find(c => c.noteIndex === noteIndex);
      const pitchOffset = -((y - centerY) / (canvasHeight / 2)) * maxPitchCents;
      const position = ((x - noteIndex * noteWidth) / noteWidth) * 100;

      if (existingCurve) {
        // Add point to existing curve
        const newPoints = [...existingCurve.points, { x: position, y: pitchOffset }]
          .sort((a, b) => a.x - b.x);
        
        const updatedCurves = curves.map(c => 
          c.id === existingCurve.id ? { ...c, points: newPoints, shape: 'custom' as const } : c
        );
        onCurvesChange(updatedCurves);
        setSelectedCurve(existingCurve.id);
      } else {
        // Create new curve
        const newCurve: PitchCurve = {
          id: `curve_${noteIndex}_${Date.now()}`,
          noteIndex,
          points: [{ x: position, y: pitchOffset }],
          shape: 'custom'
        };
        onCurvesChange([...curves, newCurve]);
        setSelectedCurve(newCurve.id);
      }
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || drawMode !== 'draw' || !selectedCurve) return;

    const { x, y } = getCanvasCoordinates(event);
    const curve = curves.find(c => c.id === selectedCurve);
    if (!curve) return;

    const pitchOffset = -((y - centerY) / (canvasHeight / 2)) * maxPitchCents;
    const position = ((x - curve.noteIndex * noteWidth) / noteWidth) * 100;

    // Clamp values
    const clampedPitch = Math.max(-maxPitchCents, Math.min(maxPitchCents, pitchOffset));
    const clampedPosition = Math.max(0, Math.min(100, position));

    // Add new point
    const newPoints = [...curve.points, { x: clampedPosition, y: clampedPitch }]
      .sort((a, b) => a.x - b.x);
    
    const updatedCurves = curves.map(c => 
      c.id === selectedCurve ? { ...c, points: newPoints } : c
    );
    onCurvesChange(updatedCurves);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const clearCurve = (curveId: string) => {
    const updatedCurves = curves.filter(c => c.id !== curveId);
    onCurvesChange(updatedCurves);
    if (selectedCurve === curveId) {
      setSelectedCurve(null);
    }
  };

  const addPresetCurve = (noteIndex: number, shape: 'arch' | 'valley' | 'wave') => {
    const points: PitchPoint[] = [];
    const intensity = 400; // cents

    switch (shape) {
      case 'arch':
        points.push(
          { x: 0, y: 0 },
          { x: 25, y: intensity * 0.7 },
          { x: 50, y: intensity },
          { x: 75, y: intensity * 0.7 },
          { x: 100, y: 0 }
        );
        break;
      case 'valley':
        points.push(
          { x: 0, y: 0 },
          { x: 25, y: -intensity * 0.7 },
          { x: 50, y: -intensity },
          { x: 75, y: -intensity * 0.7 },
          { x: 100, y: 0 }
        );
        break;
      case 'wave':
        points.push(
          { x: 0, y: 0 },
          { x: 20, y: intensity },
          { x: 40, y: -intensity * 0.5 },
          { x: 60, y: intensity * 0.5 },
          { x: 80, y: -intensity },
          { x: 100, y: 0 }
        );
        break;
    }

    const newCurve: PitchCurve = {
      id: `preset_${noteIndex}_${shape}_${Date.now()}`,
      noteIndex,
      points,
      shape
    };

    // Remove existing curve for this note
    const filteredCurves = curves.filter(c => c.noteIndex !== noteIndex);
    onCurvesChange([...filteredCurves, newCurve]);
    setSelectedCurve(newCurve.id);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div className="bg-gray-900 rounded-lg p-6 max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">
            🎵 Pitch Curve Editor {verse && `- Verse ${verse}`}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setDrawMode('draw')}
              className={`px-4 py-2 rounded ${
                drawMode === 'draw'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              ✏️ Draw
            </button>
            <button
              onClick={() => setDrawMode('erase')}
              className={`px-4 py-2 rounded ${
                drawMode === 'erase'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🗑️ Erase
            </button>
          </div>

          <div className="flex gap-2">
            <span className="text-gray-300 text-sm">Quick Presets:</span>
            {[1, 2, 3, 4].map(noteIndex => (
              <div key={noteIndex} className="flex gap-1">
                <button
                  onClick={() => addPresetCurve(noteIndex - 1, 'arch')}
                  className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                  title={`Add arch curve to note ${noteIndex}`}
                >
                  ⌒{noteIndex}
                </button>
                <button
                  onClick={() => addPresetCurve(noteIndex - 1, 'valley')}
                  className="px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700"
                  title={`Add valley curve to note ${noteIndex}`}
                >
                  ⌒̃{noteIndex}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="border border-gray-700 rounded-lg overflow-hidden mb-4">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="cursor-crosshair bg-gray-800"
            style={{ width: '100%', height: 'auto' }}
          />
        </div>

        {/* Curve List */}
        <div className="mb-4">
          <h3 className="text-white font-medium mb-2">Current Curves:</h3>
          <div className="space-y-2">
            {curves.length === 0 ? (
              <p className="text-gray-400 text-sm">No curves defined. Click on the canvas to draw!</p>
            ) : (
              curves.map(curve => (
                <div 
                  key={curve.id}
                  className={`flex items-center justify-between p-2 rounded ${
                    selectedCurve === curve.id
                      ? 'bg-blue-900 border border-blue-600'
                      : 'bg-gray-800 border border-gray-700'
                  }`}
                >
                  <span className="text-gray-300">
                    Note {curve.noteIndex + 1} - {curve.shape} ({curve.points.length} points)
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedCurve(curve.id)}
                      className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                    >
                      Select
                    </button>
                    <button
                      onClick={() => clearCurve(curve.id)}
                      className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium"
          >
            Apply Curves
          </button>
        </div>
      </div>
    </motion.div>
  );
}