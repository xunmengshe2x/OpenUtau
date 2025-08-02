'use client';

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Helper function to create playlist from prerendered segments  
const createSequentialPlaylist = async (templateName: string, totalSegments: number): Promise<{urls: string[], totalDuration: number, durations: number[], manifest?: any} | null> => {
  try {
    console.log(`🎵 Creating playlist of ${totalSegments} prerendered segments...`);
    
    // Create URLs and calculate total duration - use faster approach
    const segmentUrls: string[] = [];
    const durations: number[] = [];
    let totalDuration = 0;
    
    // Create all URLs first
    for (let i = 0; i < totalSegments; i++) {
      const segmentUrl = `/api/prerendered-segments/${templateName}/${i}`;
      segmentUrls.push(segmentUrl);
    }
    
    // Use the manifest data instead of loading each segment
    try {
      const manifestResponse = await fetch(`/api/prerendered-segment?manifest=${templateName}`);
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        
        // Calculate total duration including timing gaps
        let actualTotalDuration = 0;
        
        for (let i = 0; i < manifest.segments.length; i++) {
          const segment = manifest.segments[i];
          const duration = segment.duration || 6; // fallback
          durations.push(duration);
          
          // For total duration, use the segment's endTimeMs to account for gaps
          if (segment.verse?.endTimeMs) {
            actualTotalDuration = Math.max(actualTotalDuration, segment.verse.endTimeMs / 1000);
          } else {
            // Fallback: accumulate durations
            totalDuration += duration;
          }
        }
        
        // Use the actual timeline duration if we have timing data
        const finalDuration = actualTotalDuration > 0 ? actualTotalDuration : totalDuration;
        
        console.log(`✅ Got durations from manifest: ${finalDuration.toFixed(2)}s total (including gaps)`);
        return { urls: segmentUrls, totalDuration: finalDuration, durations, manifest };
      } else {
        // Fallback to estimates
        for (let i = 0; i < totalSegments; i++) {
          durations.push(6); // 6 second estimate per segment
          totalDuration += 6;
        }
        console.log(`⚠️ Using duration estimates: ${totalDuration.toFixed(2)}s total`);
        return { urls: segmentUrls, totalDuration, durations };
      }
    } catch (error) {
      // Fallback to estimates
      for (let i = 0; i < totalSegments; i++) {
        durations.push(6);
        totalDuration += 6;
      }
      console.log(`⚠️ Using duration estimates: ${totalDuration.toFixed(2)}s total`);
      return { urls: segmentUrls, totalDuration, durations };
    }
    
  } catch (error) {
    console.error('❌ Error creating playlist:', error);
    return null;
  }
};


interface SimpleCopilotAudioPlayerProps {
  templateName?: string;
  hasTemplate?: boolean;
}

export interface SimpleCopilotAudioPlayerRef {
  refreshAudio: (preservePosition?: boolean) => Promise<void>;
}

