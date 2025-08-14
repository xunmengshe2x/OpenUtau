import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { ustxData, filename } = await request.json();
    
    if (!ustxData || !filename) {
      return NextResponse.json({ error: 'Missing ustxData or filename' }, { status: 400 });
    }

    console.log(`💾 Saving USTX data to /workspaces/OpenUtau/${filename}`);
    
    const fs = await import('fs');
    const path = await import('path');
    const yaml = await import('js-yaml');
    
    // Convert USTX data to YAML
    const yamlContent = yaml.dump(ustxData);
    
    // Save to /workspaces/OpenUtau/
    const filePath = path.join('/workspaces/OpenUtau', filename);
    fs.writeFileSync(filePath, yamlContent);
    
    console.log(`✅ USTX saved to: ${filePath}`);
    
    return NextResponse.json({ 
      success: true, 
      message: `USTX saved to ${filePath}`
    });
    
  } catch (error) {
    console.error('Save USTX error:', error);
    return NextResponse.json({ 
      error: 'Failed to save USTX',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}