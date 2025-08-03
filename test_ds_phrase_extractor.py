#!/usr/bin/env python3
"""
Test script for DiffSinger phrase extractor Modal function
Converts USTX files to proper phrase boundaries using DiffSinger CLI
"""

import json
import requests
import sys
import yaml
from pathlib import Path

# Modal endpoint URL
MODAL_DS_EXTRACTOR_URL = 'https://wwatashi84--openutau-voice-synthesis-ds-phrase-extractor.modal.run'

def test_ds_phrase_extractor(ustx_file_path, singer_id='fem_1_ln', output_file=None):
    """
    Test the ds_phrase_extractor Modal function
    
    Args:
        ustx_file_path: Path to USTX file
        singer_id: Singer voicebank ID
        output_file: Optional output file path (defaults to input_name_ds_test.json)
    """
    
    # Read USTX file
    ustx_path = Path(ustx_file_path)
    if not ustx_path.exists():
        print(f"❌ USTX file not found: {ustx_file_path}")
        return None
    
    print(f"📄 Reading USTX file: {ustx_path.name}")
    
    try:
        # Read the file content first
        try:
            with open(ustx_path, 'r', encoding='utf-8-sig') as f:
                content = f.read()
        except UnicodeDecodeError:
            with open(ustx_path, 'r', encoding='utf-8') as f:
                content = f.read()
        
        # Try to parse as JSON first, then YAML
        try:
            ustx_data = json.loads(content)
            print(f"📄 Parsed as JSON format")
        except json.JSONDecodeError:
            try:
                ustx_data = yaml.safe_load(content)
                print(f"📄 Parsed as YAML format")
            except yaml.YAMLError as yaml_err:
                print(f"❌ Failed to parse as both JSON and YAML: {yaml_err}")
                return None
                
    except Exception as e:
        print(f"❌ Failed to read USTX file: {e}")
        return None
    
    # Show USTX info
    voice_parts = ustx_data.get('voice_parts', [])
    total_notes = sum(len(part.get('notes', [])) for part in voice_parts)
    print(f"📊 USTX contains {len(voice_parts)} voice parts with {total_notes} total notes")
    
    # Prepare request data
    request_data = {
        'ustxData': ustx_data,
        'singerId': singer_id
    }
    
    print(f"🚀 Calling Modal ds_phrase_extractor endpoint...")
    print(f"🎤 Singer: {singer_id}")
    print(f"🌐 URL: {MODAL_DS_EXTRACTOR_URL}")
    
    try:
        # Call the Modal endpoint
        response = requests.post(
            MODAL_DS_EXTRACTOR_URL,
            json=request_data,
            timeout=300  # 5 minutes timeout
        )
        
        if response.status_code != 200:
            print(f"❌ HTTP Error {response.status_code}: {response.text}")
            return None
        
        result = response.json()
        
        if not result.get('success'):
            print(f"❌ Modal function failed: {result.get('error', 'Unknown error')}")
            return None
        
        # Process successful result
        phrases = result.get('phrases', [])
        total_phonemes = result.get('total_phonemes', 0)
        method = result.get('method', 'Unknown')
        ds_phrases_count = result.get('ds_phrases_count', 0)
        
        print(f"✅ Success! Extracted {len(phrases)} phrases using {method}")
        print(f"📊 Total phonemes: {total_phonemes}")
        print(f"📊 DS file contained {ds_phrases_count} raw phrases")
        
        # Show phrase details
        print(f"\n📝 Phrase breakdown:")
        for i, phrase in enumerate(phrases, 1):
            lyrics = phrase.get('lyrics', '')
            start_note = phrase.get('startNoteIndex', 0)
            end_note = phrase.get('endNoteIndex', 0)
            phoneme_count = len(phrase.get('phonemes', []))
            
            print(f"  {i:2d}. \"{lyrics}\" (notes {start_note}-{end_note}, {phoneme_count} phonemes)")
        
        # Determine output file
        if output_file is None:
            output_file = ustx_path.stem + '_ds_test.json'
        
        output_path = Path(output_file)
        
        # Save result to file
        print(f"\n💾 Saving result to: {output_path}")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Results saved to {output_path}")
        
        # Summary
        print(f"\n🎉 Test completed successfully!")
        print(f"   📄 Input: {ustx_path.name} ({total_notes} notes)")
        print(f"   🎵 Output: {len(phrases)} natural phrases")
        print(f"   🔤 Phonemes: {total_phonemes}")
        print(f"   💾 Saved: {output_path}")
        
        return result
        
    except requests.exceptions.Timeout:
        print(f"⏰ Request timed out - Modal function took too long")
        return None
    except requests.exceptions.RequestException as e:
        print(f"❌ Request error: {e}")
        return None
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return None

def main():
    """Main function - can be called from command line or imported"""
    
    if len(sys.argv) < 2:
        print("Usage: python test_ds_phrase_extractor.py <ustx_file> [singer_id] [output_file]")
        print("Example: python test_ds_phrase_extractor.py still_here.ustx fem_1_ln still_here_phrases.json")
        sys.exit(1)
    
    ustx_file = sys.argv[1]
    singer_id = sys.argv[2] if len(sys.argv) > 2 else 'fem_1_ln'
    output_file = sys.argv[3] if len(sys.argv) > 3 else None
    
    result = test_ds_phrase_extractor(ustx_file, singer_id, output_file)
    
    if result is None:
        sys.exit(1)

if __name__ == "__main__":
    main()