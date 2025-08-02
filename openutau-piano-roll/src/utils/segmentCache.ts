import { createHash } from 'crypto';
import { readFile, writeFile, unlink, access } from 'fs/promises';
import { join } from 'path';
import { USTXData } from '@/types/openutau';

interface CachedSegment {
  hash: string;
  filePath: string;
  metadata: {
    phraseNumbers: number[];
    startNoteIndex: number;
    endNoteIndex: number;
    singerId: string;
    qualityMode: string;
    createdAt: string;
    durationMs?: number;
  };
}

interface SegmentCacheIndex {
  [segmentHash: string]: CachedSegment;
}

const CACHE_DIR = '/workspaces/OpenUtau/.segment_cache';
const CACHE_INDEX_FILE = join(CACHE_DIR, 'cache_index.json');
const MAX_CACHE_SIZE = 100; // Maximum number of cached segments

export class SegmentCacheManager {
  private cacheIndex: SegmentCacheIndex = {};

  constructor() {
    this.loadCacheIndex();
  }

  /**
   * Generate a hash for a segment based on its content and rendering parameters
   */
  private generateSegmentHash(
    ustxData: USTXData,
    phraseNumbers: number[],
    singerId: string,
    qualityMode: string = 'standard'
  ): string {
    // Extract only the relevant notes for this segment
    const vocalPart = ustxData.voice_parts?.[0];
    if (!vocalPart?.notes) {
      throw new Error('No vocal part found in USTX data');
    }

    // Create a minimal representation of the segment for hashing
    const segmentData = {
      phraseNumbers: phraseNumbers.sort(),
      notes: vocalPart.notes.map(note => ({
        lyric: note.lyric,
        phonemes: note.phonemes,
        position: note.position,
        duration: note.duration,
        tone: note.tone
      })),
      singerId,
      qualityMode,
      bpm: ustxData.bpm,
      resolution: ustxData.resolution
    };

    const segmentJson = JSON.stringify(segmentData);
    const hash = createHash('sha256').update(segmentJson).digest('hex');
    return hash.substring(0, 16); // Use first 16 chars for shorter filenames
  }

  /**
   * Check if a segment is cached and still valid
   */
  async isSegmentCached(
    ustxData: USTXData,
    phraseNumbers: number[],
    singerId: string,
    qualityMode: string = 'standard'
  ): Promise<string | null> {
    const segmentHash = this.generateSegmentHash(ustxData, phraseNumbers, singerId, qualityMode);
    const cachedSegment = this.cacheIndex[segmentHash];
    
    if (!cachedSegment) {
      return null;
    }

    // Check if cached file still exists
    try {
      await access(cachedSegment.filePath);
      console.log(`✅ Cache hit for segment ${segmentHash} (phrases: ${phraseNumbers.join(',')})`);
      return cachedSegment.filePath;
    } catch {
      // File doesn't exist, remove from cache index
      delete this.cacheIndex[segmentHash];
      await this.saveCacheIndex();
      return null;
    }
  }

  /**
   * Cache a rendered segment
   */
  async cacheSegment(
    ustxData: USTXData,
    phraseNumbers: number[],
    singerId: string,
    audioBuffer: Buffer,
    qualityMode: string = 'standard',
    startNoteIndex?: number,
    endNoteIndex?: number
  ): Promise<string> {
    const segmentHash = this.generateSegmentHash(ustxData, phraseNumbers, singerId, qualityMode);
    const cachedFilePath = join(CACHE_DIR, `segment_${segmentHash}.wav`);

    // Ensure cache directory exists
    await this.ensureCacheDir();

    // Write audio file to cache
    await writeFile(cachedFilePath, audioBuffer);

    // Add to cache index
    this.cacheIndex[segmentHash] = {
      hash: segmentHash,
      filePath: cachedFilePath,
      metadata: {
        phraseNumbers: phraseNumbers.sort(),
        startNoteIndex: startNoteIndex || 0,
        endNoteIndex: endNoteIndex || 0,
        singerId,
        qualityMode,
        createdAt: new Date().toISOString()
      }
    };

    // Clean up old cache entries if we exceed the limit
    await this.cleanupOldEntries();
    
    // Save updated index
    await this.saveCacheIndex();
    
    console.log(`💾 Cached segment ${segmentHash} (phrases: ${phraseNumbers.join(',')}) at ${cachedFilePath}`);
    return cachedFilePath;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalSegments: number;
    cacheSize: string;
    oldestEntry: string;
    newestEntry: string;
  } {
    const entries = Object.values(this.cacheIndex);
    const dates = entries.map(e => new Date(e.metadata.createdAt));
    
    return {
      totalSegments: entries.length,
      cacheSize: `${entries.length}/${MAX_CACHE_SIZE}`,
      oldestEntry: dates.length ? Math.min(...dates.map(d => d.getTime())).toString() : 'N/A',
      newestEntry: dates.length ? Math.max(...dates.map(d => d.getTime())).toString() : 'N/A'
    };
  }

  /**
   * Clear all cached segments
   */
  async clearCache(): Promise<void> {
    const entries = Object.values(this.cacheIndex);
    
    // Delete all cached files
    await Promise.all(
      entries.map(entry => 
        unlink(entry.filePath).catch(() => {}) // Ignore errors if file doesn't exist
      )
    );

    // Clear index
    this.cacheIndex = {};
    await this.saveCacheIndex();
    
    console.log('🗑️ Segment cache cleared');
  }

  /**
   * Find segments that need re-rendering after lyrics changes
   */
  findDirtySegments(
    originalUstxData: USTXData,
    updatedUstxData: USTXData,
    changedVerseNumbers: number[]
  ): string[] {
    // This would map verse numbers to phrase numbers and find affected segments
    // For now, return all cached segments as potentially dirty
    // This could be optimized with better verse-to-phrase mapping
    return Object.keys(this.cacheIndex);
  }

  private async loadCacheIndex(): Promise<void> {
    try {
      const indexData = await readFile(CACHE_INDEX_FILE, 'utf-8');
      this.cacheIndex = JSON.parse(indexData);
      console.log(`📋 Loaded segment cache index with ${Object.keys(this.cacheIndex).length} entries`);
    } catch {
      // Cache index doesn't exist or is invalid, start fresh
      this.cacheIndex = {};
    }
  }

  private async saveCacheIndex(): Promise<void> {
    await this.ensureCacheDir();
    await writeFile(CACHE_INDEX_FILE, JSON.stringify(this.cacheIndex, null, 2));
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await access(CACHE_DIR);
    } catch {
      // Directory doesn't exist, create it
      const { mkdir } = await import('fs/promises');
      await mkdir(CACHE_DIR, { recursive: true });
    }
  }

  private async cleanupOldEntries(): Promise<void> {
    const entries = Object.entries(this.cacheIndex);
    
    if (entries.length <= MAX_CACHE_SIZE) {
      return;
    }

    // Sort by creation date (oldest first)
    entries.sort((a, b) => 
      new Date(a[1].metadata.createdAt).getTime() - 
      new Date(b[1].metadata.createdAt).getTime()
    );

    // Remove oldest entries
    const entriesToRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    
    for (const [hash, entry] of entriesToRemove) {
      // Delete the cached file
      await unlink(entry.filePath).catch(() => {});
      // Remove from index
      delete this.cacheIndex[hash];
    }

    console.log(`🧹 Cleaned up ${entriesToRemove.length} old cache entries`);
  }
}

// Singleton instance
export const segmentCache = new SegmentCacheManager();