import { NextRequest, NextResponse } from 'next/server';

interface VersesCacheData {
  verses: any[];
  wordMapping: { [verseNumber: number]: { startIndex: number; endIndex: number; wordCount: number } };
  ustxData: any;
  timestamp: string;
}

// In-memory cache for verses data (could be moved to Redis/DB later)
let versesCache: VersesCacheData | null = null;

export async function GET() {
  try {
    if (!versesCache) {
      return NextResponse.json({ error: 'No verses cached' }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      data: versesCache
    });
  } catch (error) {
    console.error('Error retrieving verses cache:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve verses cache' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { verses, ustxData } = await request.json();
    
    if (!verses || !ustxData) {
      return NextResponse.json({ error: 'Verses and USTX data are required' }, { status: 400 });
    }
    
    console.log('💾 Caching verses data:', verses.length, 'verses');
    
    // Build word mapping from verses
    const wordMapping: { [verseNumber: number]: { startIndex: number; endIndex: number; wordCount: number } } = {};
    let currentWordIndex = 0;
    
    for (const verse of verses) {
      const wordCount = verse.lyrics ? verse.lyrics.split(' ').length : 0;
      wordMapping[verse.phraseNumber] = {
        startIndex: currentWordIndex,
        endIndex: currentWordIndex + wordCount - 1,
        wordCount: wordCount
      };
      currentWordIndex += wordCount;
      
      console.log(`📝 Verse ${verse.phraseNumber}: words ${wordMapping[verse.phraseNumber].startIndex}-${wordMapping[verse.phraseNumber].endIndex} (${wordCount} words)`);
    }
    
    versesCache = {
      verses,
      wordMapping,
      ustxData,
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Successfully cached verses data with word mapping');
    
    return NextResponse.json({
      success: true,
      cached: {
        versesCount: verses.length,
        totalWords: currentWordIndex,
        wordMapping: wordMapping
      }
    });
  } catch (error) {
    console.error('Error caching verses:', error);
    return NextResponse.json(
      { error: 'Failed to cache verses data' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    versesCache = null;
    console.log('🗑️ Cleared verses cache');
    
    return NextResponse.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}