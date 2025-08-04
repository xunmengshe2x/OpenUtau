import { NextRequest, NextResponse } from 'next/server';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const { templateName } = await request.json();
    
    if (!templateName) {
      return NextResponse.json({ error: 'Template name required' }, { status: 400 });
    }
    
    console.log(`🧹 Clearing all verse updates for ${templateName}...`);
    
    // Remove the entire updates directory for this template
    const updatesDir = join(process.cwd(), '.segment_updates', templateName);
    
    if (existsSync(updatesDir)) {
      rmSync(updatesDir, { recursive: true, force: true });
      console.log(`✅ Cleared updates directory: ${updatesDir}`);
    }
    
    return NextResponse.json({ 
      success: true,
      message: `All verse updates cleared for ${templateName}`
    });
    
  } catch (error) {
    console.error('Error clearing verse updates:', error);
    return NextResponse.json({ 
      error: 'Failed to clear verse updates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}