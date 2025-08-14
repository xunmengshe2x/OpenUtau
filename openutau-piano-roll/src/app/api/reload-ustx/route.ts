import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import yaml from 'js-yaml';

export async function POST(request: NextRequest) {
  try {
    const { filePath } = await request.json();
    
    if (!filePath) {
      return NextResponse.json({ error: 'No file path provided' }, { status: 400 });
    }

    console.log(`🔄 Reloading USTX file: ${filePath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️ File not found: ${filePath}`);
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Read the USTX file
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remove BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.substring(1);
    }

    // Parse USTX (try YAML first, then JSON)
    let ustxData;
    try {
      ustxData = yaml.load(content);
    } catch (yamlError) {
      try {
        ustxData = JSON.parse(content);
      } catch (jsonError) {
        console.error('Failed to parse USTX file:', jsonError);
        return NextResponse.json({ error: 'Failed to parse USTX file' }, { status: 500 });
      }
    }

    console.log(`✅ Successfully reloaded USTX with ${ustxData.voice_parts?.length || 0} voice parts`);
    
    return NextResponse.json({ 
      success: true, 
      ustxData,
      filePath 
    });

  } catch (error) {
    console.error('Error reloading USTX:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}