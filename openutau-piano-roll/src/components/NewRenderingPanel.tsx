'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useCLICommands } from '@/hooks/useCLICommands';

interface Verse {
  verseNumber: number;
  startNoteIndex: number;
  endNoteIndex: number;
  lyrics: string;
  duration: number;
  phonemeCount: number;
}

interface VerseMetadata {
  totalVerses: number;
  processedAt: string;
  processingMethod: string;
  verses: Verse[];
}

interface NewRenderingPanelProps {
  verseMetadata?: VerseMetadata;
  ustxData?: any; // Current USTX data to extract updated lyrics
  isLoading?: boolean;
  ustxPath?: string; // Path to the current USTX file
}

const NewRenderingPanel: React.FC<NewRenderingPanelProps> = ({
  verseMetadata,
  isLoading = false,
  ustxPath = '/workspaces/OpenUtau/still_here_edited.ustx'
}) => {
  const { renderPhrase, isRendering, renderResult } = useCLICommands();
  const [renderingVerse, setRenderingVerse] = useState<number | null>(null);
  const [renderedAudioUrls, setRenderedAudioUrls] = useState<Map<number, string>>(new Map());
  const [playingVerse, setPlayingVerse] = useState<number | null>(null);
  const [audioElements, setAudioElements] = useState<Map<number, HTMLAudioElement>>(new Map());
  const [renderSettings, setRenderSettings] = useState({
    diffsingerDepth: 0.9,
    diffsingerSteps: 20,
    diffsingerStepsPitch: 10,
    diffsingerStepsVariance: 20,
    resetTimings: true,
    preserveSilenceTiming: true
  });

  const handleRenderVerse = async (verse: Verse) => {
    if (isRendering) return;
    
    console.log(`🎬 [RENDER START] Verse ${verse.verseNumber}: "${verse.lyrics}"`);
    console.log(`🔧 [RENDER SETTINGS] Depth: ${renderSettings.diffsingerDepth}, Steps: ${renderSettings.diffsingerSteps}, Pitch: ${renderSettings.diffsingerStepsPitch}, Variance: ${renderSettings.diffsingerStepsVariance}`);
    console.log(`📁 [RENDER PATH] USTX: ${ustxPath}`);
    
    setRenderingVerse(verse.verseNumber);
    
    try {
      console.log(`⚙️ [RENDER API] Calling renderPhrase API...`);
      
      const result = await renderPhrase({
        ustxPath: ustxPath,
        singerPath: '/workspaces/OpenUtau/fem_1_ln',
        phraseNumber: verse.verseNumber,
        resetTimings: renderSettings.resetTimings,
        preserveSilenceTiming: renderSettings.preserveSilenceTiming,
        forceOriginalFile: ustxPath?.endsWith('still_here.ustx'), // Force original file for original template
        diffsingerDepth: renderSettings.diffsingerDepth,
        diffsingerSteps: renderSettings.diffsingerSteps,
        diffsingerStepsPitch: renderSettings.diffsingerStepsPitch,
        diffsingerStepsVariance: renderSettings.diffsingerStepsVariance
      });
      
      console.log(`✅ [RENDER SUCCESS] Verse ${verse.verseNumber} completed!`);
      console.log(`🎵 [RENDER RESULT] WAV: ${result.files.wav}, JSON: ${result.files.json}`);
      console.log(`⏱️ [RENDER TIME] ${result.renderTime}ms`);
      
      // Store the rendered audio URL
      if (result.files.wav) {
        setRenderedAudioUrls(prev => new Map(prev).set(verse.verseNumber, result.files.wav));
        console.log(`💾 [AUDIO STORED] Verse ${verse.verseNumber} audio URL stored`);
      }
      
    } catch (error) {
      console.error(`❌ [RENDER ERROR] Verse ${verse.verseNumber} failed:`, error);
      alert(`Render failed for verse ${verse.verseNumber}: ${error.message}`);
    } finally {
      setRenderingVerse(null);
      console.log(`🏁 [RENDER END] Verse ${verse.verseNumber} render process completed`);
    }
  };

  const handlePlayVerse = (verse: Verse) => {
    const audioUrl = renderedAudioUrls.get(verse.verseNumber);
    if (!audioUrl) return;

    console.log(`🔊 [PLAY START] Playing verse ${verse.verseNumber}`);
    
    // Stop any currently playing audio
    if (playingVerse !== null) {
      handleStopVerse(playingVerse);
    }

    // Create new audio element
    const audio = new Audio(audioUrl);
    audio.onended = () => {
      console.log(`🔇 [PLAY END] Verse ${verse.verseNumber} finished playing`);
      setPlayingVerse(null);
      setAudioElements(prev => {
        const newMap = new Map(prev);
        newMap.delete(verse.verseNumber);
        return newMap;
      });
    };
    
    audio.onerror = (e) => {
      console.error(`❌ [PLAY ERROR] Failed to play verse ${verse.verseNumber}:`, e);
      setPlayingVerse(null);
    };

    // Store audio element and start playing
    setAudioElements(prev => new Map(prev).set(verse.verseNumber, audio));
    setPlayingVerse(verse.verseNumber);
    
    audio.play().catch(e => {
      console.error(`❌ [PLAY ERROR] Audio play failed for verse ${verse.verseNumber}:`, e);
      setPlayingVerse(null);
    });
  };

  const handleStopVerse = (verseNumber: number) => {
    console.log(`⏹️ [PLAY STOP] Stopping verse ${verseNumber}`);
    
    const audio = audioElements.get(verseNumber);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    
    setPlayingVerse(null);
    setAudioElements(prev => {
      const newMap = new Map(prev);
      newMap.delete(verseNumber);
      return newMap;
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-gray-800">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Rendering Panel</h2>
          <p className="text-sm text-gray-300">Loading verse metadata...</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p>Running Python script...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!verseMetadata?.verses?.length) {
    return (
      <div className="flex flex-col h-full bg-gray-800">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Rendering Panel</h2>
          <p className="text-sm text-gray-300">No verse metadata available</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <p className="mb-2">No verses found</p>
            <p className="text-xs">Select a template to load verse data</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-white">Rendering Panel</h2>
        <p className="text-sm text-gray-300">
          {verseMetadata.totalVerses} verses • {verseMetadata.processingMethod}
        </p>
        <p className="text-xs text-gray-400">
          Processed: {new Date(verseMetadata.processedAt).toLocaleString()}
        </p>
        
        {/* Quick Render Settings */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-gray-400">Depth:</label>
            <input
              type="number"
              min="0.1"
              max="1.0"
              step="0.1"
              value={renderSettings.diffsingerDepth}
              onChange={(e) => setRenderSettings(prev => ({ ...prev, diffsingerDepth: parseFloat(e.target.value) }))}
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-xs"
            />
          </div>
          <div>
            <label className="text-gray-400">Steps:</label>
            <input
              type="number"
              min="10"
              max="1000"
              step="10"
              value={renderSettings.diffsingerSteps}
              onChange={(e) => setRenderSettings(prev => ({ ...prev, diffsingerSteps: parseInt(e.target.value) }))}
              className="w-full px-2 py-1 bg-gray-700 text-white rounded text-xs"
            />
          </div>
        </div>
      </div>

      {/* Verses List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {verseMetadata.verses.map((verse) => (
          <motion.div
            key={verse.verseNumber}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: verse.verseNumber * 0.05 }}
            className="bg-gray-700 border border-gray-600 rounded-lg p-4 hover:bg-gray-650 transition-colors"
          >
            {/* Verse Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {verse.verseNumber}
                </div>
                <div>
                  <h3 className="text-white font-medium">Verse {verse.verseNumber}</h3>
                  <p className="text-xs text-gray-400">
                    Notes {verse.startNoteIndex}-{verse.endNoteIndex} • {verse.phonemeCount} phonemes
                  </p>
                </div>
              </div>
              
              {/* Render & Play Buttons */}
              <div className="flex items-center space-x-2">
                {/* Render Button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleRenderVerse(verse)}
                  disabled={isRendering}
                  className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                    renderingVerse === verse.verseNumber
                      ? 'bg-orange-600 text-white'
                      : isRendering
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {renderingVerse === verse.verseNumber ? (
                    <>
                      <div className="inline-block animate-spin w-3 h-3 border border-white border-t-transparent rounded-full mr-2"></div>
                      Rendering...
                    </>
                  ) : (
                    '🎵 Render'
                  )}
                </motion.button>

                {/* Play/Stop Button (only shows if audio is rendered) */}
                {renderedAudioUrls.has(verse.verseNumber) && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => 
                      playingVerse === verse.verseNumber 
                        ? handleStopVerse(verse.verseNumber)
                        : handlePlayVerse(verse)
                    }
                    className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                      playingVerse === verse.verseNumber
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {playingVerse === verse.verseNumber ? '⏹️ Stop' : '▶️ Play'}
                  </motion.button>
                )}
              </div>
            </div>

            {/* Lyrics */}
            <div className="bg-gray-800 rounded p-3 mb-2">
              <p className="text-white leading-relaxed">{verse.lyrics}</p>
            </div>

            {/* Metadata */}
            <div className="flex justify-between items-center text-xs text-gray-400">
              <span>Duration: {(verse.duration / 1000).toFixed(1)}s</span>
              <span>{verse.lyrics.split(' ').length} words</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default NewRenderingPanel;