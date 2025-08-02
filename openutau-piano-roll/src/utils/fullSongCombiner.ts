/**
 * Full Song Audio Combiner
 * 
 * Combines pre-rendered segments with proper silences using Web Audio API
 */

interface SegmentData {
  index: number;
  path: string;
  verse: any;
}

interface FullSongData {
  templateName: string;
  segments: SegmentData[];
  verses: any[];
  totalSegments: number;
  availableSegments: number;
}

export class FullSongCombiner {
  private audioContext: AudioContext | null = null;
  private combinedBuffer: AudioBuffer | null = null;

  constructor() {
    // AudioContext will be created when needed
  }

  private async initAudioContext(): Promise<AudioContext> {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  /**
   * Combine segments with calculated silences based on timing data
   */
  async combineSegments(templateName: string, replacementSegments?: Map<number, string>): Promise<string | null> {
    try {
      console.log(`🎼 Combining segments for ${templateName} using timing-based approach...`);
      
      // Get template timing data
      const templateResponse = await fetch(`/api/templates?name=${templateName}`);
      if (!templateResponse.ok) {
        throw new Error('Failed to load template timing data');
      }
      
      const templateData = await templateResponse.json();
      const verses = templateData.cachedVerseDetection?.verses;
      
      if (!verses) {
        throw new Error('No verse timing data found');
      }
      
      console.log(`📊 Got timing data for ${verses.length} verses`);
      
      // Limit to first 8 segments for performance (about 1 minute of audio)
      const maxSegments = Math.min(8, verses.length);
      const limitedVerses = verses.slice(0, maxSegments);
      console.log(`🎯 Loading first ${maxSegments} segments for performance`);
      
      const audioContext = await this.initAudioContext();
      const sampleRate = audioContext.sampleRate;
      const numberOfChannels = 2; // Stereo
      
      // Calculate total duration from the last processed verse
      const lastVerse = limitedVerses[limitedVerses.length - 1];
      const totalDurationMs = lastVerse.endTimeMs || (lastVerse.startTimeMs + lastVerse.durationMs);
      const totalDurationSamples = Math.ceil((totalDurationMs / 1000) * sampleRate);
      
      console.log(`📏 Total song duration: ${(totalDurationMs / 1000).toFixed(2)}s (limited)`);
      
      // Create combined buffer
      const combinedBuffer = audioContext.createBuffer(numberOfChannels, totalDurationSamples, sampleRate);
      
      // Load segments in parallel with concurrency control
      const segmentPromises: Promise<void>[] = [];
      
      for (let i = 0; i < limitedVerses.length; i++) {
        const verse = limitedVerses[i];
        const replacementUrl = replacementSegments?.get(i);
        
        let segmentUrl: string;
        let isReplacement = false;
        
        if (replacementUrl) {
          segmentUrl = replacementUrl;
          isReplacement = true;
          console.log(`🔄 Queuing replacement segment ${i} at ${verse.startTimeMs}ms`);
        } else {
          // Use original prerendered segment
          segmentUrl = `/api/prerendered-segments/${templateName}/${i}`;
          console.log(`📦 Queuing original prerendered segment ${i} at ${verse.startTimeMs}ms`);
        }
        
        // Create a promise for each segment
        const segmentPromise = this.loadAndPlaceSegment(
          segmentUrl, 
          verse, 
          i, 
          isReplacement, 
          combinedBuffer, 
          audioContext, 
          sampleRate, 
          numberOfChannels, 
          totalDurationSamples
        );
        
        segmentPromises.push(segmentPromise);
      }
      
      // Load segments in parallel (with a reasonable concurrency limit)
      console.log(`🚀 Loading ${segmentPromises.length} segments in parallel...`);
      const results = await Promise.allSettled(segmentPromises);
      
      // Check results
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log(`📊 Segment loading complete: ${successful} successful, ${failed} failed`);
      
      if (successful === 0) {
        throw new Error('Failed to load any segments');
      }
      
      this.combinedBuffer = combinedBuffer;
      
      console.log(`📊 Combined buffer ready: ${combinedBuffer.duration.toFixed(2)}s, ${combinedBuffer.numberOfChannels} channels, ${combinedBuffer.sampleRate}Hz`);
      
      // Instead of converting to WAV, return a special identifier that indicates we have an AudioBuffer
      // The SimpleCopilotAudioPlayer will need to handle this differently
      console.log(`✅ Combined song created - returning AudioBuffer reference`);
      return 'audiobuffer:' + Date.now(); // Special URL format to indicate we have a buffer ready
      
    } catch (error) {
      console.error('Error combining segments:', error);
      return null;
    }
  }

  /**
   * Convert AudioBuffer to WAV blob
   */
  private async bufferToWav(buffer: AudioBuffer): Promise<Blob> {
    console.log('🔄 Starting bufferToWav conversion...');
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    
    const expectedSize = 44 + length * numberOfChannels * 2;
    console.log(`📊 Creating ArrayBuffer: ${(expectedSize / 1024 / 1024).toFixed(2)}MB`);
    
    // Check if the size is too large (over 50MB)
    if (expectedSize > 50 * 1024 * 1024) {
      console.warn('⚠️ Audio buffer very large, this might cause memory issues');
    }
    
    const arrayBuffer = new ArrayBuffer(expectedSize);
    console.log('✅ ArrayBuffer created successfully');
    
    const view = new DataView(arrayBuffer);
    console.log('✅ DataView created successfully');
    
    // WAV header
    console.log('🔄 Writing WAV header...');
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * numberOfChannels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * numberOfChannels * 2, true);
    console.log('✅ WAV header written');
    
    // Convert float data to 16-bit PCM with progress reporting
    console.log('🔄 Converting audio data to PCM...');
    let offset = 44;
    const chunkSize = 44100; // Process 1 second at a time
    
    for (let chunkStart = 0; chunkStart < length; chunkStart += chunkSize) {
      const chunkEnd = Math.min(chunkStart + chunkSize, length);
      
      for (let i = chunkStart; i < chunkEnd; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const sample = buffer.getChannelData(channel)[i];
          const int16 = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
          view.setInt16(offset, int16, true);
          offset += 2;
        }
      }
      
      // Report progress every second of audio
      const progress = ((chunkEnd / length) * 100).toFixed(1);
      console.log(`📊 PCM conversion progress: ${progress}%`);
      
      // Yield to the event loop to prevent freezing
      if (chunkEnd < length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    console.log('✅ PCM conversion complete, creating blob...');
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    console.log(`✅ WAV blob created: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
    
    return blob;
  }

  /**
   * Combine segments with replacement segments, generating a full song audio file
   * Client-side version that doesn't use file system operations
   */
  async combineWithReplacements(templateName: string, replacementSegments?: Map<number, string>): Promise<ArrayBuffer | null> {
    try {
      console.log(`🔄 Client-side combining with replacements for ${templateName}...`);
      
      // Use the existing combineSegments method with replacements
      const audioUrl = await this.combineSegments(templateName, replacementSegments);
      if (!audioUrl) {
        return null;
      }
      
      // Convert blob URL back to ArrayBuffer for file serving  
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      
      // Clean up blob URL
      URL.revokeObjectURL(audioUrl);
      
      return arrayBuffer;
      
    } catch (error) {
      console.error('Error combining with replacements:', error);
      return null;
    }
  }

  /**
   * Load and place a single segment into the combined buffer
   */
  private async loadAndPlaceSegment(
    segmentUrl: string,
    verse: any,
    index: number,
    isReplacement: boolean,
    combinedBuffer: AudioBuffer,
    audioContext: AudioContext,
    sampleRate: number,
    numberOfChannels: number,
    totalDurationSamples: number
  ): Promise<void> {
    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const segmentResponse = await fetch(segmentUrl, { 
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      
      if (!segmentResponse.ok) {
        throw new Error(`HTTP ${segmentResponse.status}`);
      }
      
      const arrayBuffer = await segmentResponse.arrayBuffer();
      const segmentBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Calculate where to place this segment in the timeline
      const startSample = Math.floor((verse.startTimeMs / 1000) * sampleRate);
      
      // Copy segment data into the combined buffer at the correct position
      for (let channel = 0; channel < Math.min(numberOfChannels, segmentBuffer.numberOfChannels); channel++) {
        const sourceData = segmentBuffer.getChannelData(channel);
        const targetData = combinedBuffer.getChannelData(channel);
        
        for (let sample = 0; sample < sourceData.length; sample++) {
          const targetIndex = startSample + sample;
          if (targetIndex < totalDurationSamples) {
            targetData[targetIndex] = sourceData[sample];
          }
        }
      }
      
      const segmentType = isReplacement ? 'replacement' : 'original';
      console.log(`✅ Placed ${segmentType} segment ${index} at ${verse.startTimeMs}ms (${segmentBuffer.duration.toFixed(2)}s)`);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠️ Failed to load segment ${index}: ${errorMsg}`);
      throw error; // Re-throw to be caught by Promise.allSettled
    }
  }

  /**
   * Get the combined AudioBuffer (for direct Web Audio API playback)
   */
  getCombinedBuffer(): AudioBuffer | null {
    return this.combinedBuffer;
  }

  /**
   * Get the audio context (for creating source nodes)
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.combinedBuffer = null;
  }
}