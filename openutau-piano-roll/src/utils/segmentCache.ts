import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { USTXData } from '@/types/openutau';

const CACHE_DIR = '/workspaces/OpenUtau/.segment_cache';

export class SegmentCache {
  private cacheIndexPath: string;
  private cacheIndex: Map<string, string> = new Map();

  constructor() {
    this.cacheIndexPath = join(CACHE_DIR, 'cache_index.json');
    this.initializeCache();
  }

  private async initializeCache() {
    try {
      // Ensure cache directory exists
      await fs.mkdir(CACHE_DIR, { recursive: true });
      
      // Load existing cache index
      try {
        const indexData = await fs.readFile(this.cacheIndexPath, 'utf-8');
        const indexObj = JSON.parse(indexData);
        this.cacheIndex = new Map(Object.entries(indexObj));
      } catch (error) {
        // Cache index doesn't exist or is invalid, start fresh
        console.log('Starting with fresh segment cache');
      }
    } catch (error) {
      console.error('Failed to initialize segment cache:', error);
    }
  }

  private generateCacheKey(
    ustxData: USTXData, 
    phraseNumbers: number[], 
    singerId: string, 
    qualityMode: string
  ): string {
    // Create a deterministic hash based on the input parameters
    const hashInput = JSON.stringify({
      ustxName: ustxData.name,
      resolution: ustxData.resolution,
      bpm: ustxData.bpm,
      phraseNumbers: phraseNumbers.sort(),
      singerId,
      qualityMode,
      // Include relevant notes for the phrases
      notes: ustxData.voice_parts?.flatMap(part => 
        part.notes?.map(note => ({
          position: note.position,
          duration: note.duration,
          tone: note.tone,
          lyric: note.lyric
        })) || []
      ) || []
    });

    return createHash('md5').update(hashInput).digest('hex').substring(0, 16);
  }

  async isSegmentCached(
    ustxData: USTXData,
    phraseNumbers: number[],
    singerId: string,
    qualityMode: string
  ): Promise<string | null> {
    const cacheKey = this.generateCacheKey(ustxData, phraseNumbers, singerId, qualityMode);
    const cachedPath = this.cacheIndex.get(cacheKey);
    
    if (!cachedPath) {
      return null;
    }

    // Check if the cached file still exists
    try {
      await fs.access(cachedPath);
      return cachedPath;
    } catch (error) {
      // File doesn't exist, remove from index
      this.cacheIndex.delete(cacheKey);
      await this.saveCacheIndex();
      return null;
    }
  }

  async cacheSegment(
    ustxData: USTXData,
    phraseNumbers: number[],
    singerId: string,
    audioBuffer: Buffer,
    qualityMode: string,
    startNoteIndex?: number,
    endNoteIndex?: number
  ): Promise<string> {
    const cacheKey = this.generateCacheKey(ustxData, phraseNumbers, singerId, qualityMode);
    const fileName = `segment_${cacheKey}.wav`;
    const filePath = join(CACHE_DIR, fileName);

    try {
      // Write the audio file
      await fs.writeFile(filePath, audioBuffer);
      
      // Update cache index
      this.cacheIndex.set(cacheKey, filePath);
      await this.saveCacheIndex();
      
      console.log(`✅ Cached segment: ${fileName} (${audioBuffer.length} bytes)`);
      return filePath;
    } catch (error) {
      console.error('Failed to cache segment:', error);
      throw error;
    }
  }

  private async saveCacheIndex(): Promise<void> {
    try {
      const indexObj = Object.fromEntries(this.cacheIndex);
      await fs.writeFile(this.cacheIndexPath, JSON.stringify(indexObj, null, 2));
    } catch (error) {
      console.error('Failed to save cache index:', error);
    }
  }

  async clearCache(): Promise<void> {
    try {
      // Remove all cached files
      for (const filePath of this.cacheIndex.values()) {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // File might already be deleted, ignore
        }
      }
      
      // Clear the index
      this.cacheIndex.clear();
      await this.saveCacheIndex();
      
      console.log('✅ Segment cache cleared');
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  async getCacheStats(): Promise<{ totalFiles: number; totalSize: number }> {
    let totalFiles = 0;
    let totalSize = 0;

    for (const filePath of this.cacheIndex.values()) {
      try {
        const stats = await fs.stat(filePath);
        totalFiles++;
        totalSize += stats.size;
      } catch (error) {
        // File doesn't exist, will be cleaned up next time
      }
    }

    return { totalFiles, totalSize };
  }
}

// Export singleton instance
export const segmentCache = new SegmentCache();