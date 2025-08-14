import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

export async function GET(request: NextRequest) {
  try {
    const templatePath = '/workspaces/OpenUtau/still_here_updated.json';
    
    if (!existsSync(templatePath)) {
      return NextResponse.json({ 
        error: 'Updated template not found' 
      }, { status: 404 });
    }

    const templateData = JSON.parse(readFileSync(templatePath, 'utf8'));
    
    return NextResponse.json(templateData);
  } catch (error) {
    console.error('Error reading updated template:', error);
    return NextResponse.json({ 
      error: 'Failed to read updated template',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}