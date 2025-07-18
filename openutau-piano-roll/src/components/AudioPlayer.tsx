'use client';

import React, { useState, useRef, useEffect } from 'react';
import { USTXData } from '@/types/openutau';

interface AudioPlayerProps {
  ustxData?: USTXData;
  singerId?: string;
  onTimeUpdate?: (time: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ 
  ustxData, 
  singerId = 'default', 
  onTimeUpdate, 
  onPlayStateChange 
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  const handlePlay = async () => {
    if (!ustxData) {
      setError('No USTX data available');
      return;
    }

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

      // Get timing data from headers if available
      const timingDataHeader = response.headers.get('X-Timing-Data');
      if (timingDataHeader) {
        try {
          const timingData = JSON.parse(timingDataHeader);
          console.log('Timing data:', timingData);
        } catch (e) {
          console.warn('Could not parse timing data:', e);
        }
      }

      // Create audio blob and URL
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Clean up previous audio URL
      if (audioSrc) {
        URL.revokeObjectURL(audioSrc);
      }
      
      setAudioSrc(audioUrl);
      
      // Wait for audio to load and then play
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
  }, [audioSrc]);

  // Clean up audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioSrc) {
        URL.revokeObjectURL(audioSrc);
      }
    };
  }, [audioSrc]);

  return (
    <div className="bg-gray-800 border-t border-gray-600 p-3">
      <div className="flex items-center space-x-4">
        {/* Play/Pause Button */}
        <button
          onClick={isPlaying ? handlePause : handlePlay}
          disabled={isLoading || !ustxData}
          className={`
            w-12 h-12 rounded-full flex items-center justify-center text-white
            ${isLoading || !ustxData 
              ? 'bg-gray-600 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700'
            }
          `}
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <div className="w-3 h-3 bg-white rounded-sm" />
          ) : (
            <div className="w-0 h-0 border-l-[6px] border-l-white border-y-[4px] border-y-transparent ml-1" />
          )}
        </button>

        {/* Stop Button */}
        <button
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
        </button>

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
            disabled={!audioSrc}
            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
          />
        </div>

        {/* Singer ID Input */}
        <div className="flex items-center space-x-2">
          <label className="text-sm text-gray-300">Singer:</label>
          <input
            type="text"
            value={singerId}
            onChange={(e) => {
              // This would need to be lifted up to parent component
              console.log('Singer ID changed:', e.target.value);
            }}
            className="px-2 py-1 bg-gray-700 text-white rounded text-sm w-24"
            placeholder="Singer ID"
          />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mt-2 text-red-400 text-sm">
          Error: {error}
        </div>
      )}

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
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
        }
        
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
};

export default AudioPlayer;