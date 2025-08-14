import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const currentPathFile = '/workspaces/OpenUtau/.current_ustx_path';
    
    if (fs.existsSync(currentPathFile)) {
      const currentPath = fs.readFileSync(currentPathFile, 'utf-8').trim();
      console.log('📖 Current USTX path:', currentPath);
      return NextResponse.json({ success: true, currentPath });
    } else {
      console.log('📖 No current USTX path file found');
      return NextResponse.json({ success: true, currentPath: null });
    }
  } catch (error) {
    console.error('Error reading current path:', error);
    return NextResponse.json(
      { error: 'Failed to read current path file' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { path: ustxPath } = await request.json();
    
    if (!ustxPath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 });
    }
    
    // Write the current USTX path to the shared file
    const currentPathFile = '/workspaces/OpenUtau/.current_ustx_path';
    fs.writeFileSync(currentPathFile, ustxPath);
    
    console.log('💾 Updated current USTX path file:', ustxPath);
    return NextResponse.json({ success: true, path: ustxPath });
    
  } catch (error) {
    console.error('Error updating current path:', error);
    return NextResponse.json(
      { error: 'Failed to update current path file' },
      { status: 500 }
    );
  }
}