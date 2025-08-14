import { NextRequest, NextResponse } from 'next/server';
import { TEMPLATES, getTemplate } from '@/data/templates';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateName = searchParams.get('name');
    const regenerate = searchParams.get('regenerate') === 'true';

    // If requesting a specific template
    if (templateName) {
      const template = getTemplate(templateName);
      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }

      // Special handling for templates that load actual USTX files
      // Only auto-generate fresh verse metadata when explicitly requested with regenerate=true
      if (regenerate) {
        console.log(`🚀 Template API: ${regenerate ? 'REGENERATE MODE' : 'TEMPLATE LOAD'} for ${templateName}`);
        try {
          const fs = await import('fs');
          const path = await import('path');
          const yaml = await import('js-yaml');
          const { execSync } = await import('child_process');
          
          // Determine which USTX file to load
          const ustxFileName = templateName === 'still_here_updated' ? 'still_here_updated.ustx' : 'still_here.ustx';
          const ustxPath = path.join(process.cwd(), '..', ustxFileName);
          
          console.log(`🚀 ${regenerate ? 'Regenerating' : 'Auto-generating'} fresh verse metadata for ${ustxFileName} using Python script`);
          
          // Check if USTX file exists
          if (fs.existsSync(ustxPath)) {
            // Generate unique output filename
            const timestamp = Date.now();
            const outputFileName = `${templateName}_${timestamp}.json`;
            const outputPath = path.join(process.cwd(), '..', 'openutau-piano-roll', 'src', 'data', 'templates', outputFileName);
            
            console.log(`🔄 Running: python3 local_verse_creator.py -i ${ustxFileName} -o ${outputFileName}`);
            
            try {
              // Run the Python script to generate fresh verse metadata
              const pythonCommand = `cd /workspaces/OpenUtau && python3 local_verse_creator.py -i ${ustxFileName} -o openutau-piano-roll/src/data/templates/${outputFileName}`;
              const output = execSync(pythonCommand, { 
                encoding: 'utf-8', 
                timeout: 120000, // 2 minute timeout
                stdio: 'pipe'
              });
              
              console.log(`✅ Python script completed successfully`);
              console.log(`📊 Output: ${output.slice(-200)}...`); // Show last 200 chars
              
              // Load the generated template file
              if (fs.existsSync(outputPath)) {
                const generatedContent = fs.readFileSync(outputPath, 'utf-8');
                const generatedData = JSON.parse(generatedContent);
                
                console.log(`📋 Loaded generated template with ${generatedData._verseMetadata?.totalVerses || 0} verses`);
                
                return NextResponse.json({
                  template: {
                    name: template.name,
                    displayName: template.displayName,
                    description: template.description + ` (fresh verse metadata generated from ${ustxFileName})`
                  },
                  ustxData: generatedData,
                  cachedVerseDetection: generatedData._verseMetadata || null
                });
              } else {
                throw new Error(`Generated template file not found at ${outputPath}`);
              }
              
            } catch (pythonError) {
              console.error(`❌ Python script failed:`, pythonError);
              
              // Fallback: load USTX file with old template boundaries
              const ustxContent = fs.readFileSync(ustxPath, 'utf-8');
              const ustxData = yaml.load(ustxContent) as any;
              
              if (template.ustxData._verseMetadata) {
                ustxData._verseMetadata = template.ustxData._verseMetadata;
              }
              
              console.log(`⚠️ Using fallback: ${ustxFileName} with old template boundaries`);
              
              return NextResponse.json({
                template: {
                  name: template.name,
                  displayName: template.displayName,
                  description: template.description + ` (fallback: loaded from ${ustxFileName} with old boundaries)`
                },
                ustxData: ustxData,
                cachedVerseDetection: template.ustxData._verseMetadata || null
              });
            }
            
          } else {
            console.warn(`${ustxFileName} not found at ${ustxPath}, falling back to template`);
          }
        } catch (error) {
          console.error(`Error in auto-generation process:`, error);
          // Fall back to template if entire process fails
        }
      }

      console.log(`📋 Serving embedded template: ${template.name}`);
      
      return NextResponse.json({
        template: {
          name: template.name,
          displayName: template.displayName,
          description: template.description
        },
        ustxData: template.ustxData,
        cachedVerseDetection: template.ustxData._verseMetadata || null // Use cached verse data if available
      });
    }

    // Return list of available templates
    return NextResponse.json({
      templates: TEMPLATES.map(template => ({
        name: template.name,
        displayName: template.displayName,
        description: template.description
      }))
    });

  } catch (error) {
    console.error('Template API error:', error);
    return NextResponse.json({ 
      error: 'Failed to load templates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { templateName, ustxData } = await request.json();
    
    if (!templateName || !ustxData) {
      return NextResponse.json({ error: 'Missing templateName or ustxData' }, { status: 400 });
    }

    console.log(`🚀 POST: Regenerating verse metadata for ${templateName} with updated USTX`);
    
    // Save updated USTX to temporary file
    const fs = await import('fs');
    const path = await import('path');
    const yaml = await import('js-yaml');
    const { execSync } = await import('child_process');
    
    const timestamp = Date.now();
    const tempUstxFile = `${templateName}_updated_${timestamp}.ustx`;
    const tempUstxPath = path.join(process.cwd(), '..', tempUstxFile);
    
    // Convert USTX data back to YAML and save
    const yamlContent = yaml.dump(ustxData);
    fs.writeFileSync(tempUstxPath, yamlContent);
    
    console.log(`💾 Saved updated USTX to: ${tempUstxFile}`);
    
    // Debug: Check what lyrics are actually in verse 3 range
    const allNotes = ustxData.voice_parts?.flatMap(part => part.notes || [])
      .filter(note => note.lyric && note.lyric.trim() !== '')
      .sort((a, b) => a.position - b.position) || [];
    
    const verse3Notes = allNotes.slice(30, 48); // verse 3 range
    const verse3Lyrics = verse3Notes.map(note => note.lyric).join(' ');
    console.log(`🔍 Verse 3 lyrics in updated USTX: "${verse3Lyrics}"`);
    
    // Run Python script on the updated USTX
    const outputFileName = `${templateName}_${timestamp}.json`;
    const pythonCommand = `cd /workspaces/OpenUtau && python3 local_verse_creator.py -i ${tempUstxFile} -o openutau-piano-roll/src/data/templates/${outputFileName}`;
    
    console.log(`🐍 Running: ${pythonCommand}`);
    const output = execSync(pythonCommand, { 
      encoding: 'utf-8', 
      timeout: 120000,
      stdio: 'pipe'
    });
    
    // Load the generated template file
    const outputPath = path.join(process.cwd(), 'src', 'data', 'templates', outputFileName);
    if (fs.existsSync(outputPath)) {
      const generatedContent = fs.readFileSync(outputPath, 'utf-8');
      const generatedData = JSON.parse(generatedContent);
      
      console.log(`✅ Generated fresh verse metadata with ${generatedData._verseMetadata?.totalVerses || 0} verses`);
      
      // Clean up temp file
      try {
        fs.unlinkSync(tempUstxPath);
      } catch (e) {
        console.warn('Failed to delete temp USTX file:', e);
      }
      
      return NextResponse.json({
        success: true,
        cachedVerseDetection: generatedData._verseMetadata || null
      });
    } else {
      throw new Error(`Generated template file not found at ${outputPath}`);
    }
    
  } catch (error) {
    console.error('POST template regeneration error:', error);
    return NextResponse.json({ 
      error: 'Failed to regenerate template',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const maxDuration = 30;