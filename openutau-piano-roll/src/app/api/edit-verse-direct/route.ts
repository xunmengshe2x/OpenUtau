import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const { verseNumber, newLyrics } = await request.json();
    
    if (!verseNumber || !newLyrics) {
      return NextResponse.json({ error: 'Verse number and new lyrics are required' }, { status: 400 });
    }
    
    console.log(`🔧 EXPERIMENTAL: Direct editing verse ${verseNumber} with lyrics: "${newLyrics}"`);
    
    // Get cached verses data
    const cacheResponse = await fetch('http://localhost:3000/api/verses-cache', {
      method: 'GET'
    });
    
    if (!cacheResponse.ok) {
      return NextResponse.json({ error: 'No verses data cached. Run analyze-verses first.' }, { status: 404 });
    }
    
    const cacheData = await cacheResponse.json();
    const { verses, wordMapping, ustxData } = cacheData.data;
    
    // Find the word mapping for this verse
    const mapping = wordMapping[verseNumber];
    if (!mapping) {
      return NextResponse.json({ error: `No word mapping found for verse ${verseNumber}` }, { status: 404 });
    }
    
    console.log(`📍 Verse ${verseNumber} maps to words ${mapping.startIndex}-${mapping.endIndex} (${mapping.wordCount} words)`);
    
    // Split new lyrics into words
    const newWords = newLyrics.split(' ');
    
    // Validate word count matches
    if (newWords.length !== mapping.wordCount) {
      return NextResponse.json({ 
        error: `Word count mismatch: verse ${verseNumber} expects ${mapping.wordCount} words, got ${newWords.length}`,
        expected: mapping.wordCount,
        provided: newWords.length
      }, { status: 400 });
    }
    
    // Clone USTX data to avoid modifying the cached version
    const updatedUstxData = JSON.parse(JSON.stringify(ustxData));
    
    // Debug: Log the USTX data structure
    console.log('🔍 USTX Data structure:', Object.keys(updatedUstxData));
    console.log('🔍 Voice parts available:', updatedUstxData.voice_parts ? 'YES' : 'NO');
    if (updatedUstxData.voice_parts) {
      console.log('🔍 Voice parts count:', updatedUstxData.voice_parts.length);
      if (updatedUstxData.voice_parts[0]) {
        console.log('🔍 First voice part keys:', Object.keys(updatedUstxData.voice_parts[0]));
      }
    }
    
    // Find the voice part with notes
    const voicePart = updatedUstxData.voice_parts?.[0];
    if (!voicePart || !voicePart.notes) {
      return NextResponse.json({ 
        error: 'No voice part or notes found in USTX data',
        debug: {
          hasVoiceParts: !!updatedUstxData.voice_parts,
          voicePartsCount: updatedUstxData.voice_parts?.length || 0,
          ustxKeys: Object.keys(updatedUstxData),
          firstVoicePartKeys: updatedUstxData.voice_parts?.[0] ? Object.keys(updatedUstxData.voice_parts[0]) : []
        }
      }, { status: 400 });
    }
    
    console.log(`🎵 Found ${voicePart.notes.length} notes in voice part`);
    
    // Update the lyrics in the notes
    let wordIndex = 0;
    let notesUpdated = 0;
    
    for (let i = 0; i < voicePart.notes.length; i++) {
      const note = voicePart.notes[i];
      
      // Check if this note has lyrics (not just a continuation note)
      if (note.lyric && note.lyric !== '+' && note.lyric !== '-') {
        // Check if this word index falls within our verse range
        if (wordIndex >= mapping.startIndex && wordIndex <= mapping.endIndex) {
          const newWordIndex = wordIndex - mapping.startIndex;
          const oldLyric = note.lyric;
          note.lyric = newWords[newWordIndex];
          notesUpdated++;
          
          console.log(`  📝 Note ${i}: "${oldLyric}" → "${note.lyric}" (word ${wordIndex})`);
        }
        wordIndex++;
      }
    }
    
    console.log(`✅ Updated ${notesUpdated} notes for verse ${verseNumber}`);
    
    // Save the updated USTX data to a new file
    const timestamp = Date.now();
    const newFileName = `still_here_edited_${timestamp}.ustx`;
    const newFilePath = `/workspaces/OpenUtau/${newFileName}`;
    
    try {
      // Convert USTX data to YAML format (OpenUtau format)
      const yaml = require('js-yaml');
      const ustxYaml = yaml.dump(updatedUstxData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true
      });
      
      fs.writeFileSync(newFilePath, ustxYaml, 'utf8');
      console.log(`💾 Saved updated USTX to: ${newFileName}`);
      
      // Update .current_ustx_path to point to new file
      const currentPathFile = '/workspaces/OpenUtau/.current_ustx_path';
      fs.writeFileSync(currentPathFile, newFilePath);
      console.log(`📍 Updated current USTX path to: ${newFilePath}`);
      
    } catch (saveError) {
      console.error('Failed to save USTX file:', saveError);
      // Continue anyway - the memory update still worked
    }
    
    // Update the cached verses data with the new lyrics
    const updatedVerses = verses.map((verse: any) => {
      if (verse.phraseNumber === verseNumber) {
        return {
          ...verse,
          lyrics: newLyrics,
          words: newWords.length
        };
      }
      return verse;
    });
    
    // Update the cache with the modified data
    await fetch('http://localhost:3000/api/verses-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verses: updatedVerses,
        ustxData: updatedUstxData
      })
    });
    
    return NextResponse.json({
      success: true,
      verseNumber,
      originalLyrics: verses.find((v: any) => v.phraseNumber === verseNumber)?.lyrics || '',
      newLyrics,
      notesUpdated,
      wordMapping: mapping,
      newFilePath: newFilePath,
      newFileName: newFileName,
      verses: updatedVerses,
      ustxData: updatedUstxData
    });
    
  } catch (error) {
    console.error('Error in direct verse editing:', error);
    return NextResponse.json(
      { error: 'Failed to edit verse directly' },
      { status: 500 }
    );
  }
}