'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import ChatInterface from '@/components/ChatInterface';
import LyricsDisplay from '@/components/LyricsDisplay';
import CopilotAudioPlayer from '@/components/CopilotAudioPlayer';
import QualityModeIndicator from '@/components/QualityModeIndicator';
import { USTXData, USTXNote, PhonemeTiming } from '@/types/openutau';
import { getQualitySettings, getQualityIcon, getQualityColor, QUALITY_PRESETS } from '@/utils/qualitySettings';
import yaml from 'js-yaml';

export default function CopilotPage() {
  const [ustxData, setUstxData] = useState<USTXData | null>(null);
  const [phonemeData, setPhonemeData] = useState<PhonemeTiming[] | null>(null);
  const [selectedNote, setSelectedNote] = useState<USTXNote | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [singerId, setSingerId] = useState<string>('fem_1_ln');
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderingStatus, setRenderingStatus] = useState<string>('');
  const [playbackMode, setPlaybackMode] = useState<'full' | 'segment'>('full');
  const [segmentAudio, setSegmentAudio] = useState<string | null>(null);
  const [currentSegmentInfo, setCurrentSegmentInfo] = useState<{
    startNoteIndex: number;
    endNoteIndex: number;
    lineIndex: number;
  } | null>(null);
  const [qualityMode, setQualityMode] = useState<'preview' | 'standard' | 'high' | 'super'>('standard');
  const [useGPU, setUseGPU] = useState<boolean>(false);
  const [cachedVerseDetection, setCachedVerseDetection] = useState<any[] | null>(null);
  
  const router = useRouter();
  const searchParams = useSearchParams();

  // Load USTX data from query params or localStorage
  useEffect(() => {
    const loadInitialData = async () => {
      // Try to load from query params first
      const template = searchParams.get('template');
      if (template === 'still_here' || template === 'still_here_original' || template === 'still_here_happy_verse1') {
        try {
          // Map old template name to new API
          const apiTemplateName = template === 'still_here' ? 'still_here_original' : template;
          
          const response = await fetch(`/api/templates?name=${apiTemplateName}`);
          if (response.ok) {
            const result = await response.json();
            setUstxData(result.ustxData);
            console.log(`📄 Loaded template from URL: ${result.template.displayName}`);
          }
        } catch (error) {
          console.error('Error loading template:', error);
        }
      }
      
      // Try to load from localStorage
      const savedData = localStorage.getItem('copilot_ustx_data');
      if (savedData && !ustxData) {
        try {
          const parsedData = JSON.parse(savedData);
          setUstxData(parsedData);
        } catch (error) {
          console.error('Error parsing saved data:', error);
        }
      }
    };

    loadInitialData();
  }, [searchParams]);

  // Save USTX data to localStorage when it changes
  useEffect(() => {
    if (ustxData) {
      localStorage.setItem('copilot_ustx_data', JSON.stringify(ustxData));
    }
  }, [ustxData]);

  // Detect verses once when USTX loads (cache the results to prevent re-detection)
  useEffect(() => {
    const detectAndCacheVerses = async () => {
      if (!ustxData) {
        setCachedVerseDetection(null);
        return;
      }

      console.log('COPILOT: Detecting verses once for caching...');
      try {
        const { USTXLyricsManager } = await import('@/utils/ustxLyricsUtils');
        const lyricsManager = new USTXLyricsManager(ustxData);
        
        let verses;
        try {
          verses = await lyricsManager.detectVersesWithCLI(singerId);
          console.log('COPILOT: CLI detection successful, caching results');
        } catch (error) {
          console.log('COPILOT: CLI detection failed, using fallback');
          verses = lyricsManager.detectVerses();
        }
        
        setCachedVerseDetection(verses);
        console.log('COPILOT: Cached verse detection:', verses.map(v => `${v.verseNumber}: "${v.lyrics}"`));
      } catch (error) {
        console.error('COPILOT: Error detecting verses:', error);
        setCachedVerseDetection(null);
      }
    };

    // Only detect verses when USTX structure changes, not on every lyrics update
    if (ustxData && !cachedVerseDetection) {
      detectAndCacheVerses();
    }
  }, [ustxData, singerId, cachedVerseDetection]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    
    const containerRect = document.querySelector('.copilot-container')?.getBoundingClientRect();
    if (!containerRect) return;
    
    const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    setLeftPanelWidth(Math.max(20, Math.min(80, newWidth)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  const handleUSTXUpdate = (newData: USTXData) => {
    setUstxData(newData);
    // Keep cached verse detection to prevent re-detection corruption
    // Only clear cache when completely new template/structure is loaded
    // Auto-render disabled for copilot mode - user can manually render if needed
    // autoRenderFullSong(newData);
  };

  const autoRenderFullSong = async (data: USTXData) => {
    setIsRendering(true);
    const qualitySettings = getQualitySettings(qualityMode);
    setRenderingStatus(`Rendering full song (${qualityMode} quality)...`);
    
    try {
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData: data,
          singerId,
          qualitySettings
        }),
      });

      if (response.ok) {
        setRenderingStatus('Full song rendered successfully!');
        // The AudioPlayer will handle the audio blob
      } else {
        setRenderingStatus('Rendering failed');
      }
    } catch (error) {
      console.error('Auto-render error:', error);
      setRenderingStatus('Rendering error occurred');
    } finally {
      setIsRendering(false);
      setTimeout(() => setRenderingStatus(''), 3000);
    }
  };

  const handleNoteSelect = (note: USTXNote) => {
    setSelectedNote(note);
  };

  const handleTemplateSelect = async (templateName: string) => {
    if (templateName === 'still_here_original' || templateName === 'still_here_happy_verse1' || templateName === 'still_here') {
      try {
        // Map old template name to new API
        const apiTemplateName = templateName === 'still_here' ? 'still_here_original' : templateName;
        
        const response = await fetch(`/api/templates?name=${apiTemplateName}`);
        if (response.ok) {
          const result = await response.json();
          setUstxData(result.ustxData);
          // Clear cached verse detection when loading new template (different song structure)
          setCachedVerseDetection(null);
          console.log(`📄 Loaded template: ${result.template.displayName} - ${result.template.description}`);
          // Auto-render disabled for copilot mode - user can manually render if needed
          // autoRenderFullSong(result.ustxData);
        }
      } catch (error) {
        console.error('Error loading template:', error);
      }
    }
  };

  const handleExitCopilot = () => {
    router.push('/');
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsedData = yaml.load(content) as USTXData;
        setUstxData(parsedData);
        // Clear cached verse detection when loading new file (different song structure)
        setCachedVerseDetection(null);
        // Auto-render disabled for copilot mode - user can manually render if needed
        // autoRenderFullSong(parsedData);
      } catch (error) {
        console.error('Error parsing USTX file:', error);
      }
    };
    reader.readAsText(file);
  };

  const handleLyricEdit = (noteIndex: number, newLyric: string) => {
    if (!ustxData) return;

    // Update the lyric in the USTX data
    const updatedData = { ...ustxData };
    const allNotes: USTXNote[] = [];
    const notePositions: Array<{ partIndex: number; noteIndex: number }> = [];

    updatedData.voice_parts?.forEach((part, partIndex) => {
      part.notes?.forEach((note, noteIndexInPart) => {
        allNotes.push(note);
        notePositions.push({ partIndex, noteIndex: noteIndexInPart });
      });
    });

    if (noteIndex < allNotes.length) {
      const { partIndex, noteIndex: noteIndexInPart } = notePositions[noteIndex];
      updatedData.voice_parts![partIndex].notes![noteIndexInPart].lyric = newLyric;
      setUstxData(updatedData);
    }
  };

  const handleSegmentRender = async (startNoteIndex: number, endNoteIndex: number, lineIndex: number) => {
    if (!ustxData) throw new Error('No USTX data available');

    setIsRendering(true);
    const qualitySettings = getQualitySettings(qualityMode);
    setRenderingStatus(`Rendering line ${lineIndex + 1} (${qualityMode} quality)...`);
    setPlaybackMode('segment');

    try {
      const response = await fetch('/api/render-segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData,
          singerId,
          startNoteIndex,
          endNoteIndex,
          lineIndex,
          useGPU,
          qualitySettings
        }),
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        setSegmentAudio(audioUrl);
        setCurrentSegmentInfo({ startNoteIndex, endNoteIndex, lineIndex });
        setRenderingStatus(`✅ Line ${lineIndex + 1} rendered successfully!`);
        
        // Return the audio URL for the LyricsDisplay component to use
        return audioUrl;
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Render failed');
      }
    } catch (error) {
      console.error('Segment render error:', error);
      setRenderingStatus(`❌ Failed to render line ${lineIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error; // Re-throw for LyricsDisplay to handle
    } finally {
      setIsRendering(false);
      setTimeout(() => setRenderingStatus(''), 3000);
    }
  };

  const handleSegmentPlay = (audioUrl: string, lineIndex: number) => {
    console.log(`🎵 Playing segment ${lineIndex + 1}`);
    // Switch to segment mode for the main audio player
    setSegmentAudio(audioUrl);
    setPlaybackMode('segment');
  };

  const handleSegmentComplete = (lineIndex: number) => {
    console.log(`✅ Segment ${lineIndex + 1} completed and saved`);
    // Could trigger full song refresh here if needed
  };

  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      {/* Top Header */}
      <motion.header 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleExitCopilot}
            className="flex items-center space-x-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back to Piano Roll</span>
          </motion.button>
          
          <div className="h-6 w-px bg-gray-600"></div>
          
          <h1 className="text-xl font-bold text-white">🤖 AI Copilot</h1>
          
          {ustxData && (
            <div className="text-sm text-gray-300">
              {ustxData.name} - {ustxData.voice_parts?.reduce((sum, part) => sum + (part.notes?.length || 0), 0) || 0} notes
            </div>
          )}
          
          {/* Quality Mode Indicator */}
          <QualityModeIndicator mode={qualityMode} />
          
          {/* Rendering Status */}
          <AnimatePresence>
            {(isRendering || renderingStatus) && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="text-sm text-yellow-400 flex items-center space-x-2"
              >
                {isRendering && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full"
                  />
                )}
                <span>{renderingStatus}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center space-x-4">
          {/* Quality Mode Selector */}
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-300">Quality:</label>
            <motion.select
              whileFocus={{ scale: 1.02 }}
              value={qualityMode}
              onChange={(e) => setQualityMode(e.target.value as 'preview' | 'standard' | 'high' | 'super')}
              className="px-3 py-1 bg-gray-700 text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
            >
              {Object.entries(QUALITY_PRESETS).map(([key]) => (
                <option key={key} value={key}>
                  {getQualityIcon(key as any)} {key.charAt(0).toUpperCase() + key.slice(1)}
                </option>
              ))}
            </motion.select>
          </div>

          {/* GPU Toggle */}
          <motion.div className="flex items-center space-x-2">
            <label className="text-sm text-gray-300">GPU:</label>
            <motion.button
              onClick={() => setUseGPU(!useGPU)}
              className={`relative w-12 h-6 rounded-full transition-all duration-300 ${
                useGPU ? 'bg-gradient-to-r from-green-500 to-emerald-600' : 'bg-gray-600'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <motion.div
                animate={{ x: useGPU ? 24 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className={`absolute top-1 w-4 h-4 rounded-full ${
                  useGPU ? 'bg-white' : 'bg-gray-300'
                }`}
              />
            </motion.button>
          </motion.div>

          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-300">Singer:</label>
            <input
              type="text"
              value={singerId}
              onChange={(e) => setSingerId(e.target.value)}
              className="px-3 py-1 bg-gray-700 text-white rounded text-sm w-24 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Singer ID"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <input
              type="file"
              accept=".ustx"
              onChange={handleFileUpload}
              className="hidden"
              id="ustx-upload"
            />
            <label
              htmlFor="ustx-upload"
              className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer text-sm transition-colors"
            >
              Load USTX
            </label>
          </div>
        </div>
      </motion.header>

      {/* Main Copilot Area */}
      <div className="flex-1 flex overflow-hidden copilot-container">
        {/* Left Panel - Chat Interface */}
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="bg-gray-800 border-r border-gray-700 flex flex-col"
          style={{ width: `${leftPanelWidth}%` }}
        >
          <ChatInterface
            ustxData={ustxData || undefined}
            onUSTXUpdate={handleUSTXUpdate}
            onTemplateSelect={handleTemplateSelect}
            cachedVerseDetection={cachedVerseDetection || undefined}
          />
        </motion.div>

        {/* Resize Handle */}
        <motion.div
          whileHover={{ scale: 1.1 }}
          className="w-1 bg-gray-700 hover:bg-purple-500 cursor-col-resize flex items-center justify-center relative group transition-colors duration-200"
          onMouseDown={handleMouseDown}
        >
          <motion.div 
            whileHover={{ scale: 1.2 }}
            className="w-1 h-8 bg-purple-500 rounded-full group-hover:bg-purple-400 transition-colors"
          />
        </motion.div>

        {/* Right Panel - Lyrics Display */}
        <motion.div 
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="bg-gray-800 flex flex-col"
          style={{ width: `${100 - leftPanelWidth}%` }}
        >
          <LyricsDisplay
            ustxData={ustxData || undefined}
            phonemeData={phonemeData || undefined}
            currentTime={currentTime}
            isPlaying={isPlaying}
            playbackMode={playbackMode}
            currentSegmentInfo={currentSegmentInfo || undefined}
            onNoteClick={handleNoteSelect}
            onLyricEdit={handleLyricEdit}
            onSegmentRender={handleSegmentRender}
            onSegmentPlay={handleSegmentPlay}
            onSegmentComplete={handleSegmentComplete}
            cachedVerseDetection={cachedVerseDetection || undefined}
            useGPU={useGPU}
          />
        </motion.div>
      </div>

      {/* Bottom Audio Player */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.4 }}
      >
        <CopilotAudioPlayer
          ustxData={ustxData || undefined}
          singerId={singerId}
          onTimeUpdate={setCurrentTime}
          onPlayStateChange={setIsPlaying}
          onPlaybackModeChange={setPlaybackMode}
          playbackMode={playbackMode}
          segmentAudio={segmentAudio}
        />
      </motion.div>

      {/* Floating Controls */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="absolute bottom-20 left-1/2 transform -translate-x-1/2 flex items-center space-x-2 bg-gray-800 rounded-lg shadow-2xl p-2 border border-gray-700"
      >
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setLeftPanelWidth(50)}
          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          title="Reset panel sizes"
        >
          Reset
        </motion.button>
        
        <div className="w-px h-6 bg-gray-600"></div>
        
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setLeftPanelWidth(leftPanelWidth > 50 ? 30 : 70)}
          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          title="Toggle panel focus"
        >
          {leftPanelWidth > 50 ? 'Focus Lyrics' : 'Focus Chat'}
        </motion.button>
      </motion.div>

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black bg-opacity-20 cursor-col-resize z-50"
          />
        )}
      </AnimatePresence>
    </div>
  );
}