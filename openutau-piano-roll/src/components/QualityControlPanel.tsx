'use client';

import React, { useState } from 'react';
import { AudioEnhancementSettings, ENHANCEMENT_PRESETS, getQualityRecommendations, estimateQualityImprovement } from '@/utils/audioEnhancement';
import { getQualityIcon, getQualityColor } from '@/utils/qualitySettings';

interface QualityControlPanelProps {
  currentSettings: AudioEnhancementSettings;
  onSettingsChange: (settings: AudioEnhancementSettings) => void;
  onApply: () => void;
  onCancel: () => void;
}

export default function QualityControlPanel({
  currentSettings,
  onSettingsChange,
  onApply,
  onCancel
}: QualityControlPanelProps) {
  const [settings, setSettings] = useState<AudioEnhancementSettings>(currentSettings);
  
  const handleSettingChange = (updates: Partial<AudioEnhancementSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    onSettingsChange(newSettings);
  };

  const handlePresetChange = (preset: keyof typeof ENHANCEMENT_PRESETS) => {
    const presetSettings = ENHANCEMENT_PRESETS[preset];
    setSettings(presetSettings);
    onSettingsChange(presetSettings);
  };

  const qualityImprovement = estimateQualityImprovement(currentSettings, settings);
  const recommendations = getQualityRecommendations();

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl mx-auto my-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          🎙️ Audio Quality Control
        </h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-white text-xl"
        >
          ×
        </button>
      </div>

      {/* Quality Presets */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Quality Presets
        </label>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(ENHANCEMENT_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => handlePresetChange(key as keyof typeof ENHANCEMENT_PRESETS)}
              className={`p-3 rounded-lg text-left transition-all ${
                settings.preset === key
                  ? 'bg-blue-600 text-white border-2 border-blue-400'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border-2 border-transparent'
              }`}
            >
              <div className="font-medium">
                {key.charAt(0).toUpperCase() + key.slice(1)}
                {key === 'audiophile' && ' 🎧'}
                {key === 'professional' && ' 💼'}
                {key === 'broadcast' && ' 📻'}
              </div>
              <div className="text-xs mt-1 opacity-75">
                {preset.sampleRate/1000}kHz • {preset.bitDepth}-bit
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Core Quality Settings */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Core Quality
        </label>
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.useStudioQuality}
              onChange={(e) => handleSettingChange({ useStudioQuality: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2"
            />
            <span className="text-white">
              🎙️ Studio Quality Mode 
              <span className="text-gray-400 text-sm ml-2">(20x slower, incredible quality)</span>
            </span>
          </label>
        </div>
      </div>

      {/* Audio Enhancements */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-300 mb-3">
          Audio Enhancements
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enableNormalization}
              onChange={(e) => handleSettingChange({ enableNormalization: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-white text-sm">📊 Normalization</span>
          </label>
          
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enableNoiseReduction}
              onChange={(e) => handleSettingChange({ enableNoiseReduction: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-white text-sm">🔇 Noise Reduction</span>
          </label>
          
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enableReverb}
              onChange={(e) => handleSettingChange({ enableReverb: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-white text-sm">🏛️ Natural Reverb</span>
          </label>
          
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enableCompressor}
              onChange={(e) => handleSettingChange({ enableCompressor: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-white text-sm">🎚️ Compression</span>
          </label>
        </div>
      </div>

      {/* Audio Format */}
      <div className="mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Sample Rate
            </label>
            <select
              value={settings.sampleRate}
              onChange={(e) => handleSettingChange({ sampleRate: parseInt(e.target.value) as any })}
              className="w-full bg-gray-800 text-white border border-gray-600 rounded px-3 py-2"
            >
              <option value={44100}>44.1 kHz (CD Quality)</option>
              <option value={48000}>48 kHz (Professional)</option>
              <option value={96000}>96 kHz (Audiophile)</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Bit Depth
            </label>
            <select
              value={settings.bitDepth}
              onChange={(e) => handleSettingChange({ bitDepth: parseInt(e.target.value) as any })}
              className="w-full bg-gray-800 text-white border border-gray-600 rounded px-3 py-2"
            >
              <option value={16}>16-bit (Standard)</option>
              <option value={24}>24-bit (Professional)</option>
              <option value={32}>32-bit (Audiophile)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Quality Impact Estimate */}
      <div className="mb-6 bg-gray-800 rounded-lg p-4">
        <h4 className="text-white font-medium mb-2">Quality Impact Estimate</h4>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-300">Quality Improvement:</span>
            <span className="text-green-400 font-medium">+{qualityImprovement.qualityGain}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-300">Render Time:</span>
            <span className="text-orange-400 font-medium">{qualityImprovement.timeMultiplier}x slower</span>
          </div>
          <div className="text-xs text-gray-400 mt-2">
            {qualityImprovement.description}
          </div>
        </div>
      </div>

      {/* Quick Recommendations */}
      <div className="mb-6">
        <h4 className="text-white font-medium mb-3">Quick Recommendations</h4>
        <div className="space-y-2">
          {recommendations.slice(0, 3).map((rec, index) => (
            <div key={index} className="text-sm bg-gray-800 rounded p-2">
              <div className="text-white font-medium">{rec.title}</div>
              <div className="text-gray-400 text-xs">{rec.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onApply}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 px-6 rounded-lg font-medium transition-colors"
        >
          🎵 Render with Enhanced Quality
        </button>
        <button
          onClick={onCancel}
          className="bg-gray-600 hover:bg-gray-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
      
      {/* Warning for studio quality */}
      {settings.useStudioQuality && (
        <div className="mt-4 bg-orange-900/50 border border-orange-500 rounded-lg p-3">
          <div className="text-orange-400 text-sm font-medium">⚠️ Studio Quality Warning</div>
          <div className="text-orange-300 text-xs mt-1">
            This will take significantly longer (20x slower) but produces audiophile-grade quality.
            Perfect for final renders but not recommended for quick previews.
          </div>
        </div>
      )}
    </div>
  );
}