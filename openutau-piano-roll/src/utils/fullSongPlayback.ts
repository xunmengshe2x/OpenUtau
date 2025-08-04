/**
 * Full Song Playback System
 * 
 * Manages combining rendered audio segments with silence gaps
 * to create seamless full song playback with hot-swapping capability
 */

interface AudioSegment {
  lineIndex: number;
  audioUrl: string;
  startTimeMs: number;
  durationMs: number;
  verseNumber: number;
  lyrics: string;
}

interface SongTimeline {
  segments: AudioSegment[];
  totalDurationMs: number;
  silenceGapMs: number;
}

export class FullSongPlaybackManager {
  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private currentPlayback: {
    startTime: number;
    sources: AudioBufferSourceNode[];
    isPlaying: boolean;
  } | null = null;
  private timeline: SongTimeline | null = null;
  private segmentBuffers: Map<number, AudioBuffer> = new Map();

  constructor() {
    this.initializeAudioContext();
  }

  private async initializeAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.connect(this.audioContext.destination);
      console.log('🎵 Full song playback audio context initialized');
    } catch (error) {
      console.error('Failed to initialize audio context:', error);
    }
  }

  /**
   * Build timeline from rendered segments and verse metadata
   */
  async buildTimeline(
    renderedSegments: Map<number, string>, // lineIndex -> audioUrl
    lyricsLines: any[], // verse metadata with timing
    silenceGapMs: number = 500 // gap between verses
  ): Promise<SongTimeline> {
    console.log(`🚀 DEBUG: buildTimeline called at ${new Date().toISOString()}`);
    console.log(`🎼 Building song timeline with ${renderedSegments.size} rendered segments`);
    
    const segments: AudioSegment[] = [];
    let currentTimeMs = 0;

    // Sort lines by their original order
    const sortedLines = lyricsLines
      .map((line, index) => ({ ...line, originalIndex: index }))
      .sort((a, b) => {
        // Sort by verse number first, then by original index
        if (a.verseNumber !== b.verseNumber) {
          return a.verseNumber - b.verseNumber;
        }
        return a.originalIndex - b.originalIndex;
      });

    for (const line of sortedLines) {
      const audioUrl = renderedSegments.get(line.originalIndex);
      
      if (audioUrl) {
        // Use estimated duration to avoid blocking timeline building
        // We can load accurate durations in the background later
        const estimatedDuration = this.estimateVerseDuration(line.text || '');
        
        segments.push({
          lineIndex: line.originalIndex,
          audioUrl,
          startTimeMs: currentTimeMs,
          durationMs: estimatedDuration,
          verseNumber: line.verseNumber || 1,
          lyrics: line.text || ''
        });

        currentTimeMs += estimatedDuration + silenceGapMs;
        console.log(`📝 Added segment ${line.originalIndex}: "${line.text?.slice(0, 30)}..." at ${currentTimeMs}ms (estimated)`);
        
        // Load accurate duration in background (non-blocking)
        this.loadAccurateDurationAsync(line.originalIndex, audioUrl);
      } else {
        // Add placeholder for unrendered segments
        const estimatedDuration = this.estimateVerseDuration(line.text || '');
        segments.push({
          lineIndex: line.originalIndex,
          audioUrl: '',
          startTimeMs: currentTimeMs,
          durationMs: estimatedDuration,
          verseNumber: line.verseNumber || 1,
          lyrics: line.text || ''
        });

        currentTimeMs += estimatedDuration + silenceGapMs;
        console.log(`⏳ Placeholder for unrendered segment ${line.originalIndex} at ${currentTimeMs}ms`);
      }
    }

    this.timeline = {
      segments,
      totalDurationMs: currentTimeMs - silenceGapMs, // Remove last gap
      silenceGapMs
    };

    console.log(`✅ Timeline built: ${segments.length} segments, ${Math.round(currentTimeMs / 1000)}s total`);
    return this.timeline;
  }

  /**
   * Start full song playback
   */
  async playFullSong(onProgress?: (currentTimeMs: number, segment: AudioSegment | null) => void): Promise<void> {
    if (!this.timeline || !this.audioContext || !this.masterGainNode) {
      console.error('Timeline or audio context not ready');
      return;
    }

    // Stop any current playback
    this.stopPlayback();

    console.log('🎵 Starting full song playback');
    const sources: AudioBufferSourceNode[] = [];
    const startTime = this.audioContext.currentTime;

    // Pre-load all audio buffers
    await this.preloadAudioBuffers();

    // Schedule all segments
    for (const segment of this.timeline.segments) {
      if (segment.audioUrl && this.segmentBuffers.has(segment.lineIndex)) {
        const source = this.audioContext.createBufferSource();
        const buffer = this.segmentBuffers.get(segment.lineIndex)!;
        
        source.buffer = buffer;
        source.connect(this.masterGainNode);
        
        // Schedule playback at the correct time
        const playTime = startTime + (segment.startTimeMs / 1000);
        source.start(playTime);
        
        sources.push(source);
        console.log(`🎼 Scheduled segment ${segment.lineIndex} at ${playTime}s`);
      }
    }

    this.currentPlayback = {
      startTime,
      sources,
      isPlaying: true
    };

    // Progress tracking
    if (onProgress) {
      this.trackProgress(onProgress);
    }

    // Auto-cleanup when done
    setTimeout(() => {
      this.stopPlayback();
    }, this.timeline.totalDurationMs);
  }

  /**
   * Hot-swap a segment during playback
   */
  async updateSegment(lineIndex: number, newAudioUrl: string): Promise<void> {
    if (!this.timeline) return;

    console.log(`🔄 Hot-swapping segment ${lineIndex} with new audio`);
    
    // Update timeline
    const segmentIndex = this.timeline.segments.findIndex(s => s.lineIndex === lineIndex);
    if (segmentIndex !== -1) {
      const segment = this.timeline.segments[segmentIndex];
      const oldUrl = segment.audioUrl;
      segment.audioUrl = newAudioUrl;
      
      // Update duration if needed
      const newDuration = await this.getAudioDuration(newAudioUrl);
      segment.durationMs = newDuration;
      
      // Preload new buffer
      await this.loadAudioBuffer(lineIndex, newAudioUrl);
      
      console.log(`✅ Segment ${lineIndex} updated: ${oldUrl ? 'replaced' : 'added'}`);
    }
  }

  /**
   * Stop current playback
   */
  stopPlayback(): void {
    if (this.currentPlayback) {
      console.log('⏹️ Stopping full song playback');
      
      this.currentPlayback.sources.forEach(source => {
        try {
          source.stop();
          source.disconnect();
        } catch (error) {
          // Source might already be stopped
        }
      });
      
      this.currentPlayback = null;
    }
  }

  /**
   * Get playback status
   */
  getPlaybackStatus(): { isPlaying: boolean; currentTimeMs: number; totalDurationMs: number } {
    const isPlaying = this.currentPlayback?.isPlaying || false;
    const currentTimeMs = this.currentPlayback 
      ? (this.audioContext!.currentTime - this.currentPlayback.startTime) * 1000 
      : 0;
    const totalDurationMs = this.timeline?.totalDurationMs || 0;

    return { isPlaying, currentTimeMs, totalDurationMs };
  }

  private async preloadAudioBuffers(): Promise<void> {
    if (!this.timeline) return;

    const loadPromises = this.timeline.segments
      .filter(segment => segment.audioUrl && !this.segmentBuffers.has(segment.lineIndex))
      .map(segment => this.loadAudioBuffer(segment.lineIndex, segment.audioUrl));

    await Promise.all(loadPromises);
    console.log(`📦 Preloaded ${loadPromises.length} audio buffers`);
  }

  private async loadAudioBuffer(lineIndex: number, audioUrl: string): Promise<void> {
    if (!this.audioContext) return;

    try {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      
      this.segmentBuffers.set(lineIndex, audioBuffer);
    } catch (error) {
      console.error(`Failed to load audio buffer for segment ${lineIndex}:`, error);
    }
  }

  private async getAudioDuration(audioUrl: string): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio(audioUrl);
      audio.onloadedmetadata = () => {
        resolve(audio.duration * 1000); // Convert to milliseconds
      };
      audio.onerror = () => {
        resolve(3000); // Fallback: 3 seconds
      };
    });
  }

  private estimateVerseDuration(lyrics: string): number {
    // Rough estimate: 150 words per minute, average 4 chars per word
    const wordCount = lyrics.split(' ').filter(w => w.trim()).length;
    const estimatedMs = (wordCount / 150) * 60 * 1000;
    return Math.max(estimatedMs, 3000); // Minimum 3 seconds (more realistic)
  }

  /**
   * Load accurate duration in background without blocking timeline
   */
  private async loadAccurateDurationAsync(lineIndex: number, audioUrl: string): Promise<void> {
    try {
      const accurateDuration = await this.getAudioDuration(audioUrl);
      
      // Update the timeline segment with accurate duration
      if (this.timeline) {
        const segment = this.timeline.segments.find(s => s.lineIndex === lineIndex);
        if (segment) {
          const oldDuration = segment.durationMs;
          segment.durationMs = accurateDuration;
          console.log(`🎯 Updated segment ${lineIndex} duration: ${oldDuration}ms → ${accurateDuration}ms`);
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not load accurate duration for segment ${lineIndex}:`, error);
    }
  }

  private trackProgress(onProgress: (currentTimeMs: number, segment: AudioSegment | null) => void): void {
    if (!this.currentPlayback || !this.timeline) return;

    const interval = setInterval(() => {
      if (!this.currentPlayback?.isPlaying) {
        clearInterval(interval);
        return;
      }

      const currentTimeMs = (this.audioContext!.currentTime - this.currentPlayback.startTime) * 1000;
      
      // Find current segment
      const currentSegment = this.timeline!.segments.find(segment => 
        currentTimeMs >= segment.startTimeMs && 
        currentTimeMs < segment.startTimeMs + segment.durationMs
      );

      onProgress(currentTimeMs, currentSegment || null);
    }, 100); // Update every 100ms
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.stopPlayback();
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    
    this.segmentBuffers.clear();
    console.log('🧹 Full song playback manager disposed');
  }
}