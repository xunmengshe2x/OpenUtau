import { NextRequest, NextResponse } from 'next/server';
import { segmentCache } from '@/utils/segmentCache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'stats') {
      // Return cache statistics
      const stats = segmentCache.getCacheStats();
      return NextResponse.json({
        success: true,
        stats
      });
    }

    // Default: return basic cache info
    return NextResponse.json({
      success: true,
      message: 'Segment cache is active',
      availableActions: ['stats', 'clear']
    });

  } catch (error) {
    console.error('Cache management error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to manage segment cache',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action === 'clear') {
      await segmentCache.clearCache();
      return NextResponse.json({
        success: true,
        message: 'Segment cache cleared successfully'
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Unknown action'
    }, { status: 400 });

  } catch (error) {
    console.error('Cache management error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to manage segment cache',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}