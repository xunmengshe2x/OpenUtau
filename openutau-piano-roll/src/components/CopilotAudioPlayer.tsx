'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { USTXData } from '@/types/openutau';

interface CopilotAudioPlayerProps {
  ustxData?: USTXData;
  singerId?: string;
  onTimeUpdate?: (time: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onPlaybackModeChange?: (mode: 'full' | 'segment') => void;
  playbackMode?: 'full' | 'segment';
  segmentAudio?: string | null;
}

const CopilotAudioPlayer: React.FC<CopilotAudioPlayerProps> = ({ 
  ustxData, 
  singerId = 'default', 
  onTimeUpdate, 
  onPlayStateChange,
  onPlaybackModeChange,
  playbackMode = 'full',
  segmentAudio
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fullSongAudio, setFullSongAudio] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  // Get current audio source based on playback mode
  const getCurrentAudioSource = () => {
    return playbackMode === 'segment' && segmentAudio ? segmentAudio : fullSongAudio;
  };

  const handlePlay = async () => {
    const audioSource = getCurrentAudioSource();
    
    if (!audioSource) {
      // No audio available, render full song
      if (!ustxData) {
        setError('No USTX data available');
        return;
      }
      await renderFullSong();
      return;
    }

    // Play existing audio
    if (audioRef.current) {
      audioRef.current.src = audioSource;
      audioRef.current.load();
      await audioRef.current.play();
      setIsPlaying(true);
      onPlayStateChange?.(true);
    }
  };

  const renderFullSong = async () => {
    if (!ustxData) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData,
          singerId
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Rendering failed');
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Clean up previous audio URL
      if (fullSongAudio) {
        URL.revokeObjectURL(fullSongAudio);
      }
      
      setFullSongAudio(audioUrl);
      
      // Play the rendered audio
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.load();
        await audioRef.current.play();
        setIsPlaying(true);
        onPlayStateChange?.(true);
      }

    } catch (err) {
      console.error('Render error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      onPlayStateChange?.(false);
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      onPlayStateChange?.(false);
      setCurrentTime(0);
      onTimeUpdate?.(0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      onTimeUpdate?.(newTime);
    }
  };

  const switchToFullSong = () => {
    if (fullSongAudio && audioRef.current) {
      audioRef.current.src = fullSongAudio;
      audioRef.current.load();
      onPlaybackModeChange?.('full');
    }
  };

  const switchToSegment = () => {
    if (segmentAudio && audioRef.current) {
      audioRef.current.src = segmentAudio;
      audioRef.current.load();
      onPlaybackModeChange?.('segment');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    };
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      onPlayStateChange?.(false);
      setCurrentTime(0);
      onTimeUpdate?.(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [getCurrentAudioSource()]);

  // Switch audio source when playback mode changes
  useEffect(() => {
    if (audioRef.current && !isPlaying) {
      const audioSource = getCurrentAudioSource();
      if (audioSource) {
        audioRef.current.src = audioSource;
        audioRef.current.load();
      }
    }
  }, [playbackMode, segmentAudio, fullSongAudio]);

  // Clean up audio URLs on unmount
  useEffect(() => {
    return () => {
      if (fullSongAudio) {
        URL.revokeObjectURL(fullSongAudio);
      }
    };
  }, [fullSongAudio]);

  const currentAudioSource = getCurrentAudioSource();

  return (
    <div className="bg-gray-800 border-t border-gray-700 p-4">
      <div className="flex items-center space-x-4">
        {/* Playback Mode Toggle */}
        <div className="flex items-center space-x-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={switchToFullSong}
            disabled={!fullSongAudio}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              playbackMode === 'full' 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Full Song
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={switchToSegment}
            disabled={!segmentAudio}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              playbackMode === 'segment' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Segment
          </motion.button>
        </div>

        <div className="w-px h-6 bg-gray-600"></div>

        {/* Play/Pause Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={isPlaying ? handlePause : handlePlay}
          disabled={isLoading}
          className={`
            w-12 h-12 rounded-full flex items-center justify-center text-white
            ${isLoading 
              ? 'bg-gray-600 cursor-not-allowed' 
              : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600'
            }
          `}
        >
          {isLoading ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
            />
          ) : isPlaying ? (
            <div className="w-3 h-3 bg-white rounded-sm" />
          ) : (
            <div className="w-0 h-0 border-l-[6px] border-l-white border-y-[4px] border-y-transparent ml-1" />
          )}
        </motion.button>

        {/* Stop Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleStop}
          disabled={!isPlaying && currentTime === 0}
          className={`
            w-8 h-8 rounded flex items-center justify-center
            ${!isPlaying && currentTime === 0 
              ? 'bg-gray-600 cursor-not-allowed' 
              : 'bg-gray-700 hover:bg-gray-600'
            }
          `}
        >
          <div className="w-3 h-3 bg-white rounded-sm" />
        </motion.button>

        {/* Time Display */}
        <div className="text-sm text-gray-300 min-w-20">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        {/* Progress Bar */}
        <div className="flex-1 max-w-md">
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
            disabled={!currentAudioSource}
            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
          />
        </div>

        {/* Mode Indicator */}
        <div className="flex items-center space-x-2">
          <div className="text-xs text-gray-400">
            {playbackMode === 'segment' ? '🎵 Segment' : '🎼 Full Song'}
          </div>
          <AnimatePresence>
            {currentAudioSource && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="w-2 h-2 bg-green-500 rounded-full"
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Error Display */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-2 text-red-400 text-sm"
          >
            Error: {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        preload="none"
        style={{ display: 'none' }}
      />

      {/* Custom slider styles */}
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          background: #8b5cf6;
          border-radius: 50%;
          cursor: pointer;
        }
        
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #8b5cf6;
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
};

export default CopilotAudioPlayer;