'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { USTXData } from '@/types/openutau';
import { FullSongCombiner } from '@/utils/fullSongCombiner';
import { TimelineFullSongPlayer } from '@/utils/timelineFullSongPlayer';

interface CopilotAudioPlayerProps {
  ustxData?: USTXData;
  singerId?: string;
  onTimeUpdate?: (time: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onPlaybackModeChange?: (mode: 'full' | 'segment' | 'song') => void;
  playbackMode?: 'full' | 'segment' | 'song';
  segmentAudio?: string | null;
  templateName?: string;
  hasPrerenderedSegments?: boolean;
  timelinePlayer?: TimelineFullSongPlayer;
  onSetUpdating?: (callback: (isUpdating: boolean) => void) => void;
}

const CopilotAudioPlayer: React.FC<CopilotAudioPlayerProps> = ({ 
  ustxData, 
  singerId = 'default', 
  onTimeUpdate, 
  onPlayStateChange,
  onPlaybackModeChange,
  playbackMode = 'full',
  segmentAudio,
  templateName,
  hasPrerenderedSegments = false,
  timelinePlayer,
  onSetUpdating
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fullSongAudio, setFullSongAudio] = useState<string | null>(null);
  const [combinedSongAudio, setCombinedSongAudio] = useState<string | null>(null);
  const [isUsingTimelinePlayer, setIsUsingTimelinePlayer] = useState(false);
  const [timelinePlayerInterval, setTimelinePlayerInterval] = useState<NodeJS.Timeout | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  // Get current audio source based on playback mode
  const getCurrentAudioSource = () => {
    if (playbackMode === 'segment' && segmentAudio) {
      return segmentAudio;
    } else if (playbackMode === 'song' && isUsingTimelinePlayer) {
      return null; // TimelineFullSongPlayer handles audio directly
    } else if (playbackMode === 'song' && combinedSongAudio) {
      return combinedSongAudio;
    } else {
      return fullSongAudio;
    }
  };

  const handlePlay = async () => {
    // Handle TimelineFullSongPlayer case
    if (playbackMode === 'song' && timelinePlayer && hasPrerenderedSegments) {
      await playWithTimelinePlayer();
      return;
    }
    
    const audioSource = getCurrentAudioSource();
    
    if (!audioSource) {
      // No audio available, render based on mode
      if (!ustxData) {
        setError('No USTX data available');
        return;
      }
      
      if (playbackMode === 'song' && templateName && hasPrerenderedSegments) {
        await loadCombinedSong();
      } else {
        await renderFullSong();
      }
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

  const playWithTimelinePlayer = async () => {
    if (!timelinePlayer) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('🎼 Starting timeline-based full song playback');
      setIsUsingTimelinePlayer(true);
      
      // Start playback with progress tracking
      await timelinePlayer.playFullSong((currentTimeMs, currentSegment) => {
        const currentTimeSec = currentTimeMs / 1000;
        setCurrentTime(currentTimeSec);
        onTimeUpdate?.(currentTimeSec);
        
        // Update duration from timeline
        const timeline = timelinePlayer.getTimelineInfo();
        if (timeline) {
          setDuration(timeline.totalDurationMs / 1000);
        }
      });
      
      setIsPlaying(true);
      onPlayStateChange?.(true);
      
      // Set up interval to check playback status
      const interval = setInterval(() => {
        const status = timelinePlayer.getPlaybackStatus();
        if (!status.isPlaying) {
          // Playback finished
          setIsPlaying(false);
          onPlayStateChange?.(false);
          setCurrentTime(0);
          onTimeUpdate?.(0);
          setIsUsingTimelinePlayer(false);
          clearInterval(interval);
        }
      }, 100);
      
      setTimelinePlayerInterval(interval);
      
    } catch (err) {
      console.error('Timeline player error:', err);
      setError(err instanceof Error ? err.message : 'Timeline playback failed');
      setIsUsingTimelinePlayer(false);
    } finally {
      setIsLoading(false);
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

  const loadCombinedSong = async () => {
    if (!templateName) {
      setError('No template name available for song mode');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🎼 Loading combined song for ${templateName}...`);
      
      const combiner = new FullSongCombiner();
      const audioUrl = await combiner.combineSegments(templateName);
      
      if (!audioUrl) {
        throw new Error('Failed to combine segments');
      }
      
      // Clean up previous audio URL
      if (combinedSongAudio) {
        URL.revokeObjectURL(combinedSongAudio);
      }
      
      setCombinedSongAudio(audioUrl);
      
      // Play the combined song
      if (audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.load();
        await audioRef.current.play();
        setIsPlaying(true);
        onPlayStateChange?.(true);
      }
      
      // Clean up combiner
      combiner.dispose();

    } catch (err) {
      console.error('Combined song load error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = () => {
    if (isUsingTimelinePlayer && timelinePlayer) {
      timelinePlayer.stopPlayback();
      setIsPlaying(false);
      onPlayStateChange?.(false);
      setIsUsingTimelinePlayer(false);
      if (timelinePlayerInterval) {
        clearInterval(timelinePlayerInterval);
        setTimelinePlayerInterval(null);
      }
    } else if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      onPlayStateChange?.(false);
    }
  };

  const handleStop = () => {
    if (isUsingTimelinePlayer && timelinePlayer) {
      timelinePlayer.stopPlayback();
      setIsPlaying(false);
      onPlayStateChange?.(false);
      setCurrentTime(0);
      onTimeUpdate?.(0);
      setIsUsingTimelinePlayer(false);
      if (timelinePlayerInterval) {
        clearInterval(timelinePlayerInterval);
        setTimelinePlayerInterval(null);
      }
    } else if (audioRef.current) {
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
    
    // Seeking not supported with TimelineFullSongPlayer
    if (isUsingTimelinePlayer) {
      return;
    }
    
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

  const switchToSong = () => {
    if (combinedSongAudio && audioRef.current) {
      audioRef.current.src = combinedSongAudio;
      audioRef.current.load();
      onPlaybackModeChange?.('song');
    } else if (templateName && hasPrerenderedSegments) {
      // Load combined song if not already loaded
      loadCombinedSong();
      onPlaybackModeChange?.('song');
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
  }, [playbackMode, segmentAudio, fullSongAudio, combinedSongAudio]);

  // Register updating state callback
  useEffect(() => {
    if (onSetUpdating) {
      onSetUpdating(setIsUpdating);
    }
  }, [onSetUpdating]);

  // Clean up audio URLs and intervals on unmount
  useEffect(() => {
    return () => {
      if (fullSongAudio) {
        URL.revokeObjectURL(fullSongAudio);
      }
      if (combinedSongAudio) {
        URL.revokeObjectURL(combinedSongAudio);
      }
      if (timelinePlayerInterval) {
        clearInterval(timelinePlayerInterval);
      }
      if (isUsingTimelinePlayer && timelinePlayer) {
        timelinePlayer.stopPlayback();
      }
    };
  }, [fullSongAudio, combinedSongAudio, timelinePlayerInterval, isUsingTimelinePlayer, timelinePlayer]);

  const currentAudioSource = getCurrentAudioSource();

  return (
    <div className="bg-gray-800 border-t border-gray-700 p-4">
      <div className="flex items-center space-x-4">
        {/* Playback Mode Toggle - Simplified */}
        <div className="flex items-center space-x-2">
          {segmentAudio && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={switchToSegment}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                playbackMode === 'segment' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🎵 Segment
            </motion.button>
          )}
          {hasPrerenderedSegments && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setPlaybackMode('song');
                onPlaybackModeChange?.('song');
              }}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                playbackMode === 'song' 
                  ? 'bg-green-600 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🎼 Full Song
            </motion.button>
          )}
        </div>

        <div className="w-px h-6 bg-gray-600"></div>

        {/* Play/Pause Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={isPlaying ? handlePause : handlePlay}
          disabled={isLoading || isUpdating}
          className={`
            w-12 h-12 rounded-full flex items-center justify-center text-white
            ${isLoading || isUpdating
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
          ) : isUpdating ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full"
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
            disabled={!currentAudioSource && !isUsingTimelinePlayer || isUsingTimelinePlayer}
            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
          />
        </div>

        {/* Mode Indicator */}
        <div className="flex items-center space-x-2">
          <div className="text-xs text-gray-400">
            {isUpdating ? '🔄 Updating Song...' :
             playbackMode === 'segment' ? '🎵 Segment' : 
             playbackMode === 'song' && isUsingTimelinePlayer ? '🎼 Full Song (with silences)' :
             playbackMode === 'song' ? '🎼 Combined Song' : '🎼 Full Song'}
          </div>
          <AnimatePresence>
            {isUpdating ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="w-2 h-2 bg-orange-400 rounded-full animate-pulse"
              />
            ) : (currentAudioSource || isUsingTimelinePlayer) && (
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