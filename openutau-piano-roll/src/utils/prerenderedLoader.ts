/**
 * Pre-rendered Segments Loader
 * 
 * Loads pre-rendered template segments for immediate full song playback
 */

interface PrerenderedManifest {
  templateName: string;
  templateDisplayName: string;
  totalSegments: number;
  renderedSegments: number;
  prerenderDate: string;
  segments: Array<{
    index: number;
    path: string;
    verse: any;
  }>;
}

export class PrerenderedLoader {
  private static cache = new Map<string, Map<number, string>>();

  /**
   * Load pre-rendered segments for a template
   */
  static async loadPrerenderedSegments(templateName: string): Promise<Map<number, string>> {
    // Check cache first
    if (this.cache.has(templateName)) {
      console.log(`📦 Using cached pre-rendered segments for ${templateName}`);
      return this.cache.get(templateName)!;
    }

    try {
      // Try to load manifest
      const response = await fetch(`/api/prerendered-segments?template=${templateName}`);
      
      if (!response.ok) {
        console.log(`⚠️ No pre-rendered segments found for ${templateName}`);
        return new Map();
      }

      const manifest: PrerenderedManifest = await response.json();
      console.log(`🎬 Found ${manifest.renderedSegments} pre-rendered segments for ${manifest.templateDisplayName}`);

      const segmentUrls = new Map<number, string>();

      // Convert file paths to blob URLs for browser use
      for (const segment of manifest.segments) {
        try {
          const audioResponse = await fetch(`/api/prerendered-segments/${templateName}/${segment.index}`);
          if (audioResponse.ok) {
            const audioBlob = await audioResponse.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            segmentUrls.set(segment.index, audioUrl);
          }
        } catch (error) {
          console.warn(`Failed to load pre-rendered segment ${segment.index}:`, error);
        }
      }

      // Cache the results
      this.cache.set(templateName, segmentUrls);
      
      console.log(`✅ Loaded ${segmentUrls.size} pre-rendered segments for ${templateName}`);
      return segmentUrls;

    } catch (error) {
      console.error('Failed to load pre-rendered segments:', error);
      return new Map();
    }
  }

  /**
   * Check if template has pre-rendered segments available
   */
  static async hasPrerenderedSegments(templateName: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/prerendered-segments?template=${templateName}`, {
        method: 'HEAD'
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Clear cache for a template (useful when segments are updated)
   */
  static clearCache(templateName?: string): void {
    if (templateName) {
      this.cache.delete(templateName);
      console.log(`🗑️ Cleared pre-rendered cache for ${templateName}`);
    } else {
      this.cache.clear();
      console.log('🗑️ Cleared all pre-rendered caches');
    }
  }
}