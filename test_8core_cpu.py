#!/usr/bin/env python3
"""
Test script for 8-core CPU rendering only
Fast and cost-effective!
"""
import json
import requests
import base64
import time

def test_8core_cpu(phrase_number=1):
    """Test 8-core CPU rendering"""
    
    print(f"🔥 Testing 8-CORE CPU (phrase {phrase_number})...")
    
    # Read the USTX file
    with open("/workspaces/OpenUtau/working_test.ustx", "r") as f:
        ustx_data = json.load(f)
    
    # 8-core CPU endpoint
    modal_url = "https://wwatashi84--openutau-voice-synthesis-render-segment-cpu.modal.run"
    
    # Create the payload
    payload = {
        "ustxData": ustx_data,
        "singerId": "fem_1_ln",
        "phraseNumbers": phrase_number,
        "qualitySettings": {
            "diffSingerDepth": 1000,
            "diffSingerSteps": 1000,
            "diffSingerStepsPitch": 5,
            "diffSingerStepsVariance": 4
        }
    }
    
    print(f"📤 Sending request to: {modal_url}")
    print(f"📊 Payload size: {len(json.dumps(payload))} bytes")
    print(f"🎯 Phrase number: {phrase_number}")
    print(f"🔥 CPU cores: 8")
    print(f"💰 Cost estimate: ~$0.0015 per render")
    
    start_time = time.time()
    
    try:
        # Send the request
        response = requests.post(modal_url, json=payload, timeout=300)
        
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"📬 Response status: {response.status_code}")
        print(f"⏱️ Duration: {duration:.1f} seconds")
        
        if response.status_code == 200:
            result = response.json()
            if result.get("success"):
                audio_size = result.get("size", 0)
                cpu_cores = result.get("cpu_cores", "unknown")
                print(f"✅ Success! Audio size: {audio_size} bytes")
                print(f"🔥 CPU cores used: {cpu_cores}")
                
                # If we got actual audio data, save it
                if audio_size > 46:  # More than just WAV header
                    audio_base64 = result.get("audio", "")
                    audio_data = base64.b64decode(audio_base64)
                    
                    filename = f"8core_cpu_phrase{phrase_number}.wav"
                    with open(filename, "wb") as f:
                        f.write(audio_data)
                    print(f"💾 Audio saved to {filename}")
                    
                    # Calculate cost
                    cost_per_sec = 0.0001226  # 8 cores + 8GB RAM
                    estimated_cost = cost_per_sec * duration
                    print(f"💰 Actual cost: ${estimated_cost:.4f}")
                    
                    return True
                else:
                    print("⚠️  Received only WAV header (no audio data)")
                    return False
            else:
                print(f"❌ Request failed: {result}")
                return False
        else:
            print(f"❌ HTTP error: {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"❌ Request timed out after 300 seconds")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    """Test 8-core CPU rendering"""
    print("🚀 8-Core CPU Rendering Test")
    print("=" * 50)
    print("🏆 Currently the FASTEST and CHEAPEST option!")
    print("=" * 50)
    
    # Test phrase 1
    success = test_8core_cpu(phrase_number=1)
    
    if success:
        print("\n✅ 8-core CPU rendering completed successfully!")
        print("🎉 ~12 seconds for high-quality audio synthesis")
        
        # Optional: Test multiple phrases
        print("\nWant to test more phrases? Just change phrase_number!")
        print("Example: test_8core_cpu(phrase_number=2)")
    
    print("\n✅ Test completed")

if __name__ == "__main__":
    main()