const SimpleCopilotAudioPlayer = forwardRef<SimpleCopilotAudioPlayerRef, SimpleCopilotAudioPlayerProps>(({ 
  templateName,
  hasTemplate = false
}, ref) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fullSongAudio, setFullSongAudio] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const cachedAudioRef = useRef<string | null>(null);
  const lastTemplateRef = useRef<string>('');

  
  // Optimized audio caching for fast seeking
  const cacheAudioAsBlob = async (audioUrl: string, templateName: string, skipCache: boolean = false) => {
    try {
      console.log(`🎵 Loading audio with seek optimization: ${templateName}`);
      
      // Check if we already have this template cached (but not if we're skipping cache due to corruption)
      if (cachedAudioRef.current && lastTemplateRef.current === templateName && !skipCache) {
        console.log('✅ Using existing cached blob for fast seeking');
        setFullSongAudio(cachedAudioRef.current);
        return;
      }
      
      // Clean up previous cache
      if (cachedAudioRef.current) {
        URL.revokeObjectURL(cachedAudioRef.current);
        cachedAudioRef.current = null;
      }
      
      // Fetch and create blob for optimal seeking performance
      console.log('📥 Fetching audio to create seekable blob...');
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }
      
      const audioBlob = await response.blob();
      const blobUrl = URL.createObjectURL(audioBlob);
      
      // Cache the blob URL
      cachedAudioRef.current = blobUrl;
      lastTemplateRef.current = templateName;
      
      console.log(`✅ Audio blob cached for fast seeking (${(audioBlob.size / 1024 / 1024).toFixed(2)}MB)`);
      setFullSongAudio(blobUrl);
      
    } catch (error) {
      console.error('❌ Failed to cache audio blob, falling back to direct URL:', error);
      setFullSongAudio(audioUrl);
    }
    
    // If skipCache is true, use direct URL instead of blob
    if (skipCache) {
      console.log('🔄 Skipping cache due to corruption, using direct server URL');
      setFullSongAudio(audioUrl);
    }
  };

  // Handle seeking with feedback
  const handleSeekInternal = (targetTime: number) => {
    if (audioRef.current) {
      setIsSeeking(true);
      
      // Set up one-time listener for when seeking completes
      const handleSeeked = () => {
        setIsSeeking(false);
        audioRef.current?.removeEventListener('seeked', handleSeeked);
      };
      
      audioRef.current.addEventListener('seeked', handleSeeked);
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
      
      // Faster fallback timeout for better UX
      setTimeout(() => {
        setIsSeeking(false);
        audioRef.current?.removeEventListener('seeked', handleSeeked);
      }, 1000);
    }
  };


  // Expose refreshAudio method to parent component
  useImperativeHandle(ref, () => ({
    refreshAudio: async (preservePosition = true) => {
      // Force clear all cached audio data
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current.load();
        setDuration(0);
        setCurrentTime(0);
        console.log('🧹 Forced clear of audio element cache');
      }
      
      // Clear our internal cache
      if (cachedAudioRef.current) {
        URL.revokeObjectURL(cachedAudioRef.current);
        cachedAudioRef.current = null;
        console.log('🧹 Cleared internal audio cache');
      }
      
      setFullSongAudio(null);
      
      // Small delay to ensure cache is cleared
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return loadFullSongAudio(preservePosition);
    }
  }));

  // Load full song audio when template is available
  useEffect(() => {
    const handleTemplateLoad = async () => {
      console.log(`🎼 SimpleCopilotAudioPlayer: templateName="${templateName}", hasTemplate=${hasTemplate}`);
      if (templateName && hasTemplate) {
        console.log('✅ Conditions met, loading full song audio...');
        
        // Clear any cached audio when switching templates
        if (cachedAudioRef.current && lastTemplateRef.current !== templateName) {
          URL.revokeObjectURL(cachedAudioRef.current);
          cachedAudioRef.current = null;
          console.log('🧹 Cleared cached audio for template switch');
          
          // Also clear segment updates for template switch to ensure clean slate
          if (lastTemplateRef.current) {
            try {
              await fetch('/api/clear-segment-updates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateName })
              });
              console.log(`🧹 Cleared segment updates for template switch to ${templateName}`);
            } catch (error) {
              console.warn('Failed to clear segment updates on template switch:', error);
            }
          }
        }
        
        // Update template tracking
        lastTemplateRef.current = templateName;
        
        loadFullSongAudio();
      } else {
        console.log('❌ Conditions not met for loading audio');
      }
    };

    handleTemplateLoad();
  }, [templateName, hasTemplate]);

  // Update audio source when fullSongAudio changes (for playlist playback)
  useEffect(() => {
    if (fullSongAudio && audioRef.current) {
      const currentTime = audioRef.current.currentTime;
      const wasPlaying = !audioRef.current.paused;
      
      console.log(`🔄 Updating audio source: ${fullSongAudio.startsWith('blob:') ? 'blob (cached)' : 'direct URL'}`);
      
      // Only reset if we're switching to a different source
      if (audioRef.current.src !== fullSongAudio) {
        audioRef.current.src = fullSongAudio;
        audioRef.current.load();
        
        // Restore position if we were playing
        if (currentTime > 0) {
          audioRef.current.addEventListener('loadedmetadata', () => {
            if (audioRef.current) {
              audioRef.current.currentTime = currentTime;
              if (wasPlaying) {
                audioRef.current.play().catch(console.error);
              }
            }
          }, { once: true });
        }
      }
      
      // Add event listeners to debug loading issues
      const audio = audioRef.current;
      
      const handleLoadStart = () => console.log('🔄 Audio load started');
      const handleLoadedMetadata = () => {
        console.log(`📊 Audio metadata loaded: duration=${audio.duration}s (${Math.floor(audio.duration / 60)}:${Math.floor(audio.duration % 60).toString().padStart(2, '0')})`);
        console.log(`📊 Audio source: ${audio.src}`);
        console.log(`📊 Audio file size: ${audio.buffered.length > 0 ? 'buffered' : 'not buffered'}`);
        setDuration(audio.duration);
      };
      const handleCanPlay = () => console.log('✅ Audio can play');
      const handleLoadError = (e: any) => {
        console.error('❌ Audio load error:', e);
        console.error('Audio error details:', {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState
        });
        
        // If this is a blob URL (cached audio) that failed, try fallback to server
        if (audio.src && audio.src.startsWith('blob:')) {
          console.log('🔄 Blob audio failed, attempting server fallback...');
          
          // Clear the corrupted blob
          if (fullSongAudio && fullSongAudio.startsWith('blob:')) {
            URL.revokeObjectURL(fullSongAudio);
          }
          
          // Retry loading from server without caching
          loadFullSongAudio(true, true).catch(fallbackError => {
            console.error('❌ Server fallback also failed:', fallbackError);
            setError('Failed to load audio from both cache and server');
          });
        }
      };
      
      audio.addEventListener('loadstart', handleLoadStart);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('error', handleLoadError);
      
      // Cleanup listeners
      return () => {
        audio.removeEventListener('loadstart', handleLoadStart);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('error', handleLoadError);
      };
    }
  }, [fullSongAudio]);


  const loadFullSongAudio = async (preservePosition: boolean = false, skipCache: boolean = false) => {
    console.log(`🚀 DEBUG: loadFullSongAudio called at ${new Date().toISOString()}`);
    if (!templateName) return;
    
    // Save current position if preserving
    const savedTime = preservePosition && audioRef.current ? audioRef.current.currentTime : 0;
    const wasPlaying = preservePosition && isPlaying;
    
    console.log(`🚀 DEBUG: About to setIsLoading(true)`);
    setIsLoading(true);
    setError(null);
    
    try {
      console.log(`🎼 Loading full song audio for ${templateName} using OpenUtau C# mixing...`);
      
      // Only use cache-busting when actually needed (template switches or forced refresh)
      const isTemplateSwitch = lastTemplateRef.current !== templateName;
      const needsRefresh = isTemplateSwitch || preservePosition; // Only bust cache when switching templates or forced refresh
      const cacheParams = needsRefresh ? `&t=${Date.now()}&refresh=true` : '';
      const apiUrl = `/api/openutau-mix?template=${templateName}${cacheParams}`;
      console.log(`📡 Fetching OpenUtau mixing: ${apiUrl}${isTemplateSwitch ? ' (template switch - clearing cache)' : ''}`);
      console.log(`🚀 DEBUG: About to call fetch() at ${new Date().toISOString()}`);
      const response = await fetch(apiUrl);
      console.log(`🚀 DEBUG: fetch() completed at ${new Date().toISOString()}`);
      
      console.log(`📡 Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          setError('Audio file not found');
          console.log('⚠️ 404: Audio file not found');
        } else {
          const errorText = await response.text();
          console.error(`❌ OpenUtau mixing API Error ${response.status}: ${errorText}`);
          throw new Error(`Failed to load audio: ${response.status} - ${errorText}`);
        }
        return;
      }
      
      // Check if the response is JSON with an audio URL (new approach to avoid CORS)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (data.audioUrl) {
          console.log(`🎵 Using mixed audio from static file: ${data.audioUrl}`);
          console.log(`🎯 Mixed by: ${data.mixedBy || 'unknown'}`);
          
          // Use the static file URL directly
          await cacheAudioAsBlob(data.audioUrl, templateName, skipCache);
          console.log(`✅ Mixed audio ready with instant seeking`);
          return;
        }
      }
      
      // Check if OpenUtau mixing was used (including fallback)
      const mixedBy = response.headers.get('x-mixed-by-openutau');
      if (mixedBy) {
        const mixType = mixedBy === 'fallback' ? 'fallback original audio' : 'C# mixed audio';
        console.log(`🎵 Using OpenUtau ${mixType} with smart caching...`);
        // Use the same cache-busting URL for consistency
        await cacheAudioAsBlob(apiUrl, templateName, skipCache);
        console.log(`✅ OpenUtau ${mixType} ready with instant seeking`);
        return;
      }
      
      // If we get here, OpenUtau mixing API responded but without the header
      // This means it's serving the fallback audio - still use it
      console.log('🎼 Using fallback audio from OpenUtau mixing API');
      setFullSongAudio(apiUrl);
      
      // Pre-load the audio and restore position if preserving
      if (audioRef.current) {
        audioRef.current.src = apiUrl;
        audioRef.current.load();
        
        if (preservePosition && savedTime > 0) {
          console.log(`🔄 Preserving playback position: ${savedTime.toFixed(2)}s`);
          audioRef.current.addEventListener('loadedmetadata', () => {
            if (audioRef.current) {
              audioRef.current.currentTime = savedTime;
              setCurrentTime(savedTime);
              
              // Resume playback if it was playing
              if (wasPlaying) {
                audioRef.current.play().catch(console.error);
                setIsPlaying(true);
              }
            }
          }, { once: true });
        }
      }
      
      console.log('✅ Full song audio loaded');
      
    } catch (err) {
      console.error('Failed to load full song audio:', err);
      setError(err instanceof Error ? err.message : 'Failed to load audio');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = async () => {
    // Simple audio element playback only
    if (!fullSongAudio || !audioRef.current) {
      if (!templateName) {
        setError('No template selected');
        return;
      }
      // Try to load audio if not loaded
      await loadFullSongAudio();
      return;
    }

    try {
      await audioRef.current.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('Play failed:', err);
      setError('Playback failed');
    }
  };

  const handlePause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    handleSeekInternal(newTime);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleError = (event: any) => {
      // Only show error if we have a valid audio source (ignore clearing cache errors)
      if (audio.src && !audio.src.includes('blob:') && audio.src !== '' && audio.src !== window.location.href) {
        console.error('🔊 Audio playback error:', event);
        setError('Audio playback error');
        setIsPlaying(false);
      } else {
        // This is likely a cache clearing operation, ignore the error
        console.log('🧹 Audio cache clearing (expected error during refresh)');
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [fullSongAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fullSongAudio && fullSongAudio.startsWith('blob:')) {
        URL.revokeObjectURL(fullSongAudio);
      }
      if (cachedAudioRef.current) {
        URL.revokeObjectURL(cachedAudioRef.current);
        cachedAudioRef.current = null;
      }
    };
  }, [fullSongAudio]);

  return (
    <div className="bg-gray-800 border-t border-gray-700 p-4">
      <div className="flex items-center space-x-4">
        
        {/* Play/Pause Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={isPlaying ? handlePause : handlePlay}
          disabled={isLoading || (!hasTemplate && !fullSongAudio)}
          className={`
            w-12 h-12 rounded-full flex items-center justify-center text-white
            ${isLoading || (!hasTemplate && !fullSongAudio)
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
            disabled={!fullSongAudio}
            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
          />
        </div>

        {/* Status Indicator */}
        <div className="flex items-center space-x-2">
          {isSeeking ? (
            <div className="text-xs text-yellow-400 flex items-center space-x-1">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-3 h-3 border border-yellow-400 border-t-transparent rounded-full"
              />
              <span>Seeking...</span>
            </div>
          ) : (
            <div className="text-xs text-gray-400">
              {templateName ? `🎼 ${templateName}` : '🎼 Full Song'}
            </div>
          )}
          <AnimatePresence>
            {fullSongAudio && (
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
            className="mt-2 text-red-400 text-sm flex items-center space-x-2"
          >
            <span>⚠️ {error}</span>
            {error.includes('not pre-rendered') && (
              <button
                onClick={() => loadFullSongAudio()}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Retry
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Audio Element - Optimized for fast seeking */}
      <audio
        ref={audioRef}
        preload="auto"
        style={{ display: 'none' }}
        crossOrigin="anonymous"
        controls={false}
        autoPlay={false}
        muted={false}
        loop={false}
        playsInline={true}
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
});

SimpleCopilotAudioPlayer.displayName = 'SimpleCopilotAudioPlayer';

export default SimpleCopilotAudioPlayer;