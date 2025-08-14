import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';

export async function POST(request: NextRequest) {
  try {
    const { ustxData, filePath } = await request.json();
    
    if (!ustxData || !filePath) {
      return NextResponse.json({ error: 'Missing ustxData or filePath' }, { status: 400 });
    }

    // Write USTX data to the specified file path
    await fs.promises.writeFile(filePath, JSON.stringify(ustxData, null, 2), 'utf-8');
    
    console.log(`[DEBUG-SAVE-USTX] Saved USTX data to ${filePath}`);
    
    return NextResponse.json({ 
      success: true, 
      filePath: filePath,
      size: JSON.stringify(ustxData).length 
    });

  } catch (error) {
    console.error('[DEBUG-SAVE-USTX] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to save USTX data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}