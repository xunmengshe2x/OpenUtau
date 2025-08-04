#!/usr/bin/env python3
"""
<<<<<<< HEAD
Test script for DiffSinger phrase extractor Modal function
Converts USTX files to proper phrase boundaries using DiffSinger CLI
=======
Test script for ds_phrase_extractor Modal endpoint
Reads still_here.ustx and tests the ds_phrase_extractor function
>>>>>>> f2cba8a322e37a0ad497d49bf3b010844dc8c61b
"""

import json
import requests
<<<<<<< HEAD
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
=======
import yaml

# Modal ds_phrase_extractor endpoint
MODAL_DS_EXTRACTOR_URL = 'https://wwatashi84--openutau-voice-synthesis-ds-phrase-extractor.modal.run'

def main():
    print("🧪 Testing ds_phrase_extractor with still_here.ustx...")
    
    # Read the USTX file (YAML format)
    try:
        with open('still_here.ustx', 'r', encoding='utf-8') as f:
            ustx_yaml = yaml.safe_load(f)
        print(f"✅ Loaded USTX file: {ustx_yaml.get('name', 'unknown')}")
        print(f"📊 Voice parts: {len(ustx_yaml.get('voice_parts', []))}")
        if ustx_yaml.get('voice_parts'):
            total_notes = sum(len(part.get('notes', [])) for part in ustx_yaml['voice_parts'])
            print(f"📊 Total notes: {total_notes}")
    except Exception as e:
        print(f"❌ Failed to load USTX file: {e}")
        return
    
    # Prepare request payload
    request_payload = {
        'ustxData': ustx_yaml,
        'singerId': 'fem_1_ln'
    }
    
    print(f"🚀 Calling Modal ds_phrase_extractor endpoint...")
    print(f"🔗 URL: {MODAL_DS_EXTRACTOR_URL}")
>>>>>>> f2cba8a322e37a0ad497d49bf3b010844dc8c61b
    
    try:
        # Call the Modal endpoint
        response = requests.post(
            MODAL_DS_EXTRACTOR_URL,
<<<<<<< HEAD
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
=======
            json=request_payload,
            timeout=180  # 3 minutes timeout
        )
        
        print(f"📊 Response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            
            print(f"✅ ds_phrase_extractor successful!")
            print(f"📊 Success: {result.get('success', False)}")
            print(f"📊 Method: {result.get('method', 'unknown')}")
            print(f"📊 Total phrases: {result.get('total_phonemes', 0)}")
            print(f"📊 DS phrases count: {result.get('ds_phrases_count', 0)}")
            
            if result.get('phrases'):
                print(f"📊 Generated phrases: {len(result['phrases'])}")
                for i, phrase in enumerate(result['phrases'][:5]):  # Show first 5
                    print(f"   {i+1}: \"{phrase.get('lyrics', '')}\" (notes {phrase.get('startNoteIndex', 0)}-{phrase.get('endNoteIndex', 0)})")
                if len(result['phrases']) > 5:
                    print(f"   ... and {len(result['phrases']) - 5} more")
            
            # Save the result
            output_file = 'still_here_ds_test.json'
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            print(f"💾 Saved result to: {output_file}")
            
        else:
            print(f"❌ Request failed with status {response.status_code}")
            print(f"❌ Response: {response.text[:500]}")
            
    except requests.exceptions.Timeout:
        print("❌ Request timed out after 3 minutes")
    except Exception as e:
        print(f"❌ Request failed: {e}")

if __name__ == '__main__':
>>>>>>> f2cba8a322e37a0ad497d49bf3b010844dc8c61b
    main()