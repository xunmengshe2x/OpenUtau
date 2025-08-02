/**
 * Timeline-based Full Song Player
 * 
 * Uses the precise timing data from phonemizer to play segments
 * with exact silences as they appear in the original song
 */

interface TimelineSegment {
  verseNumber: number;
  lyrics: string;
  startNoteIndex: number;
  endNoteIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  hasAudio: boolean;
}

interface FullSongTimeline {
  templateName: string;
  totalDurationMs: number;
  totalSegments: number;
  availableSegments: number;
  timeline: TimelineSegment[];
  generatedAt: string;
}

export class TimelineFullSongPlayer {
  private audioContext: AudioContext | null = null;
  private timeline: FullSongTimeline | null = null;
  private currentPlayback: {
    startTime: number;
    sources: AudioBufferSourceNode[];
    isPlaying: boolean;
  } | null = null;
  private segmentBuffers: Map<number, AudioBuffer> = new Map();

  constructor() {
    this.initializeAudioContext();
  }

  private async initializeAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('🎵 Timeline audio context initialized');
    } catch (error) {
      console.error('Failed to initialize audio context:', error);
    }
  }

  /**
   * Load timeline data from API
   */
  async loadTimeline(templateName: string): Promise<FullSongTimeline> {
    console.log(`📊 Loading timeline for ${templateName}...`);
    
    const response = await fetch(`/api/full-song-timeline?template=${templateName}`);
    if (!response.ok) {
      throw new Error('Failed to load timeline');
    }
    
    this.timeline = await response.json();
    console.log(`✅ Timeline loaded: ${this.timeline.availableSegments}/${this.timeline.totalSegments} segments, ${(this.timeline.totalDurationMs / 1000).toFixed(1)}s`);
    
    return this.timeline;
  }

  /**
   * Pre-load all available audio segments
   */
  private async preloadAudioSegments(): Promise<void> {
    if (!this.timeline || !this.audioContext) return;

    console.log('📦 Pre-loading audio segments...');
    
    const loadPromises = this.timeline.timeline
      .filter(segment => segment.hasAudio)
      .map(async (segment) => {
        try {
          const response = await fetch(`/api/prerendered-segment?template=${this.timeline!.templateName}&segment=${segment.startNoteIndex}`);
          if (!response.ok) {
            console.warn(`⚠️ Failed to load segment ${segment.verseNumber}`);
            return;
          }
          
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
          
          this.segmentBuffers.set(segment.verseNumber, audioBuffer);
          console.log(`🎵 Loaded segment ${segment.verseNumber}: ${audioBuffer.duration.toFixed(2)}s`);
          
        } catch (error) {
          console.warn(`⚠️ Error loading segment ${segment.verseNumber}:`, error);
        }
      });

    await Promise.all(loadPromises);
    console.log(`✅ Pre-loaded ${this.segmentBuffers.size} audio segments`);
  }

  /**
   * Play the full song with precise timing
   */
  async playFullSong(
    onProgress?: (currentTimeMs: number, currentSegment: TimelineSegment | null) => void
  ): Promise<void> {
    if (!this.timeline || !this.audioContext) {
      throw new Error('Timeline or audio context not ready');
    }

    // Stop any current playback
    this.stopPlayback();

    console.log('🎼 Starting timeline-based full song playback');
    
    // Pre-load all segments
    await this.preloadAudioSegments();
    
    const sources: AudioBufferSourceNode[] = [];
    const startTime = this.audioContext.currentTime;
    
    // Schedule all available segments at their precise times
    for (const segment of this.timeline.timeline) {
      if (segment.hasAudio && this.segmentBuffers.has(segment.verseNumber)) {
        const source = this.audioContext.createBufferSource();
        const buffer = this.segmentBuffers.get(segment.verseNumber)!;
        
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        
        // Schedule at the exact time from the timeline
        const playTime = startTime + (segment.startTimeMs / 1000);
        source.start(playTime);
        
        sources.push(source);
        console.log(`🎼 Scheduled verse ${segment.verseNumber} at ${playTime.toFixed(2)}s (${segment.startTimeMs}ms)`);
      } else {
        console.log(`🔇 Silence for verse ${segment.verseNumber} (${segment.startTimeMs}ms - ${segment.endTimeMs}ms)`);
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
    }, this.timeline.totalDurationMs + 1000); // Add 1s buffer
  }

  /**
   * Stop current playback
   */
  stopPlayback(): void {
    if (this.currentPlayback) {
      console.log('⏹️ Stopping timeline playback');
      
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
   * Get current playback status
   */
  getPlaybackStatus(): { 
    isPlaying: boolean; 
    currentTimeMs: number; 
    totalDurationMs: number;
    currentSegment: TimelineSegment | null;
  } {
    const isPlaying = this.currentPlayback?.isPlaying || false;
    const currentTimeMs = this.currentPlayback && this.audioContext
      ? (this.audioContext.currentTime - this.currentPlayback.startTime) * 1000 
      : 0;
    const totalDurationMs = this.timeline?.totalDurationMs || 0;
    
    // Find current segment
    const currentSegment = this.timeline?.timeline.find(segment => 
      currentTimeMs >= segment.startTimeMs && 
      currentTimeMs <= segment.endTimeMs
    ) || null;

    return { isPlaying, currentTimeMs, totalDurationMs, currentSegment };
  }

  private trackProgress(
    onProgress: (currentTimeMs: number, currentSegment: TimelineSegment | null) => void
  ): void {
    if (!this.currentPlayback || !this.timeline) return;

    const interval = setInterval(() => {
      if (!this.currentPlayback?.isPlaying) {
        clearInterval(interval);
        return;
      }

      const status = this.getPlaybackStatus();
      onProgress(status.currentTimeMs, status.currentSegment);
      
    }, 100); // Update every 100ms
  }

  /**
   * Get timeline info
   */
  getTimelineInfo(): FullSongTimeline | null {
    return this.timeline;
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
    console.log('🧹 Timeline player disposed');
  }
}