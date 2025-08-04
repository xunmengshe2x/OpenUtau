import { NextRequest, NextResponse } from 'next/server';
import { readFile, access } from 'fs/promises';
import { join } from 'path';

const WORKSPACE_PATH = '/workspaces/OpenUtau';
const PRERENDERED_DIR = join(WORKSPACE_PATH, '.prerendered_segments');

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateName = searchParams.get('template');

    if (!templateName) {
      return NextResponse.json({ error: 'Template name required' }, { status: 400 });
    }

    // Load manifest to get segment information
    const manifestPath = join(PRERENDERED_DIR, `${templateName}_manifest.json`);
    
    try {
      await access(manifestPath);
      const manifestData = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestData);
      
      // Load cached verse data to get timing information
      const cacheFile = join(WORKSPACE_PATH, `${templateName}_cache.json`);
      const cacheData = JSON.parse(await readFile(cacheFile, 'utf-8'));
      const verses = cacheData.verses;

      // Return segments and timing data for client-side combination
      console.log(`🎼 Preparing full song data for ${templateName} with ${manifest.segments.length} segments`);
      
      const fullSongData = {
        templateName,
        segments: manifest.segments,
        verses: verses,
        totalSegments: verses.length,
        availableSegments: manifest.segments.length
      };
      
      return NextResponse.json(fullSongData, {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=3600',
          'Content-Type': 'application/json'
        },
      });
      
    } catch (error) {
      return NextResponse.json({ error: 'Template manifest not found' }, { status: 404 });
    }

  } catch (error) {
    console.error('Error preparing full song data:', error);
    return NextResponse.json({ 
      error: 'Failed to prepare full song data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}