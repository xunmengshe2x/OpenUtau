import { NextRequest, NextResponse } from 'next/server';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const { templateName } = await request.json();
    
    if (!templateName) {
      return NextResponse.json({ error: 'Template name required' }, { status: 400 });
    }
    
    console.log(`🧹 Clearing segment updates for template: ${templateName}`);
    
    // Remove the segment updates directory for this template
    // Fix: Use the same path as openutau-mix API uses
    const updatesDir = join('/workspaces/OpenUtau', '.segment_updates', templateName);
    
    if (existsSync(updatesDir)) {
      rmSync(updatesDir, { recursive: true, force: true });
      console.log(`✅ Cleared segment updates directory: ${updatesDir}`);
      
      return NextResponse.json({ 
        success: true,
        message: `Cleared segment updates for ${templateName}`,
        clearedPath: updatesDir
      });
    } else {
      console.log(`ℹ️ No segment updates to clear for ${templateName}`);
      return NextResponse.json({ 
        success: true,
        message: `No segment updates found for ${templateName}`
      });
    }
    
  } catch (error) {
    console.error('Error clearing segment updates:', error);
    return NextResponse.json({ 
      error: 'Failed to clear segment updates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}