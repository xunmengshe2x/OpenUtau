/**
 * Template Pre-Renderer
 * 
 * Pre-renders all segments of a template when it loads
 * so full song playback is immediately available
 */

export class TemplatePreRenderer {
  private renderQueue: Array<{
    lineIndex: number;
    startNoteIndex: number;
    endNoteIndex: number;
    lyrics: string;
  }> = [];

  private isRendering = false;
  private onProgress?: (completed: number, total: number, currentLyrics: string) => void;

  /**
   * Pre-render all segments for a template
   */
  async preRenderTemplate(
    ustxData: any,
    cachedVerses: any[],
    singerId: string = 'fem_1_ln',
    onProgressCallback?: (completed: number, total: number, currentLyrics: string) => void
  ): Promise<Map<number, string>> {
    console.log(`🎬 Starting pre-render for template with ${cachedVerses.length} verses`);
    
    this.onProgress = onProgressCallback;
    const renderedSegments = new Map<number, string>();
    
    // Build render queue from cached verses
    this.renderQueue = cachedVerses.map((verse, index) => ({
      lineIndex: index,
      startNoteIndex: verse.startNoteIndex,
      endNoteIndex: verse.endNoteIndex,
      lyrics: verse.lyrics
    }));

    this.isRendering = true;
    let completed = 0;

    // Render segments in batches to avoid overwhelming the system
    const batchSize = 3; // Render 3 segments at a time
    
    for (let i = 0; i < this.renderQueue.length; i += batchSize) {
      const batch = this.renderQueue.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (segment) => {
        try {
          this.onProgress?.(completed, this.renderQueue.length, segment.lyrics);
          
          const audioUrl = await this.renderSegment(
            ustxData,
            singerId,
            segment.startNoteIndex,
            segment.endNoteIndex,
            segment.lineIndex
          );
          
          if (audioUrl) {
            renderedSegments.set(segment.lineIndex, audioUrl);
            console.log(`✅ Pre-rendered segment ${segment.lineIndex}: "${segment.lyrics.slice(0, 30)}..."`);
          }
          
          completed++;
          this.onProgress?.(completed, this.renderQueue.length, segment.lyrics);
          
          return audioUrl;
        } catch (error) {
          console.error(`❌ Failed to pre-render segment ${segment.lineIndex}:`, error);
          completed++;
          return null;
        }
      });

      // Wait for batch to complete before starting next batch
      await Promise.all(batchPromises);
      
      // Small delay between batches to prevent overwhelming
      if (i + batchSize < this.renderQueue.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    this.isRendering = false;
    console.log(`🎉 Template pre-render complete: ${renderedSegments.size}/${this.renderQueue.length} segments rendered`);
    
    return renderedSegments;
  }

  /**
   * Render a single segment
   */
  private async renderSegment(
    ustxData: any,
    singerId: string,
    startNoteIndex: number,
    endNoteIndex: number,
    lineIndex: number
  ): Promise<string | null> {
    try {
      const response = await fetch('/api/render-segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxData,
          singerId,
          startNoteIndex,
          endNoteIndex,
          lineIndex,
          qualitySettings: { quality: 'standard' }
        }),
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        return URL.createObjectURL(audioBlob);
      } else {
        console.error(`Render failed with status: ${response.status}`);
        return null;
      }
    } catch (error) {
      console.error('Render request failed:', error);
      return null;
    }
  }

  /**
   * Check if currently rendering
   */
  isCurrentlyRendering(): boolean {
    return this.isRendering;
  }

  /**
   * Stop rendering process
   */
  stopRendering(): void {
    this.isRendering = false;
    this.renderQueue = [];
  }
}