import { NextResponse } from 'next/server';
import fs from 'fs';

export async function GET() {
  try {
    const currentPathFile = '/workspaces/OpenUtau/.current_ustx_path';
    
    if (fs.existsSync(currentPathFile)) {
      const path = fs.readFileSync(currentPathFile, 'utf8').trim();
      return NextResponse.json({ path });
    } else {
      // Default to still_here.ustx if no current path file exists
      return NextResponse.json({ path: '/workspaces/OpenUtau/still_here.ustx' });
    }
  } catch (error) {
    console.error('Failed to read current USTX path:', error);
    return NextResponse.json({ 
      path: '/workspaces/OpenUtau/still_here.ustx' // fallback
    });
  }
}