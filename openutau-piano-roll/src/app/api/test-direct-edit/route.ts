import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { verseNumber = 4, newLyrics = "a Snow falls in silence With all that I wish I could say" } = await request.json();
    
    console.log(`🧪 TESTING: Direct edit of verse ${verseNumber} with: "${newLyrics}"`);
    
    // Call the direct edit endpoint
    const editResponse = await fetch('http://localhost:3000/api/edit-verse-direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verseNumber,
        newLyrics
      })
    });
    
    if (editResponse.ok) {
      const result = await editResponse.json();
      console.log('✅ Direct edit successful:', result);
      
      return NextResponse.json({
        success: true,
        test: 'Direct verse editing',
        result: result
      });
    } else {
      const error = await editResponse.text();
      console.error('❌ Direct edit failed:', error);
      
      return NextResponse.json({
        success: false,
        error: error
      }, { status: editResponse.status });
    }
    
  } catch (error) {
    console.error('Error in test direct edit:', error);
    return NextResponse.json(
      { error: 'Failed to test direct edit' },
      { status: 500 }
    );
  }
}