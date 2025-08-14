import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const { ustxData, templateName } = await request.json();
    
    if (!ustxData || !templateName) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }
    
    console.log(`🔄 Regenerating template: ${templateName} with updated USTX data`);
    
    // Save the updated USTX temporarily
    const tempUstxPath = join('/workspaces/OpenUtau', `temp_${Date.now()}.ustx`);
    await writeFile(tempUstxPath, JSON.stringify(ustxData, null, 2));
    
    // Run the Python script to regenerate verse detection with new lyrics
    const pythonScript = join('/workspaces/OpenUtau', 'local_verse_creator.py');
    const outputPath = join('/workspaces/OpenUtau/openutau-piano-roll/src/data/templates', `${templateName}_regenerated.json`);
    
    console.log(`🐍 Running: python3 ${pythonScript} -i ${tempUstxPath} -o ${outputPath}`);
    
    const process = spawn('python3', [
      pythonScript,
      '-i', tempUstxPath,
      '-o', outputPath
    ], {
      cwd: '/workspaces/OpenUtau'
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('Python stdout:', data.toString());
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('Python stderr:', data.toString());
    });
    
    await new Promise<void>((resolve, reject) => {
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Python script failed with code ${code}: ${stderr}`));
        }
      });
    });
    
    // Read the regenerated template
    if (!existsSync(outputPath)) {
      throw new Error('Regenerated template file not found');
    }
    
    const regeneratedTemplate = JSON.parse(await readFile(outputPath, 'utf8'));
    
    // Update the original template file with new verse lyrics but keep boundaries
    const originalTemplatePath = join('/workspaces/OpenUtau/openutau-piano-roll/src/data/templates', `${templateName}.json`);
    if (existsSync(originalTemplatePath)) {
      const originalTemplate = JSON.parse(await readFile(originalTemplatePath, 'utf8'));
      
      // Merge: Keep original boundaries but use new lyrics
      if (originalTemplate.cachedVerseDetection?.verses && regeneratedTemplate.cachedVerseDetection?.verses) {
        originalTemplate.cachedVerseDetection.verses.forEach((verse: any, index: number) => {
          if (regeneratedTemplate.cachedVerseDetection.verses[index]) {
            // Update lyrics but keep original boundaries
            verse.lyrics = regeneratedTemplate.cachedVerseDetection.verses[index].lyrics;
          }
        });
        
        // Save the updated template
        await writeFile(originalTemplatePath, JSON.stringify(originalTemplate, null, 2));
        console.log(`✅ Updated template ${templateName} with new lyrics`);
      }
    }
    
    // Clean up temp files
    const fs = require('fs');
    fs.unlinkSync(tempUstxPath);
    fs.unlinkSync(outputPath);
    
    // Return the updated template data
    const updatedTemplate = JSON.parse(await readFile(originalTemplatePath, 'utf8'));
    
    return NextResponse.json({
      success: true,
      cachedVerseDetection: updatedTemplate.cachedVerseDetection,
      message: 'Template regenerated successfully'
    });
    
  } catch (error) {
    console.error('Error regenerating template:', error);
    return NextResponse.json({ 
      error: 'Failed to regenerate template',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}