'use client';

import React, { useState } from 'react';
import PitchCurveEditor, { PitchCurve } from './PitchCurveEditor';

export interface PitchControlSettings {
  type: 'shift' | 'transition' | 'curve' | 'vibrato';
  power: number; // 0-100
  direction: 'up' | 'down' | 'high-to-low' | 'low-to-high';
  intensity: 'subtle' | 'normal' | 'dramatic';
  verse?: number;
  curveShape?: 'linear' | 'arch' | 'valley' | 'wave';
  customCurves?: PitchCurve[];
}

interface PitchControlPanelProps {
  verse?: number;
  onApply: (settings: PitchControlSettings) => void;
  onCancel: () => void;
  onPreview: (settings: PitchControlSettings) => void;
}

export default function PitchControlPanel({ 
  verse, 
  onApply, 
  onCancel, 
  onPreview 
}: PitchControlPanelProps) {
  const [settings, setSettings] = useState<PitchControlSettings>({
    type: 'shift',
    power: 50,
    direction: 'up',
    intensity: 'normal',
    verse,
    curveShape: 'linear'
  });

  const [showCurveEditor, setShowCurveEditor] = useState(false);

  const handleSettingChange = (updates: Partial<PitchControlSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    // Auto-preview on change
    onPreview(newSettings);
  };

  const powerToSemitones = (power: number) => {
    return Math.round((power / 100) * 12); // 0-12 semitones
  };

  const getPowerBar = (power: number) => {
    const filled = Math.round((power / 100) * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 max-w-md mx-auto my-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">
          🎛️ Pitch Controls {verse && `- Verse ${verse}`}
        </h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-white text-xl"
        >
          ×
        </button>
      </div>

      {/* Attack Style */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Attack Style
        </label>
        <div className="flex gap-2">
          {['shift', 'transition', 'curve', 'vibrato'].map((type) => (
            <button
              key={type}
              onClick={() => handleSettingChange({ type: type as any })}
              className={`px-3 py-1 rounded text-sm font-medium ${
                settings.type === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Power Level */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Power Level: {getPowerBar(settings.power)} {powerToSemitones(settings.power)} semitones
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={settings.power}
          onChange={(e) => handleSettingChange({ power: parseInt(e.target.value) })}
          className="w-full h-3 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${settings.power}%, #374151 ${settings.power}%, #374151 100%)`
          }}
        />
      </div>

      {/* Direction */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Direction
        </label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'up', label: '↑ Up', desc: 'Higher pitch' },
            { value: 'down', label: '↓ Down', desc: 'Lower pitch' },
            { value: 'high-to-low', label: '↘ High→Low', desc: 'Start high, end low' },
            { value: 'low-to-high', label: '↗ Low→High', desc: 'Start low, end high' }
          ].map((dir) => (
            <button
              key={dir.value}
              onClick={() => handleSettingChange({ direction: dir.value as any })}
              className={`p-2 rounded text-sm ${
                settings.direction === dir.value
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title={dir.desc}
            >
              {dir.label}
            </button>
          ))}
        </div>
      </div>

      {/* Curve Shape (only for curve type) */}
      {settings.type === 'curve' && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Curve Shape
          </label>
          <div className="flex gap-2 mb-2">
            {['linear', 'arch', 'valley', 'wave'].map((shape) => (
              <button
                key={shape}
                onClick={() => handleSettingChange({ curveShape: shape as any })}
                className={`px-3 py-1 rounded text-sm ${
                  settings.curveShape === shape
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {shape}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCurveEditor(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded text-sm font-medium"
          >
            🎨 Advanced Curve Editor
          </button>
        </div>
      )}

      {/* Intensity */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Intensity
        </label>
        <div className="flex gap-2">
          {['subtle', 'normal', 'dramatic'].map((level) => (
            <button
              key={level}
              onClick={() => handleSettingChange({ intensity: level as any })}
              className={`px-4 py-2 rounded text-sm font-medium ${
                settings.intensity === level
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => onPreview(settings)}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded font-medium"
        >
          🎵 Preview
        </button>
        <button
          onClick={() => onApply(settings)}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded font-medium"
        >
          ✅ Apply
        </button>
        <button
          onClick={onCancel}
          className="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded font-medium"
        >
          Cancel
        </button>
      </div>

      {/* Curve Editor Modal */}
      {showCurveEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-4xl w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">Advanced Pitch Curve Editor</h2>
              <button
                onClick={() => setShowCurveEditor(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>
            <PitchCurveEditor
              curves={settings.customCurves || []}
              onCurvesChange={(curves) => handleSettingChange({ customCurves: curves })}
              onClose={() => setShowCurveEditor(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}