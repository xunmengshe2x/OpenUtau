import { USTXData } from '@/types/openutau';
import { segmentCache } from './segmentCache';

/**
 * Smart cache invalidation utilities
 */

interface LyricsChange {
  verseNumber: number;
  oldLyrics: string;
  newLyrics: string;
}

export class CacheInvalidationManager {
  /**
   * Invalidate cache entries affected by lyrics changes
   */
  static async invalidateChangedSegments(
    originalUstxData: USTXData,
    updatedUstxData: USTXData,
    changedVerses: LyricsChange[]
  ): Promise<void> {
    console.log(`🔄 Starting smart cache invalidation for ${changedVerses.length} changed verses`);

    // For now, we'll use a simple approach: clear all cache when any lyrics change
    // This can be optimized later to only clear affected segments based on phrase mapping
    
    const stats = segmentCache.getCacheStats();
    if (stats.totalSegments > 0) {
      console.log(`🗑️ Clearing ${stats.totalSegments} cached segments due to lyrics changes`);
      await segmentCache.clearCache();
    } else {
      console.log('✅ No cached segments to invalidate');
    }

    // Log the changes for debugging
    changedVerses.forEach(change => {
      console.log(`📝 Verse ${change.verseNumber} changed:`);
      console.log(`   Old: "${change.oldLyrics?.slice(0, 50)}..."`);
      console.log(`   New: "${change.newLyrics?.slice(0, 50)}..."`);
    });
  }

  /**
   * Invalidate all cache entries for a specific singer
   */
  static async invalidateForSinger(singerId: string): Promise<void> {
    console.log(`🎤 Invalidating cache for singer: ${singerId}`);
    
    // For now, clear all cache - could be optimized to only clear segments for this singer
    await segmentCache.clearCache();
  }

  /**
   * Invalidate cache when USTX structure changes (tempo, key, etc.)
   */
  static async invalidateStructuralChanges(
    originalUstxData: USTXData,
    updatedUstxData: USTXData
  ): Promise<void> {
    const structuralChanges: string[] = [];

    // Check for tempo changes
    if (originalUstxData.bpm !== updatedUstxData.bpm) {
      structuralChanges.push(`BPM: ${originalUstxData.bpm} → ${updatedUstxData.bpm}`);
    }

    // Check for resolution changes
    if (originalUstxData.resolution !== updatedUstxData.resolution) {
      structuralChanges.push(`Resolution: ${originalUstxData.resolution} → ${updatedUstxData.resolution}`);
    }

    // Check for note timing/pitch changes (simplified check)
    const originalNotes = originalUstxData.voice_parts?.[0]?.notes || [];
    const updatedNotes = updatedUstxData.voice_parts?.[0]?.notes || [];
    
    if (originalNotes.length !== updatedNotes.length) {
      structuralChanges.push(`Note count: ${originalNotes.length} → ${updatedNotes.length}`);
    }

    if (structuralChanges.length > 0) {
      console.log(`🏗️ Structural changes detected: ${structuralChanges.join(', ')}`);
      console.log('🗑️ Clearing entire cache due to structural changes');
      await segmentCache.clearCache();
    } else {
      console.log('✅ No structural changes detected');
    }
  }

  /**
   * Preemptively warm cache for common segments
   */
  static async warmCache(
    ustxData: USTXData,
    singerId: string,
    qualityMode: string = 'standard'
  ): Promise<void> {
    console.log('🔥 Starting cache warming (not implemented yet)');
    
    // This could pre-render common segments in the background
    // For now, just log the intent
    console.log(`   USTX: ${ustxData.name || 'Unnamed'}`);
    console.log(`   Singer: ${singerId}`);
    console.log(`   Quality: ${qualityMode}`);
  }
}