import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

interface AnalyzeVersesRequest {
  ustxPath: string;
  interactive?: boolean;
  verseNumber?: number;
  newLyrics?: string;
  batchEdit?: string; // Format: "verse1:lyrics1;verse2:lyrics2"
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as AnalyzeVersesRequest;
    const { ustxPath, interactive = false, verseNumber, newLyrics, batchEdit } = body;

    if (!ustxPath) {
      return NextResponse.json({ error: 'USTX path is required' }, { status: 400 });
    }

    // Convert to absolute path
    const absolutePath = path.resolve(ustxPath);
    
    if (!fs.existsSync(absolutePath)) {
      return NextResponse.json({ error: `USTX file not found: ${absolutePath}` }, { status: 404 });
    }

    const openUtauRoot = '/workspaces/OpenUtau';
    const cliArgs = ['run', '--project', 'OpenUtau.Cli', '--', 'analyze-verses', absolutePath];
    
    // Add editing flags if provided
    if (batchEdit) {
      cliArgs.push('--batch-edit', batchEdit);
    } else if (verseNumber && newLyrics) {
      // Use direct --edit-phrase approach (not interactive mode)
      cliArgs.push('--edit-phrase', verseNumber.toString(), '--new-lyrics', newLyrics);
    }

    return new Promise(async (resolve) => {
      let output = '';
      let errorOutput = '';

      const childProcess = spawn('dotnet', cliArgs, {
        cwd: openUtauRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OPENUTAU_OUTPUT_JSON: 'true'  // Enable JSON output
        }
      });

      // Always handle stdin to quit interactive prompt for read-only analysis
      if (!batchEdit && !verseNumber) {
        // Read-only mode - quit interactive prompt immediately
        setTimeout(() => {
          childProcess.stdin.write('q\n');
        }, 2000);
      }
      // For editing calls, no stdin interaction needed - using direct flags

      childProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      childProcess.on('close', async (code) => {
        if (code !== 0) {
          console.error('❌ CLI process failed with code:', code);
          console.error('stderr:', errorOutput);
          resolve(NextResponse.json({ 
            error: 'Analysis failed', 
            stderr: errorOutput,
            stdout: output,
            code 
          }, { status: 500 }));
          return;
        }

        console.log('🔍 CLI output length:', output.length, 'characters');
        
        // Parse the verse analysis output
        let verses = parseVerseAnalysisOutput(output);
        
        console.log(`✅ Parsed ${verses.length} verses from CLI output`);
        if (verses.length > 0) {
          console.log('📝 Sample verse:', JSON.stringify(verses[0], null, 2));
        } else {
          console.log('⚠️ No verses parsed! First 500 chars of output:', output.substring(0, 500));
          
          // If no verses and no editing was done, retry once (phonemizer can be flaky with edited files)
          if (!batchEdit && !verseNumber && !output.includes('✅ Saved edited file →')) {
            console.log('🔄 Retrying analysis due to potential phonemizer flakiness...');
            
            // Wait a moment for phonemizer to settle
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Retry the CLI call
            try {
              let retryOutput = '';
              let retryErrorOutput = '';
              
              const retryProcess = spawn('dotnet', cliArgs, {
                cwd: openUtauRoot,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                  ...process.env,
                  OPENUTAU_OUTPUT_JSON: 'true'
                }
              });
              
              // Send 'q' to quit interactive prompt
              setTimeout(() => {
                retryProcess.stdin.write('q\n');
              }, 2000);
              
              retryProcess.stdout.on('data', (data) => {
                retryOutput += data.toString();
              });
              
              retryProcess.stderr.on('data', (data) => {
                retryErrorOutput += data.toString();
              });
              
              await new Promise((resolveRetry) => {
                retryProcess.on('close', (retryCode) => {
                  if (retryCode === 0) {
                    const retryVerses = parseVerseAnalysisOutput(retryOutput);
                    if (retryVerses.length > 0) {
                      console.log(`✅ Retry successful! Parsed ${retryVerses.length} verses`);
                      // Update verses with retry result
                      verses = retryVerses;
                    } else {
                      console.log('⚠️ Retry also returned 0 verses');
                    }
                  } else {
                    console.log('❌ Retry failed with code:', retryCode);
                  }
                  resolveRetry();
                });
              });
            } catch (retryError) {
              console.log('❌ Retry attempt failed:', retryError);
            }
          }
        }
        
        // Extract the saved file path from CLI output if editing was done
        let editedFilePath = null;
        const savedFileMatch = output.match(/✅ Saved edited file → (.+\.ustx)/);
        if (savedFileMatch) {
          editedFilePath = savedFileMatch[1];
          console.log('🔄 Edit completed, returning verses from editing call (skipping second analysis)');
          
          // Update the current USTX path file to point to the newly edited file
          try {
            const currentPathFile = '/workspaces/OpenUtau/.current_ustx_path';
            fs.writeFileSync(currentPathFile, editedFilePath);
            console.log('💾 Updated current USTX path file to:', editedFilePath);
          } catch (error) {
            console.warn('Could not update current USTX path file:', error);
          }
          
          // After editing, we need to analyze the NEW file to get updated verses
          console.log('🔄 Running analyze-verses on newly edited file:', editedFilePath);
          
          // Run analyze-verses on the newly created file to get updated verses
          const analyzeProcess = spawn('dotnet', ['run', '--project', 'OpenUtau.Cli', '--', 'analyze-verses', editedFilePath], {
            cwd: openUtauRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              OPENUTAU_OUTPUT_JSON: 'true'
            }
          });
          
          let analyzeOutput = '';
          let analyzeErrorOutput = '';
          
          // Send 'q' to quit interactive prompt
          setTimeout(() => {
            analyzeProcess.stdin.write('q\n');
          }, 2000);
          
          analyzeProcess.stdout.on('data', (data) => {
            analyzeOutput += data.toString();
          });
          
          analyzeProcess.stderr.on('data', (data) => {
            analyzeErrorOutput += data.toString();
          });
          
          analyzeProcess.on('close', (analyzeCode) => {
            if (analyzeCode === 0) {
              const updatedVerses = parseVerseAnalysisOutput(analyzeOutput);
              console.log('✅ Successfully analyzed edited file, got', updatedVerses.length, 'verses');
              
              // Return the updated verses from the newly edited file
              resolve(NextResponse.json({
                success: true,
                output: analyzeOutput, // Use output from the second analysis
                verses: updatedVerses, // Return verses from the edited file
                totalPhrases: updatedVerses.length,
                editedFilePath
              }));
            } else {
              console.error('❌ Failed to analyze edited file, returning original verses');
              // Fallback to original verses if analysis fails
              resolve(NextResponse.json({
                success: true,
                output,
                verses: verses, // Return original verses as fallback
                totalPhrases: verses.length,
                editedFilePath
              }));
            }
          });
          
          return;
        }
        
        // No editing was done, return original verses
        resolve(NextResponse.json({
          success: true,
          output,
          verses,
          totalPhrases: verses.length,
          editedFilePath: null
        }));
      });

      childProcess.on('error', (error) => {
        resolve(NextResponse.json({ 
          error: 'Failed to start analysis process', 
          message: error.message 
        }, { status: 500 }));
      });
    });

  } catch (error) {
    console.error('Error in analyze-verses API:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

function parseVerseAnalysisOutput(output: string) {
  // Look for JSON file path first (more reliable than parsing stdout)
  const jsonFileMatch = output.match(/JSON_FILE_PATH:(.+)/);
  if (jsonFileMatch) {
    const jsonFilePath = jsonFileMatch[1].trim();
    console.log(`📁 Found JSON file path: ${jsonFilePath}`);
    
    try {
      const fs = require('fs');
      if (fs.existsSync(jsonFilePath)) {
        const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
        const verses = JSON.parse(jsonContent);
        console.log(`✅ Parsed ${verses.length} verses from JSON file`);
        
        // Clean up temp file
        try {
          fs.unlinkSync(jsonFilePath);
          console.log(`🗑️ Cleaned up temp JSON file`);
        } catch (cleanupError) {
          console.warn('Could not delete temp JSON file:', cleanupError.message);
        }
        
        return verses;
      } else {
        console.error(`JSON file not found: ${jsonFilePath}`);
      }
    } catch (error) {
      console.error('Failed to read JSON file:', error);
    }
  }
  
  // Fallback: Look for JSON output in stdout
  const jsonStartIndex = output.indexOf('JSON_OUTPUT_START');
  const jsonEndIndex = output.indexOf('JSON_OUTPUT_END');
  
  if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
    // Extract and parse JSON
    const jsonStr = output.substring(jsonStartIndex + 'JSON_OUTPUT_START'.length, jsonEndIndex).trim();
    try {
      const verses = JSON.parse(jsonStr);
      console.log(`✅ Parsed ${verses.length} verses from JSON output (fallback)`);
      return verses;
    } catch (error) {
      console.error('Failed to parse JSON output:', error);
      console.log('JSON string was:', jsonStr.substring(0, 200));
    }
  }
  
  // Look for raw JSON with verses array (for CLI output)
  const jsonMatch = output.match(/\{[\s\S]*"verses"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsedData = JSON.parse(jsonMatch[0]);
      if (parsedData.verses && Array.isArray(parsedData.verses)) {
        console.log(`✅ Parsed ${parsedData.verses.length} verses from raw JSON`);
        // Convert from CLI format to expected format
        return parsedData.verses.map((v: any) => ({
          number: v.index,
          lyrics: v.lyrics,
          wordCount: v.wordCount,
          startMs: v.startMs,
          endMs: v.endMs
        }));
      }
    } catch (error) {
      console.error('Failed to parse raw JSON:', error);
      console.log('JSON match was:', jsonMatch[0].substring(0, 500));
    }
  }
  
  // Fallback to text parsing if JSON not found
  console.log('⚠️ No JSON output found, falling back to text parsing');
  const verses = [];
  const lines = output.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Parse phrase headers like "Phrase 1:"
    const phraseMatch = line.match(/^Phrase (\d+):/);
    if (phraseMatch) {
      const [, phraseNum] = phraseMatch;
      const phrase: any = {
        phraseNumber: parseInt(phraseNum),
        timing: '',
        lyrics: '',
        words: 0
      };
      
      // Look for the next few lines for text, words, timing
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nextLine = lines[j].trim();
        
        if (nextLine.startsWith('text:')) {
          const text = nextLine.substring(5).trim();
          phrase.lyrics = text.replace(/^"|"$/g, '');
        } else if (nextLine.startsWith('words:')) {
          phrase.words = parseInt(nextLine.substring(6).trim());
        } else if (nextLine.startsWith('timing:')) {
          phrase.timing = nextLine.substring(7).trim();
        }
      }
      
      verses.push(phrase);
    }
  }
  
  return verses;
}