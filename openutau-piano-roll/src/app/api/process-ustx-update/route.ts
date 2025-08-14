import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { ustxData, singerId = 'fem_1_ln' } = await request.json();
    
    if (!ustxData) {
      return NextResponse.json({ error: 'USTX data is required' }, { status: 400 });
    }

    // Import Node.js modules dynamically
    const { writeFileSync, unlinkSync, readFileSync } = await import('fs');
    const crypto = await import('crypto');

    // Generate unique filenames for temp files
    const tempId = crypto.randomUUID();
    const tempUstxPath = `/tmp/ustx_${tempId}.ustx`;
    const tempJsonPath = `/tmp/verse_template_${tempId}.json`;

    try {
      // Write USTX data to temp file
      console.log('Writing USTX to temp file:', tempUstxPath);
      writeFileSync(tempUstxPath, JSON.stringify(ustxData, null, 2));

      // Run create-verse-templates.js
      const scriptPath = path.join(process.cwd(), '..', 'create-verse-templates.js');
      const command = `node ${scriptPath} --input ${tempUstxPath} --output ${tempJsonPath} --singer ${singerId}`;
      
      console.log('Running command:', command);
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stderr.includes('Warning')) {
        console.error('Script stderr:', stderr);
      }
      
      console.log('Script output:', stdout);

      // Read the generated JSON
      const processedData = JSON.parse(readFileSync(tempJsonPath, 'utf8'));

      // Clean up temp files
      try {
        unlinkSync(tempUstxPath);
        unlinkSync(tempJsonPath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp files:', cleanupError);
      }

      return NextResponse.json({
        success: true,
        processedData,
        verses: processedData._verseMetadata?.verses || [],
        totalVerses: processedData._verseMetadata?.totalVerses || 0
      });

    } catch (error) {
      // Clean up temp files on error
      try {
        unlinkSync(tempUstxPath);
        unlinkSync(tempJsonPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      throw error;
    }

  } catch (error) {
    console.error('Error processing USTX update:', error);
    return NextResponse.json({ 
      error: 'Failed to process USTX update', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}