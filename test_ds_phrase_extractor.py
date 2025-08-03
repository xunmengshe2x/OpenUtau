#!/usr/bin/env python3
"""
Test script for ds_phrase_extractor Modal endpoint
Reads still_here.ustx and tests the ds_phrase_extractor function
"""

import json
import requests
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
    
    try:
        # Call the Modal endpoint
        response = requests.post(
            MODAL_DS_EXTRACTOR_URL,
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
    main()