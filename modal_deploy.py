#!/usr/bin/env python3
"""
Modal deployment for OpenUtau CLI - Voice Synthesis Backend
Updated for Modal 1.0+ API - Handles the heavy C# audio processing on Modal's GPU infrastructure
"""

import modal
import tempfile
import subprocess
import json
import os
import glob
from pathlib import Path
from typing import Dict, Any, Optional

# Modal app configuration
app = modal.App("openutau-voice-synthesis")

# Docker image with .NET 8.0 + dependencies + CUDA support
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install([
        "wget", "curl", "unzip", "build-essential",
        "libc6-dev", "libicu-dev", "ca-certificates",
        "alsa-utils", "pulseaudio", "pulseaudio-utils",
        "libasound2-plugins", "libpulse0"
    ])
    .run_commands([
        # --- .NET SDK
        "wget https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O packages-microsoft-prod.deb",
        "dpkg -i packages-microsoft-prod.deb",
        "apt-get update",
        "apt-get install -y dotnet-sdk-8.0"
    ])
    .run_commands([
        # --- CUDA 11.8 and core libraries (compatible with ONNX Runtime 1.17.0)
        "curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/debian11/x86_64/3bf863cc.pub | gpg --dearmor -o /usr/share/keyrings/nvidia-archive-keyring.gpg",
        "echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/nvidia-archive-keyring.gpg] https://developer.download.nvidia.com/compute/cuda/repos/debian11/x86_64 /' > /etc/apt/sources.list.d/cuda.list",
        "apt-get update",
        "apt-get install -y --no-install-recommends cuda-cudart-11-8 libcublas-11-8 libcublas-dev-11-8 libcurand-11-8 libcusolver-11-8 libcusparse-11-8 libcufft-11-8",
        "echo '/usr/local/cuda-11.8/targets/x86_64-linux/lib' > /etc/ld.so.conf.d/cuda.conf",
        "ldconfig",
        # --- cuDNN for CUDA 11 (compatible with ONNX Runtime 1.17.0)
        "curl -fsSL https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/linux-x86_64/cudnn-linux-x86_64-8.9.7.29_cuda11-archive.tar.xz -o /tmp/cudnn.tar.xz",
        "cd /usr/local && tar xf /tmp/cudnn.tar.xz",
        "cp -P /usr/local/cudnn-linux-x86_64-8.9.7.29_cuda11-archive/lib/* /usr/local/cuda-11.8/targets/x86_64-linux/lib/",
        "cp /usr/local/cudnn-linux-x86_64-8.9.7.29_cuda11-archive/include/* /usr/local/cuda-11.8/targets/x86_64-linux/include/",
        "rm -rf /tmp/cudnn.tar.xz /usr/local/cudnn-linux-x86_64-8.9.7.29_cuda11-archive",
        "ldconfig",

        # --- No symlinks needed - CUDA 11.8 should match ONNX Runtime 1.17.0 expectations
        "echo 'CUDA 11.8 installation complete - should match ONNX Runtime ABI expectations'",

        "ldconfig",
        "echo 'All CUDA compatibility symlinks created and ldconfig run'"
    ])
    .run_commands([
        "apt-get install -y libasound2-dev portaudio19-dev libportaudio2",
        "apt-get clean && rm -rf /var/lib/apt/lists/*"
    ])
    .pip_install("fastapi[standard]", "PyYAML")
    .env({
        "PULSE_RUNTIME_PATH": "/tmp/pulse",
        "ALSA_CARD": "0",
        "AUDIO_DRIVER": "none",
        "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT": "1",
        "OPENUTAU_HEADLESS": "1",
        "CUDA_DEVICE_ORDER": "PCI_BUS_ID",
        "CUDA_VISIBLE_DEVICES": "0",
        "OPENUTAU_ONNX_RUNNER": "CUDA",
        "OPENUTAU_ONNX_GPU": "0",
        "LD_LIBRARY_PATH": "/usr/local/cuda-11.8/targets/x86_64-linux/lib:/usr/local/cuda-11.8/lib64:/usr/local/cuda/lib64:/usr/lib/x86_64-linux-gnu",
        "ORT_LOG_LEVEL": "VERBOSE",
        "ORT_CUDA_VERBOSE": "1",
        "OPENUTAU_DEBUG_ONNX": "1",
        "OPENUTAU_VERBOSE_LOGS": "1"
    })
)

# Add OpenUtau source code to image instead of using mounts (recommended in Modal 1.0+)
# This assumes your OpenUtau source is in the same directory as this script
image = image.add_local_dir(
    ".",  # Include entire directory (contains voicebanks + OpenUtau source)
    remote_path="/app/openutau",
    copy=True,  # Copy files into image to allow post-build commands
    # Exclude unnecessary files for performance but KEEP models and vocoders
    ignore=[
        "UCache/**",
        "node_modules/**", 
        "**/*.wav",
        "**/*.7z",
        "bin/**",
        "obj/**",
        "openutau-piano-roll/**",  # Frontend stays on Vercel
        "precision_mixed_*.wav",
        "temp_*.ustx",
        "phrases_*.json",
        ".git/**"
        # Keep .oudep files - these are vocoder packages!
        # Keep .onnx files - these are ML models!
        # Keep G2p zip files - these are required for build!
    ]
).run_commands([
    # Force complete rebuild with GPU ONNX Runtime for CUDA 12 - clear all caches
    "cd /app/openutau && rm -rf bin/ obj/ */bin/ */obj/",
    "cd /app/openutau && dotnet nuget locals all --clear",
    "cd /app/openutau && dotnet restore --force --no-cache",
    "cd /app/openutau && dotnet clean",
    "cd /app/openutau && dotnet build OpenUtau.Cli/OpenUtau.Cli.csproj -c Release -o /app/openutau-build --force --no-incremental",
    # Comprehensive verification of CUDA provider libraries
    "echo '=== ONNX Runtime Files Check ==='",
    "find /app/openutau-build -name '*onnxruntime*' -type f | sort || echo 'No ONNX Runtime files found'",
    "echo '=== CUDA Provider Files Check ==='", 
    "find /app/openutau-build -name '*cuda*' -type f | sort || echo 'No CUDA files found'",
    "echo '=== ONNX Runtime CUDA Provider Dependencies Check ==='",
    "ldd /app/openutau-build/runtimes/linux-x64/native/libonnxruntime_providers_cuda.so 2>/dev/null | grep -E '(cufft|cublas|cudart)' || echo 'Could not check CUDA dependencies'",
    "strings /app/openutau-build/runtimes/linux-x64/native/libonnxruntime_providers_cuda.so 2>/dev/null | grep 'libcufft.so' || echo 'Could not check required CUDA FFT version'",
    "echo '=== Critical cuDNN Version Check ==='",
    "strings /app/openutau-build/runtimes/linux-x64/native/libonnxruntime_providers_cuda.so 2>/dev/null | grep -E 'libcudnn\\.so\\.[0-9]+' | head -5 || echo 'Could not determine cuDNN version requirement'",
    "echo '=== Linux Native Runtime Directory ==='",
    "ls -la /app/openutau-build/runtimes/linux-x64/native/ 2>/dev/null || echo 'No linux-x64 native directory'",
    "echo '=== Checking for Critical CUDA Provider Libraries ==='",
    "ls -la /app/openutau-build/runtimes/linux-x64/native/*cuda* 2>/dev/null || echo 'No CUDA provider libraries in native directory'",
    "ls -la /app/openutau-build/runtimes/linux-x64/native/*onnxruntime_providers_cuda* 2>/dev/null && echo '✅ CUDA provider found!' || echo 'CRITICAL: CUDA provider NOT FOUND'",
    # Ensure the CUDA provider can be found at runtime by creating symlinks if needed
    "cd /app/openutau-build/runtimes/linux-x64/native/ && ls -la *cuda* && echo 'CUDA provider verified!'",
    # Verify CUDA libraries are properly installed
    "echo '=== CUDA Libraries Verification ==='",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcublas* 2>/dev/null || echo 'cuBLAS libraries not found'",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcublasLt* 2>/dev/null || echo 'cuBLASLt libraries not found'",
    "echo '=== ONNX Runtime Compatibility Check ==='",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcublasLt.so.11 2>/dev/null && echo '✅ libcublasLt.so.11 symlink found!' || echo '❌ libcublasLt.so.11 symlink missing'",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcublas.so.11 2>/dev/null && echo '✅ libcublas.so.11 symlink found!' || echo '❌ libcublas.so.11 symlink missing'",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcufft.so.10 2>/dev/null && echo '✅ libcufft.so.10 symlink found!' || echo '❌ libcufft.so.10 symlink missing'",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcufft.so.11 2>/dev/null && echo '✅ libcufft.so.11 source found!' || echo '❌ libcufft.so.11 source missing'",
    "echo '=== cuDNN Library Check ==='",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcudnn.so.8 2>/dev/null && echo '✅ libcudnn.so.8 found!' || echo '❌ libcudnn.so.8 missing'",
    "ls -la /usr/local/cuda-12.6/targets/x86_64-linux/lib/libcudnn* 2>/dev/null || echo 'No cuDNN libraries found'",
    "ldconfig -p | grep -E '(libcudnn|cudnn)' || echo 'No cuDNN libraries found in ldconfig'",
    # Install vocoder after source code is available
    "mkdir -p /root/.local/share/OpenUtau/Dependencies",
    "cp /app/openutau/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep /root/.local/share/OpenUtau/Dependencies/ || echo 'Vocoder file not found'",
    "cd /root/.local/share/OpenUtau/Dependencies && unzip -o pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep -d pc_nsf_hifigan_44.1k_hop512_128bin_2025.02 || echo 'Vocoder extraction failed'"
])

# Voicebank storage - persistent across function calls
voicebank_volume = modal.Volume.from_name("openutau-voicebanks", create_if_missing=True)

@app.function(
    image=image,
    cpu=2,  # CPU-only inference
    timeout=180
)
def setup_vocoders_and_voicebanks():
    """
    One-time setup: Install vocoder dependencies and copy essential voicebanks
    Call this once after deployment to prepare the Modal environment
    """
    import subprocess
    import shutil
    
    print("🎙️ Setting up OpenUtau dependencies...")
    
    # Debug: List what files actually exist in the container
    print("🔍 Checking what files are available in /app/openutau:")
    if os.path.exists("/app/openutau"):
        print("📁 Contents of /app/openutau:")
        for item in os.listdir("/app/openutau"):
            item_path = os.path.join("/app/openutau", item)
            if os.path.isfile(item_path):
                print(f"   📄 {item} ({os.path.getsize(item_path)} bytes)")
            else:
                print(f"   📁 {item}/")
        
        # Look specifically for .oudep files
        print("🔍 Searching for .oudep files:")
        for root, dirs, files in os.walk("/app/openutau"):
            for file in files:
                if file.endswith(".oudep"):
                    full_path = os.path.join(root, file)
                    print(f"   ✅ Found: {full_path}")
    else:
        print("❌ /app/openutau directory does not exist!")
        return {"status": "error", "message": "/app/openutau not found"}
    
    # 1. Install vocoder packages (.oudep files) - search dynamically
    print("📦 Looking for vocoder files to install...")
    vocoder_files = []
    for root, dirs, files in os.walk("/app/openutau"):
        for file in files:
            if file.endswith(".oudep"):
                vocoder_files.append(os.path.join(root, file))
    
    if not vocoder_files:
        print("⚠️ No .oudep vocoder files found in the container")
    
    # First, build the OpenUtau CLI project
    print("🔨 Building OpenUtau CLI project...")
    try:
        # Skip build since we pre-built in the image
        build_result = subprocess.run([
            "ls", "-la", "/app/openutau-build/"
        ], capture_output=True, text=True, timeout=10)
        
        if build_result.returncode != 0:
            print(f"❌ Failed to build OpenUtau CLI:")
            print(f"   stdout: {build_result.stdout}")
            print(f"   stderr: {build_result.stderr}")
            print("⚠️ Skipping vocoder installation due to build failure")
            print("   (Voicebanks are still copied - you can install vocoders manually)")
        else:
            print("✅ OpenUtau CLI built successfully")
            
            # Now install vocoders
            for vocoder_path in vocoder_files:
                print(f"📦 Installing vocoder: {os.path.basename(vocoder_path)}")
                try:
                    result = subprocess.run([
                        "/app/openutau-build/OpenUtau.Cli", "install", vocoder_path
                    ], cwd="/app/openutau", capture_output=True, text=True, timeout=60)
            
                    if result.returncode == 0:
                        print(f"✅ Successfully installed {os.path.basename(vocoder_path)}")
                        print(f"   Output: {result.stdout}")
                    else:
                        print(f"❌ Failed to install {vocoder_path}")
                        print(f"   Error: {result.stderr}")
                except subprocess.TimeoutExpired:
                    print(f"⏰ Timeout installing {vocoder_path}")
                except Exception as e:
                    print(f"❌ Exception installing {vocoder_path}: {e}")
    except Exception as e:
        print(f"❌ Exception during build: {e}")
        print("⚠️ Proceeding without vocoder installation")
    
    # 2. Copy voicebanks with their models to persistent volume - search dynamically
    print("📁 Looking for voicebank directories...")
    voicebank_dirs = []
    
    # Look for directories that might be voicebanks (contain character.yaml/txt or model files)
    for item in os.listdir("/app/openutau"):
        item_path = os.path.join("/app/openutau", item)
        if os.path.isdir(item_path):
            # Check if it looks like a voicebank (has character config or .onnx files)
            has_character_file = any(
                os.path.exists(os.path.join(item_path, f"character.{ext}")) 
                for ext in ["yaml", "txt", "json"]
            )
            has_model_files = any(
                f.endswith(".onnx") for f in os.listdir(item_path) 
                if os.path.isfile(os.path.join(item_path, f))
            )
            
            if has_character_file or has_model_files:
                voicebank_dirs.append(item)
                print(f"   📁 Found potential voicebank: {item}")
    
    if not voicebank_dirs:
        print("⚠️ No voicebank directories found")
    
    # Prioritize fem_1_ln - only install the main singer we need
    priority_singers = ["fem_1_ln"]  # Only install the main singer
    singers_to_install = [name for name in voicebank_dirs if name in priority_singers]
    
    if not singers_to_install:
        print("⚠️ Priority singer 'fem_1_ln' not found, installing all available singers")
        singers_to_install = voicebank_dirs
    else:
        print(f"🎯 Found priority singer(s): {singers_to_install}")
    
    # Copy found voicebanks directly to OpenUtau directory (alongside the source)
    for voicebank_name in singers_to_install:
        source_path = f"/app/openutau/{voicebank_name}"
        # Copy to both locations - persistent storage and OpenUtau directory
        persistent_path = f"/voicebanks/{voicebank_name}"
        openutau_path = f"/app/openutau/Singers/{voicebank_name}"
        
        print(f"📁 Copying voicebank: {voicebank_name}")
        try:
            # Copy to persistent storage
            if os.path.exists(persistent_path):
                shutil.rmtree(persistent_path)
            shutil.copytree(source_path, persistent_path)
            print(f"✅ Copied {voicebank_name} to persistent storage: {persistent_path}")
            
            # Also copy to OpenUtau Singers directory
            os.makedirs("/app/openutau/Singers", exist_ok=True)
            if os.path.exists(openutau_path):
                shutil.rmtree(openutau_path)
            shutil.copytree(source_path, openutau_path)
            print(f"✅ Copied {voicebank_name} to OpenUtau directory: {openutau_path}")
            
            # Verify essential model files exist
            model_files = glob.glob(f"{persistent_path}/**/*.onnx", recursive=True)
            if model_files:
                print(f"   Found {len(model_files)} .onnx model files")
                for model in model_files[:3]:  # Show first 3
                    rel_path = os.path.relpath(model, persistent_path)
                    print(f"     - {rel_path}")
                if len(model_files) > 3:
                    print(f"     ... and {len(model_files) - 3} more")
            else:
                print(f"   ⚠️ No .onnx model files found in {voicebank_name}")
            
        except Exception as e:
            print(f"❌ Failed to copy {voicebank_name}: {e}")
    
    print("🎉 Setup complete! Modal environment ready for voice synthesis.")
    return {
        "status": "success", 
        "message": "Vocoders and voicebanks installed",
        "vocoders_found": len(vocoder_files),
        "voicebanks_found": len(voicebank_dirs)
    }

# Disabled old function - only use web_render_segment
# @app.function(
#     image=image,
#     volumes={"/voicebanks": voicebank_volume},
#     gpu="T4",  # NVIDIA T4 GPU for DiffSinger inference (cost-effective)
#     timeout=600,  # 10 minutes max
#     memory=8192,  # 8GB RAM
# )
def render_segment_OLD_DISABLED(
    ustx_data: Dict[str, Any],
    singer_id: str,
    start_note_index: Optional[int] = None,
    end_note_index: Optional[int] = None,
    quality_settings: Optional[Dict[str, Any]] = None,
    phrase_numbers: Optional[list] = None
) -> bytes:
    """
    Render a segment of audio using OpenUtau CLI
    Returns the generated WAV file as bytes
    """
    
    print(f"🎤 Starting render: singer={singer_id}, quality={quality_settings}")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # 1. Write USTX data to temporary file as JSON (like working Next.js API)
        ustx_file = temp_path / "input.ustx" 
        with open(ustx_file, 'w') as f:
            json.dump(ustx_data, f, indent=2)
        
        # 2. Prepare output paths
        output_wav = temp_path / "output.wav"
        output_json = temp_path / "output.json"
        
        # 3. Build OpenUtau CLI command
        cli_cmd = [
            "dotnet", "run", 
            "--project", "/app/openutau/OpenUtau.Cli",
            "--",
            str(ustx_file),
            singer_id,
            str(output_json),
            str(output_wav),
            "--reset-timings",
            "--phoneme-override", "dream:0:d:jh"
        ]
        
        # Add quality settings if provided
        if quality_settings:
            cli_cmd.extend([
                "--diffsinger-depth", str(quality_settings.get("diffSingerDepth", 1000)),
                "--diffsinger-steps", str(quality_settings.get("diffSingerSteps", 1000)), 
                "--diffsinger-steps-pitch", str(quality_settings.get("diffSingerStepsPitch", 5)),
                "--diffsinger-steps-variance", str(quality_settings.get("diffSingerStepsVariance", 4))
            ])
        
        # Add phrase rendering if specific notes specified
        if start_note_index is not None and end_note_index is not None:
            # Convert note indices to phrase numbers (you may need to adjust this logic)
            phrase_numbers = f"{start_note_index},{end_note_index}"
            cli_cmd.extend(["--render-phrases", phrase_numbers])
        
        print(f"🚀 Executing: {' '.join(cli_cmd)}")
        
        # 4. Execute OpenUtau CLI using EXACT same method as working Next.js API
        try:
            # Use actual path where singer exists in Modal container
            voicebank_path = f"/app/openutau/{singer_id}"
            cli_command_str = f"mkdir -p /root/.cache/OpenUtau && /app/openutau-build/OpenUtau.Cli {ustx_file} {voicebank_path} {output_json} {output_wav} --reset-timings --phoneme-override dream:0:d:jh"
            
            # Add quality settings exactly like working API
            if quality_settings:
                cli_command_str += f" --diffsinger-depth {quality_settings.get('diffSingerDepth', 1000)}"
                cli_command_str += f" --diffsinger-steps {quality_settings.get('diffSingerSteps', 1000)}"
                cli_command_str += f" --diffsinger-steps-pitch {quality_settings.get('diffSingerStepsPitch', 5)}" 
                cli_command_str += f" --diffsinger-steps-variance {quality_settings.get('diffSingerStepsVariance', 4)}"
            
            # Add phrase rendering if phrase numbers are provided
            if phrase_numbers:
                # Clean up the phrase numbers - filter out None/empty values
                clean_phrases = []
                for p in phrase_numbers:
                    if p is not None and str(p).strip():
                        clean_phrases.append(str(p).strip())
                
                if clean_phrases:
                    phrase_list = ','.join(clean_phrases)
                    cli_command_str += f" --render-phrases {phrase_list}"
            elif start_note_index is not None and end_note_index is not None:
                # Fallback: old logic for backward compatibility
                phrase_numbers_str = f"{start_note_index},{end_note_index}"
                cli_command_str += f" --render-phrases {phrase_numbers_str}"
            
            print(f"🚀 Executing EXACT command like working API: {cli_command_str}")
            
            # Execute using bash -c exactly like working Next.js API
            result = subprocess.run([
                'bash',
                '-c', 
                cli_command_str
            ], cwd="/app/openutau", capture_output=True, text=True, timeout=300)
            
            print(f"📊 CLI stdout: {result.stdout}")
            if result.stderr:
                print(f"⚠️ CLI stderr: {result.stderr}")
            
            if result.returncode != 0:
                raise Exception(f"OpenUtau CLI failed with code {result.returncode}: {result.stderr}")
            
            # 5. Read and return the generated audio
            if not output_wav.exists():
                raise Exception("OpenUtau CLI did not generate expected WAV output")
            
            with open(output_wav, 'rb') as f:
                audio_data = f.read()
            
            print(f"✅ Generated {len(audio_data)} bytes of audio")
            return audio_data
            
        except subprocess.TimeoutExpired:
            raise Exception("OpenUtau CLI timed out - render took too long")
        except Exception as e:
            print(f"❌ Error during rendering: {e}")
            raise


@app.function(
    image=image, 
    volumes={"/voicebanks": voicebank_volume},
    cpu=2,  # CPU-only inference
    timeout=300
)
def phonemize(ustx_data: Dict[str, Any], singer_id: str) -> Dict[str, Any]:
    """
    Get phoneme timing data from OpenUtau CLI
    Returns phoneme timing information as JSON
    """
    
    print(f"🔤 Phonemizing with singer: {singer_id}")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # Write USTX data as JSON (like working Next.js API)
        ustx_file = temp_path / "input.ustx"
        with open(ustx_file, 'w') as f:
            json.dump(ustx_data, f, indent=2)
        
        # Output path for timing data
        output_json = temp_path / "phonemes.json"
        
        # Build CLI command for phonemization only
        cli_cmd = [
            "dotnet", "run",
            "--project", "/app/openutau/OpenUtau.Cli", 
            "--",
            str(ustx_file),
            singer_id,
            str(output_json),
            "--reset-timings",
            "--preserve-silence-timing"
        ]
        
        print(f"🚀 Executing: {' '.join(cli_cmd)}")
        
        try:
            # Use actual path where singer exists in Modal container
            voicebank_path = f"/app/openutau/{singer_id}"
            cli_command_str = f"mkdir -p /root/.cache/OpenUtau && /app/openutau-build/OpenUtau.Cli {ustx_file} {voicebank_path} {output_json} --reset-timings --preserve-silence-timing"
            
            print(f"🚀 Executing EXACT phonemize command like working API: {cli_command_str}")
            
            # Execute using bash -c exactly like working Next.js API  
            result = subprocess.run([
                'bash',
                '-c', 
                cli_command_str
            ], cwd="/app/openutau", capture_output=True, text=True, timeout=120)
            
            print(f"📊 Phonemize stdout: {result.stdout}")
            if result.stderr:
                print(f"⚠️ Phonemize stderr: {result.stderr}")
            
            if result.returncode != 0:
                raise Exception(f"Phonemization failed: {result.stderr}")
            
            # Read phoneme timing data
            if not output_json.exists():
                raise Exception("No phoneme data generated")
            
            with open(output_json, 'r') as f:
                phoneme_data = json.load(f)
            
            print(f"✅ Generated phoneme data for {len(phoneme_data)} phonemes")
            return {
                "success": True,
                "phonemes": phoneme_data,
                "total_phonemes": len(phoneme_data)
            }
            
        except Exception as e:
            print(f"❌ Phonemization error: {e}")
            raise


@app.function(
    image=image,
    volumes={"/voicebanks": voicebank_volume},
    cpu=1,  # CPU-only inference
    timeout=60
)
def install_voicebank(voicebank_data: bytes, voicebank_name: str) -> Dict[str, str]:
    """
    Install a voicebank to persistent storage
    Takes voicebank archive bytes and extracts to volume
    """
    
    print(f"📦 Installing voicebank: {voicebank_name}")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        
        # Write voicebank data to temp file
        archive_path = temp_path / f"{voicebank_name}.zip"
        with open(archive_path, 'wb') as f:
            f.write(voicebank_data)
        
        # Extract to voicebank volume
        voicebank_dir = Path("/voicebanks") / voicebank_name
        voicebank_dir.mkdir(parents=True, exist_ok=True)
        
        # Unzip the voicebank
        subprocess.run([
            "unzip", "-o", str(archive_path), "-d", str(voicebank_dir)
        ], check=True)
        
        print(f"✅ Installed voicebank to {voicebank_dir}")
        return {
            "success": True,
            "path": str(voicebank_dir),
            "message": f"Voicebank {voicebank_name} installed successfully"
        }


@app.function(
    volumes={"/voicebanks": voicebank_volume},
    cpu=1,  # CPU-only inference
    timeout=30
)
def list_voicebanks() -> Dict[str, Any]:
    """List available voicebanks"""
    
    voicebanks_dir = Path("/voicebanks")
    if not voicebanks_dir.exists():
        return {"voicebanks": []}
    
    voicebanks = []
    for item in voicebanks_dir.iterdir():
        if item.is_dir():
            # Check for character.yaml or character.txt to confirm it's a voicebank
            config_files = list(item.glob("character.*"))
            if config_files:
                voicebanks.append({
                    "name": item.name,
                    "path": str(item),
                    "config_files": [f.name for f in config_files]
                })
    
    return {"voicebanks": voicebanks}


# FastAPI web endpoints for Next.js integration
@app.function(
    image=image,
    volumes={"/voicebanks": voicebank_volume}, 
    gpu="T4",  # NVIDIA T4 GPU for DiffSinger inference (cost-effective)
    timeout=600,
    memory=8192
)
@modal.fastapi_endpoint(method="POST")
def render_segment(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """HTTP endpoint for rendering with GPU (and CPU fallback)"""
    try:
        # Extract parameters
        ustx_data = request_data["ustxData"]
        singer_id = request_data["singerId"]
        start_note_index = request_data.get("startNoteIndex")
        end_note_index = request_data.get("endNoteIndex")
        quality_settings = request_data.get("qualitySettings")
        phrase_number = request_data.get("phraseNumbers")
        use_gpu = request_data.get("useGPU", True)  # Default to GPU
        
        # Override ONNX settings based on useGPU parameter
        if use_gpu:
            os.environ["OPENUTAU_ONNX_RUNNER"] = "CUDA"
            os.environ["OPENUTAU_ONNX_GPU"] = "0"
            # Additional CUDA environment variables for better compatibility
            os.environ["CUDA_VISIBLE_DEVICES"] = "0"
            os.environ["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"
            
            # Check CUDA availability
            try:
                result = subprocess.run(['nvidia-smi'], capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    print("✅ NVIDIA GPU detected:")
                    # Show first few lines of nvidia-smi
                    lines = result.stdout.split('\n')[:5]
                    for line in lines:
                        if line.strip():
                            print(f"   {line}")
                else:
                    print("⚠️ nvidia-smi failed - GPU might not be available")
            except:
                print("⚠️ Could not run nvidia-smi")
            
            # Keep original thread settings for GPU stability
            os.environ["OMP_NUM_THREADS"] = "4"
            os.environ["MKL_NUM_THREADS"] = "4"
            os.environ["OPENBLAS_NUM_THREADS"] = "4"
            print("⚡ Using GPU (CUDA) for ONNX inference")
            
            # Enhanced ONNX Runtime debugging
            try:
                # Check if CUDA libraries are properly accessible
                cuda_libs_check = subprocess.run(['find', '/usr/local/cuda*', '-name', 'libcudart*', '-type', 'f'], 
                                                capture_output=True, text=True, timeout=5)
                if cuda_libs_check.stdout:
                    print("✅ CUDA runtime libraries found:")
                    for lib in cuda_libs_check.stdout.strip().split('\n')[:3]:
                        print(f"   {lib}")
                else:
                    print("⚠️ No CUDA runtime libraries found")
                
                # Check ONNX Runtime CUDA provider
                onnx_cuda_check = subprocess.run(['find', '/app/openutau-build', '-name', '*onnxruntime_providers_cuda*', '-type', 'f'], 
                                                capture_output=True, text=True, timeout=5)
                if onnx_cuda_check.stdout:
                    print("✅ ONNX CUDA provider found:")
                    for lib in onnx_cuda_check.stdout.strip().split('\n'):
                        print(f"   {lib}")
                        # Check dependencies
                        try:
                            ldd_result = subprocess.run(['ldd', lib], capture_output=True, text=True, timeout=3)
                            if ldd_result.returncode == 0:
                                missing = [line for line in ldd_result.stdout.split('\n') if 'not found' in line]
                                if missing:
                                    print(f"   ⚠️ Missing dependencies: {missing}")
                                else:
                                    print(f"   ✅ All dependencies satisfied")
                        except:
                            pass
                else:
                    print("❌ ONNX CUDA provider NOT FOUND - GPU will fail")
                    
            except Exception as e:
                print(f"⚠️ Could not check CUDA setup: {e}")
        else:
            os.environ["OPENUTAU_ONNX_RUNNER"] = "CPU"
            # Use full threading for CPU on T4 container (same hardware as GPU test)
            os.environ["OMP_NUM_THREADS"] = "8"
            os.environ["MKL_NUM_THREADS"] = "8"
            os.environ["OPENBLAS_NUM_THREADS"] = "8"
            print("🖥️ Using CPU for ONNX inference (full threading)")
        
        print(f"🎤 Starting render: singer={singer_id}, quality={quality_settings}")
        print(f"🎯 DEBUG: Raw phrase_number received: {phrase_number}")
        print(f"🎯 DEBUG: Type of phrase_number: {type(phrase_number)}")
        
        # DEBUG: List available singers to debug the path issue
        print("🔍 DEBUG: Checking available singers...")
        singer_paths_to_check = [
            f"/app/openutau/{singer_id}",
            f"/voicebanks/{singer_id}",
            f"/app/openutau/Singers/{singer_id}"
        ]
        
        for path in singer_paths_to_check:
            if os.path.exists(path):
                print(f"✅ Found singer at: {path}")
                # List contents to see what's inside
                try:
                    contents = os.listdir(path)
                    print(f"   Contents: {contents[:10]}")  # Show first 10 items
                except Exception as e:
                    print(f"   Could not list contents: {e}")
            else:
                print(f"❌ Singer not found at: {path}")
        
        # Also check what directories exist in /app/openutau
        print("🔍 DEBUG: Listing /app/openutau directories...")
        if os.path.exists("/app/openutau"):
            try:
                all_items = os.listdir("/app/openutau")
                directories = [item for item in all_items if os.path.isdir(os.path.join("/app/openutau", item))]
                print(f"   Directories: {directories}")
            except Exception as e:
                print(f"   Could not list /app/openutau: {e}")
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # 1. Write USTX data to temporary file as JSON (like working Next.js API)
            ustx_file = temp_path / "input.ustx" 
            with open(ustx_file, 'w') as f:
                json.dump(ustx_data, f, indent=2)
            
            # Debug: Show what we wrote to the USTX file
            print(f"🎯 DEBUG: USTX file written to: {ustx_file}")
            print(f"🎯 DEBUG: USTX data keys: {list(ustx_data.keys())}")
            print(f"🎯 DEBUG: Voice parts count: {len(ustx_data.get('voice_parts', []))}")
            if ustx_data.get('voice_parts'):
                total_notes = sum(len(part.get('notes', [])) for part in ustx_data['voice_parts'])
                print(f"🎯 DEBUG: Total notes in USTX: {total_notes}")
            print(f"🎯 DEBUG: USTX file size: {ustx_file.stat().st_size} bytes")
            
            # 2. Prepare output paths
            output_wav = temp_path / "output.wav"
            output_json = temp_path / "output.json"
            
            # 3. Build OpenUtau CLI command
            cli_cmd = [
                "dotnet", "run", 
                "--project", "/app/openutau/OpenUtau.Cli",
                "--",
                str(ustx_file),
                singer_id,
                str(output_json),
                str(output_wav),
                "--reset-timings",
                "--phoneme-override", "dream:0:d:jh"
            ]
            
            # Add quality settings if provided
            if quality_settings:
                cli_cmd.extend([
                    "--diffsinger-depth", str(quality_settings.get("diffSingerDepth", 1000)),
                    "--diffsinger-steps", str(quality_settings.get("diffSingerSteps", 1000)), 
                    "--diffsinger-steps-pitch", str(quality_settings.get("diffSingerStepsPitch", 5)),
                    "--diffsinger-steps-variance", str(quality_settings.get("diffSingerStepsVariance", 4))
                ])
            
            # Old phrase logic removed - only using phrase_number now
            
            # Use actual path where singer exists in Modal container
            voicebank_path = f"/app/openutau/{singer_id}" 
            cli_command_str = f"mkdir -p /root/.cache/OpenUtau && /app/openutau-build/OpenUtau.Cli {ustx_file} {voicebank_path} {output_json} {output_wav} --reset-timings --phoneme-override dream:0:d:jh"
            
            # Add quality settings exactly like working API
            if quality_settings:
                cli_command_str += f" --diffsinger-depth {quality_settings.get('diffSingerDepth', 1000)}"
                cli_command_str += f" --diffsinger-steps {quality_settings.get('diffSingerSteps', 1000)}"
                cli_command_str += f" --diffsinger-steps-pitch {quality_settings.get('diffSingerStepsPitch', 5)}" 
                cli_command_str += f" --diffsinger-steps-variance {quality_settings.get('diffSingerStepsVariance', 4)}"
            
            # Add phrase rendering if phrase number is provided
            if phrase_number:
                cli_command_str += f" --render-phrases {phrase_number}"
                print(f"🎯 DEBUG: Using phrase number: {phrase_number}")
            
            print(f"🚀 Web endpoint executing EXACT command like working API: {cli_command_str}")
            
            # Show environment variables for debugging
            env_vars = ['OPENUTAU_ONNX_RUNNER', 'OPENUTAU_ONNX_GPU', 'CUDA_VISIBLE_DEVICES', 'ORT_LOG_LEVEL', 'OPENUTAU_DEBUG_ONNX']
            for var in env_vars:
                print(f"🔧 {var}={os.environ.get(var, 'unset')}")
            
            # Execute using bash -c exactly like working Next.js API
            result = subprocess.run([
                'bash',
                '-c', 
                cli_command_str
            ], cwd="/app/openutau", capture_output=True, text=True, timeout=300)
            
            print(f"📊 GPU Render CLI returncode: {result.returncode}")
            print(f"📊 GPU CLI stdout length: {len(result.stdout)} chars")
            if result.stdout:
                print("📊 GPU CLI stdout (showing ALL lines for debugging):")
                for i, line in enumerate(result.stdout.split('\n')):
                    if line.strip():
                        print(f"   {i+1:2d}: {line}")
            
            print(f"⚠️ GPU CLI stderr length: {len(result.stderr)} chars")
            if result.stderr:
                print("⚠️ GPU CLI stderr (showing ALL lines for debugging):")
                for i, line in enumerate(result.stderr.split('\n')):
                    if line.strip():
                        print(f"   {i+1:2d}: {line}")
            
            # Check if output file exists and its size
            if output_wav.exists():
                file_size = output_wav.stat().st_size
                print(f"📊 Output WAV file size: {file_size} bytes")
            else:
                print(f"❌ Output WAV file does not exist at {output_wav}")
            
            if result.returncode != 0:
                raise Exception(f"OpenUtau CLI failed with code {result.returncode}: {result.stderr}")
            
            # Read and return the generated audio
            if not output_wav.exists():
                raise Exception("OpenUtau CLI did not generate expected WAV output")
            
            with open(output_wav, 'rb') as f:
                audio_data = f.read()
            
            # Check if we got a valid audio file (more than just WAV header)
            if len(audio_data) <= 46 and use_gpu:
                print("⚠️ GPU rendering failed (empty audio), retrying with CPU...")
                
                # Retry with CPU
                os.environ["OPENUTAU_ONNX_RUNNER"] = "CPU"
                print("🖥️ Falling back to CPU for ONNX inference")
                
                # Re-run the command with CPU
                result = subprocess.run([
                    'bash',
                    '-c', 
                    cli_command_str
                ], cwd="/app/openutau", capture_output=True, text=True, timeout=300)
                
                print(f"📊 CPU fallback returncode: {result.returncode}")
                print(f"📊 CPU fallback stdout: {result.stdout}")
                print(f"⚠️ CPU fallback stderr: {result.stderr}")
                
                if result.returncode == 0 and output_wav.exists():
                    with open(output_wav, 'rb') as f:
                        audio_data = f.read()
                    print(f"✅ CPU fallback generated {len(audio_data)} bytes of audio")
            
            print(f"✅ Generated {len(audio_data)} bytes of audio")
            
            # Return base64 encoded audio
            import base64
            audio_b64 = base64.b64encode(audio_data).decode()
            
            return {
                "success": True,
                "audio": audio_b64,
                "size": len(audio_data),
                "used_cpu_fallback": len(audio_data) <= 46 and use_gpu
            }
        
    except Exception as e:
        print(f"❌ Render error: {e}")
        return {
            "success": False,
            "error": str(e)
        }


# High-performance CPU-only endpoint
@app.function(
    image=image,
    volumes={"/voicebanks": voicebank_volume}, 
    cpu=8,  # 8 cores for high-performance CPU rendering
    memory=8192,  # 8GB RAM
    timeout=600
)
@modal.fastapi_endpoint(method="POST")
def render_segment_cpu(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """HTTP endpoint for high-performance CPU-only rendering"""
    try:
        # Extract parameters
        ustx_data = request_data["ustxData"]
        singer_id = request_data["singerId"]
        start_note_index = request_data.get("startNoteIndex")
        end_note_index = request_data.get("endNoteIndex")
        quality_settings = request_data.get("qualitySettings")
        phrase_number = request_data.get("phraseNumbers")
        
        # Force CPU mode with high-performance threading
        os.environ["OPENUTAU_ONNX_RUNNER"] = "CPU"
        os.environ["OMP_NUM_THREADS"] = "8"  # OpenMP threads
        os.environ["MKL_NUM_THREADS"] = "8"  # Intel MKL threads
        os.environ["OPENBLAS_NUM_THREADS"] = "8"  # OpenBLAS threads
        os.environ["DOTNET_ThreadPool_MaxThreads"] = "16"  # .NET thread pool
        print("🖥️ Using high-performance CPU (8 cores) for ONNX inference")
        print(f"🔧 Threading: OMP={os.environ.get('OMP_NUM_THREADS')}, MKL={os.environ.get('MKL_NUM_THREADS')}")
        
        # Show CPU info
        import subprocess
        try:
            cpu_info = subprocess.run(['nproc'], capture_output=True, text=True)
            print(f"🔧 Available CPU cores: {cpu_info.stdout.strip()}")
        except:
            pass
        
        print(f"🎤 Starting CPU render: singer={singer_id}, quality={quality_settings}")
        print(f"🎯 DEBUG: Raw phrase_number received: {phrase_number}")
        print(f"🎯 DEBUG: Type of phrase_number: {type(phrase_number)}")
        
        # DEBUG: List available singers to debug the path issue
        print("🔍 DEBUG: Checking available singers...")
        singer_paths_to_check = [
            f"/app/openutau/{singer_id}",
            f"/voicebanks/{singer_id}",
            f"/app/openutau/Singers/{singer_id}"
        ]
        
        for path in singer_paths_to_check:
            if os.path.exists(path):
                print(f"✅ Found singer at: {path}")
                # List contents to see what's inside
                try:
                    contents = os.listdir(path)
                    print(f"   Contents: {contents[:10]}")  # Show first 10 items
                except Exception as e:
                    print(f"   Could not list contents: {e}")
            else:
                print(f"❌ Singer not found at: {path}")
        
        # Also check what directories exist in /app/openutau
        print("🔍 DEBUG: Listing /app/openutau directories...")
        if os.path.exists("/app/openutau"):
            try:
                all_items = os.listdir("/app/openutau")
                directories = [item for item in all_items if os.path.isdir(os.path.join("/app/openutau", item))]
                print(f"   Directories: {directories}")
            except Exception as e:
                print(f"   Could not list /app/openutau: {e}")
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # 1. Write USTX data to temporary file as JSON (like working Next.js API)
            ustx_file = temp_path / "input.ustx" 
            with open(ustx_file, 'w') as f:
                json.dump(ustx_data, f, indent=2)
            
            # Debug: Show what we wrote to the USTX file
            print(f"🎯 DEBUG: USTX file written to: {ustx_file}")
            print(f"🎯 DEBUG: USTX data keys: {list(ustx_data.keys())}")
            print(f"🎯 DEBUG: Voice parts count: {len(ustx_data.get('voice_parts', []))}")
            if ustx_data.get('voice_parts'):
                total_notes = sum(len(part.get('notes', [])) for part in ustx_data['voice_parts'])
                print(f"🎯 DEBUG: Total notes in USTX: {total_notes}")
            print(f"🎯 DEBUG: USTX file size: {ustx_file.stat().st_size} bytes")
            
            # 2. Prepare output paths
            output_wav = temp_path / "output.wav"
            output_json = temp_path / "output.json"
            
            # Use actual path where singer exists in Modal container
            voicebank_path = f"/app/openutau/{singer_id}" 
            cli_command_str = f"mkdir -p /root/.cache/OpenUtau && /app/openutau-build/OpenUtau.Cli {ustx_file} {voicebank_path} {output_json} {output_wav} --reset-timings --phoneme-override dream:0:d:jh"
            
            # Add quality settings exactly like working API
            if quality_settings:
                cli_command_str += f" --diffsinger-depth {quality_settings.get('diffSingerDepth', 1000)}"
                cli_command_str += f" --diffsinger-steps {quality_settings.get('diffSingerSteps', 1000)}"
                cli_command_str += f" --diffsinger-steps-pitch {quality_settings.get('diffSingerStepsPitch', 5)}" 
                cli_command_str += f" --diffsinger-steps-variance {quality_settings.get('diffSingerStepsVariance', 4)}"
            
            # Add phrase rendering if phrase number is provided
            if phrase_number:
                cli_command_str += f" --render-phrases {phrase_number}"
                print(f"🎯 DEBUG: Using phrase number: {phrase_number}")
            
            print(f"🚀 CPU endpoint executing command: {cli_command_str}")
            
            # Execute using bash -c exactly like working Next.js API
            result = subprocess.run([
                'bash',
                '-c', 
                cli_command_str
            ], cwd="/app/openutau", capture_output=True, text=True, timeout=300)
            
            print(f"📊 CLI returncode: {result.returncode}")
            print(f"📊 CLI stdout: {result.stdout}")
            print(f"⚠️ CLI stderr: {result.stderr}")
            
            # Check if output file exists and its size
            if output_wav.exists():
                file_size = output_wav.stat().st_size
                print(f"📊 Output WAV file size: {file_size} bytes")
            else:
                print(f"❌ Output WAV file does not exist at {output_wav}")
            
            if result.returncode != 0:
                raise Exception(f"OpenUtau CLI failed with code {result.returncode}: {result.stderr}")
            
            # Read and return the generated audio
            if not output_wav.exists():
                raise Exception("OpenUtau CLI did not generate expected WAV output")
            
            with open(output_wav, 'rb') as f:
                audio_data = f.read()
            
            print(f"✅ Generated {len(audio_data)} bytes of audio with high-performance CPU")
            
            # Return base64 encoded audio
            import base64
            audio_b64 = base64.b64encode(audio_data).decode()
            
            return {
                "success": True,
                "audio": audio_b64,
                "size": len(audio_data),
                "used_cpu": True,
                "cpu_cores": 8
            }
        
    except Exception as e:
        print(f"❌ CPU Render error: {e}")
        return {
            "success": False,
            "error": str(e)
        }


# Ultra high-performance CPU-only endpoint (32 cores)
@app.function(
    image=image,
    volumes={"/voicebanks": voicebank_volume}, 
    cpu=32,  # 32 cores for maximum CPU performance
    memory=16384,  # 16GB RAM
    timeout=600
)
@modal.fastapi_endpoint(method="POST")
def render_segment_cpu_32(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """HTTP endpoint for ultra high-performance 32-core CPU rendering"""
    try:
        # Extract parameters
        ustx_data = request_data["ustxData"]
        singer_id = request_data["singerId"]
        start_note_index = request_data.get("startNoteIndex")
        end_note_index = request_data.get("endNoteIndex")
        quality_settings = request_data.get("qualitySettings")
        phrase_number = request_data.get("phraseNumbers")
        
        # Force CPU mode with maximum threading
        os.environ["OPENUTAU_ONNX_RUNNER"] = "CPU"
        os.environ["OMP_NUM_THREADS"] = "32"  # OpenMP threads
        os.environ["MKL_NUM_THREADS"] = "32"  # Intel MKL threads
        os.environ["OPENBLAS_NUM_THREADS"] = "32"  # OpenBLAS threads
        os.environ["DOTNET_ThreadPool_MaxThreads"] = "64"  # .NET thread pool
        print("🔥 Using ultra high-performance CPU (32 cores) for ONNX inference")
        print(f"🔧 Threading: OMP={os.environ.get('OMP_NUM_THREADS')}, MKL={os.environ.get('MKL_NUM_THREADS')}")
        
        # Show CPU info
        import subprocess
        try:
            cpu_info = subprocess.run(['nproc'], capture_output=True, text=True)
            print(f"🔧 Available CPU cores: {cpu_info.stdout.strip()}")
        except:
            pass
        
        print(f"🎤 Starting 32-core CPU render: singer={singer_id}, quality={quality_settings}")
        print(f"🎯 DEBUG: Raw phrase_number received: {phrase_number}")
        print(f"🎯 DEBUG: Type of phrase_number: {type(phrase_number)}")
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # 1. Write USTX data to temporary file as JSON
            ustx_file = temp_path / "input.ustx" 
            with open(ustx_file, 'w') as f:
                json.dump(ustx_data, f, indent=2)
            
            print(f"🎯 DEBUG: USTX file written to: {ustx_file}")
            print(f"🎯 DEBUG: USTX file size: {ustx_file.stat().st_size} bytes")
            
            # 2. Prepare output paths
            output_wav = temp_path / "output.wav"
            output_json = temp_path / "output.json"
            
            # Use pre-built binary for maximum speed
            voicebank_path = f"/app/openutau/{singer_id}" 
            cli_command_str = f"mkdir -p /root/.cache/OpenUtau && /app/openutau-build/OpenUtau.Cli {ustx_file} {voicebank_path} {output_json} {output_wav} --reset-timings --phoneme-override dream:0:d:jh"
            
            # Add quality settings
            if quality_settings:
                cli_command_str += f" --diffsinger-depth {quality_settings.get('diffSingerDepth', 1000)}"
                cli_command_str += f" --diffsinger-steps {quality_settings.get('diffSingerSteps', 1000)}"
                cli_command_str += f" --diffsinger-steps-pitch {quality_settings.get('diffSingerStepsPitch', 5)}" 
                cli_command_str += f" --diffsinger-steps-variance {quality_settings.get('diffSingerStepsVariance', 4)}"
            
            # Add phrase rendering if phrase number is provided
            if phrase_number:
                cli_command_str += f" --render-phrases {phrase_number}"
                print(f"🎯 DEBUG: Using phrase number: {phrase_number}")
            
            print(f"🚀 32-core CPU endpoint executing command: {cli_command_str}")
            
            # Execute the command
            result = subprocess.run([
                'bash',
                '-c', 
                cli_command_str
            ], cwd="/app/openutau", capture_output=True, text=True, timeout=300)
            
            print(f"📊 CLI returncode: {result.returncode}")
            print(f"📊 CLI stdout: {result.stdout}")
            print(f"⚠️ CLI stderr: {result.stderr}")
            
            # Check if output file exists and its size
            if output_wav.exists():
                file_size = output_wav.stat().st_size
                print(f"📊 Output WAV file size: {file_size} bytes")
            else:
                print(f"❌ Output WAV file does not exist at {output_wav}")
            
            if result.returncode != 0:
                raise Exception(f"OpenUtau CLI failed with code {result.returncode}: {result.stderr}")
            
            # Read and return the generated audio
            if not output_wav.exists():
                raise Exception("OpenUtau CLI did not generate expected WAV output")
            
            with open(output_wav, 'rb') as f:
                audio_data = f.read()
            
            print(f"✅ Generated {len(audio_data)} bytes of audio with 32-core CPU")
            
            # Return base64 encoded audio
            import base64
            audio_b64 = base64.b64encode(audio_data).decode()
            
            return {
                "success": True,
                "audio": audio_b64,
                "size": len(audio_data),
                "used_cpu": True,
                "cpu_cores": 32
            }
        
    except Exception as e:
        print(f"❌ 32-core CPU Render error: {e}")
        return {
            "success": False,
            "error": str(e)
        }


@app.function(
    image=image,
    volumes={"/voicebanks": voicebank_volume},
    cpu=2,  # CPU-only inference
    timeout=300
)
@modal.fastapi_endpoint(method="POST")
def web_phonemize(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """HTTP endpoint for phonemization"""
    try:
        # Extract data from request
        ustx_data = request_data["ustxData"]
        singer_id = request_data["singerId"]
        
        print(f"🔤 Phonemizing with singer: {singer_id}")
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Write USTX data as JSON (like working Next.js API)
            ustx_file = temp_path / "input.ustx"
            with open(ustx_file, 'w') as f:
                json.dump(ustx_data, f, indent=2)
            
            # Output path for timing data
            output_json = temp_path / "phonemes.json"
            
            # Use actual path where singer exists in Modal container
            voicebank_path = f"/app/openutau/{singer_id}"
            cli_command_str = f"mkdir -p /root/.cache/OpenUtau && /app/openutau-build/OpenUtau.Cli {ustx_file} {voicebank_path} {output_json} --reset-timings --preserve-silence-timing"
            
            print(f"🚀 Web phonemize executing EXACT phonemize command like working API: {cli_command_str}")
            
            # Execute using bash -c exactly like working Next.js API  
            result = subprocess.run([
                'bash',
                '-c', 
                cli_command_str
            ], cwd="/app/openutau", capture_output=True, text=True, timeout=120)
            
            print(f"📊 Phonemize stdout: {result.stdout}")
            if result.stderr:
                print(f"⚠️ Phonemize stderr: {result.stderr}")
            
            if result.returncode != 0:
                raise Exception(f"Phonemization failed: {result.stderr}")
            
            # Read phoneme timing data
            if not output_json.exists():
                raise Exception("No phoneme data generated")
            
            with open(output_json, 'r') as f:
                phoneme_data = json.load(f)
            
            print(f"✅ Generated phoneme data for {len(phoneme_data)} phonemes")
            return {
                "success": True,
                "phonemes": phoneme_data,
                "total_phonemes": len(phoneme_data)
            }
        
    except Exception as e:
        print(f"❌ Phonemization error: {e}")
        return {
            "success": False,
            "error": str(e)
        }


@app.function(
    image=image,
    volumes={"/voicebanks": voicebank_volume},
    cpu=2,  # CPU-only inference
    timeout=300
)
@modal.fastapi_endpoint(method="POST")
def ds_phrase_extractor(request_data: Dict[str, Any]) -> Dict[str, Any]:
    """HTTP endpoint that uses DiffSinger CLI to generate DS file and extracts proper phrase boundaries
    
    Uses the exact approach from the working CLI command that generates natural phrase boundaries:
    rm -rf /home/codespace/.cache/OpenUtau/* && dotnet run --project OpenUtau.Cli -- still_here.ustx fem_1_ln output.ds --diffsinger --reset-timings --phoneme-override dream:0:d:jh
    """
    import uuid
    
    try:
        ustx_data = request_data.get('ustxData')
        singer_id = request_data.get('singerId', 'fem_1_ln')
        
        if not ustx_data:
            return {"success": False, "error": "Missing ustxData"}
        
        # Create temporary files for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            ustx_file = os.path.join(temp_dir, f"temp_{uuid.uuid4().hex}.ustx")
            output_ds = os.path.join(temp_dir, "output.ds")
            
            # Write USTX data to temporary file
            with open(ustx_file, 'w', encoding='utf-8') as f:
                json.dump(ustx_data, f, ensure_ascii=False, indent=2)
            
            # Get voicebank path
            voicebank_path = f"/app/openutau/{singer_id}"
            if not os.path.exists(voicebank_path):
                return {"success": False, "error": f"Voicebank {singer_id} not found at {voicebank_path}"}
            
            # Use the exact same CLI command as the working approach (generates DS file with proper phrase segmentation)
            cli_command_str = f"mkdir -p /root/.cache/OpenUtau && rm -rf /root/.cache/OpenUtau/* && /app/openutau-build/OpenUtau.Cli {ustx_file} {voicebank_path} {output_ds} --diffsinger --reset-timings --phoneme-override dream:0:d:jh"
            
            # Execute the CLI command
            print(f"Executing DiffSinger CLI: {cli_command_str}")
            result = subprocess.run(
                cli_command_str,
                shell=True,
                capture_output=True,
                text=True,
                timeout=180,
                cwd="/app/openutau"
            )
            
            print(f"CLI stdout: {result.stdout}")
            print(f"CLI stderr: {result.stderr}")
            print(f"CLI return code: {result.returncode}")
            
            if result.returncode != 0:
                return {"success": False, "error": f"CLI failed: {result.stderr}"}
            
            # Read the generated DS file to extract phrase boundaries
            if not os.path.exists(output_ds):
                return {"success": False, "error": f"DS file not generated at {output_ds}"}
            
            try:
                with open(output_ds, 'r', encoding='utf-8') as f:
                    ds_data = json.load(f)
                
                print(f"DS file contains {len(ds_data)} phrases")
                
                # Extract phrases from DS format - each DS entry is a natural phrase boundary
                phrases = []
                cumulative_note_index = 0
                
                for i, phrase_data in enumerate(ds_data):
                    if 'text' in phrase_data and phrase_data['text'].strip():
                        # Clean up the text (remove SP markers at start/end, keep internal structure)
                        raw_lyrics = phrase_data['text']
                        lyrics = raw_lyrics.replace('SP ', '').replace(' SP', '').strip()
                        
                        # Skip empty phrases
                        if not lyrics:
                            continue
                        
                        # Parse phoneme data from DS format
                        phonemes = []
                        if 'ph_seq' in phrase_data and 'ph_dur' in phrase_data:
                            ph_names = phrase_data['ph_seq'].split()
                            ph_durations = [float(d) for d in phrase_data['ph_dur'].split()]
                            
                            # Convert durations from seconds to ticks (assuming 480 ticks per quarter note, 120 BPM)
                            ticks_per_second = (480 * 120) / 60  # 960 ticks per second
                            
                            position_ticks = 0
                            note_index = cumulative_note_index
                            
                            for j, (ph_name, duration_seconds) in enumerate(zip(ph_names, ph_durations)):
                                duration_ticks = int(duration_seconds * ticks_per_second)
                                
                                phonemes.append({
                                    "phoneme": ph_name,
                                    "position": position_ticks,
                                    "duration": duration_ticks,
                                    "noteIndex": note_index
                                })
                                
                                position_ticks += duration_ticks
                                
                                # Approximate note advancement (each note roughly maps to a few phonemes)
                                if ph_name not in ['SP', 'AP'] and j % 3 == 0:
                                    note_index += 1
                        
                        # Estimate note range for this phrase
                        estimated_notes = max(1, len([p for p in phonemes if p['phoneme'] not in ['SP', 'AP']]) // 2)
                        phrase_start_note = cumulative_note_index
                        phrase_end_note = cumulative_note_index + estimated_notes - 1
                        cumulative_note_index += estimated_notes
                        
                        phrases.append({
                            "lyrics": lyrics,
                            "startNoteIndex": phrase_start_note,
                            "endNoteIndex": phrase_end_note,
                            "phonemes": phonemes
                        })
                        
                        print(f"Phrase {i+1}: '{lyrics}' ({len(phonemes)} phonemes, notes {phrase_start_note}-{phrase_end_note})")
                
                return {
                    "success": True,
                    "phrases": phrases,
                    "total_phonemes": sum(len(p['phonemes']) for p in phrases),
                    "method": "DiffSinger_DS_File_Natural_Phrases",
                    "ds_phrases_count": len(ds_data)
                }
                
            except Exception as parse_error:
                return {"success": False, "error": f"Failed to parse DS file: {str(parse_error)}"}
                
    except Exception as e:
        return {"success": False, "error": f"DS phrase extractor error: {str(e)}"}


# Debug function to see what files are available
@app.local_entrypoint()
def debug_files():
    """Debug what files are available in Modal mount"""
    import os
    
    print("🔍 Files in /app/openutau:")
    for root, dirs, files in os.walk("/app/openutau"):
        for file in files[:10]:  # Show first 10 files per directory
            if file.endswith('.ustx'):
                full_path = os.path.join(root, file)
                print(f"   📄 USTX: {full_path}")
            elif file.endswith('.json'):
                full_path = os.path.join(root, file)
                print(f"   📄 JSON: {full_path}")
        if len(files) > 10:
            print(f"   ... and {len(files) - 10} more files")
        print(f"   📁 {root}/ ({len(files)} files, {len(dirs)} dirs)")
        
        # Don't go too deep
        if root.count('/') > 4:
            dirs.clear()

# Test entrypoint to debug the phonemize issue
@app.local_entrypoint()
def test_phonemize_direct():
    """Test phonemize function with actual working USTX data"""

    # Use the working USTX file that's included in Modal mount at root level
    working_ustx_path = "/app/openutau/working_test.ustx"
    
    # Read the working USTX data
    with open(working_ustx_path, 'r') as f:
        test_ustx = json.load(f)
    
    request_data = {
        "ustxData": test_ustx,
        "singerId": "fem_1_ln"
    }
    
    print("🔤 Testing phonemize function with actual working USTX data...")
    print(f"📄 Using USTX file: {working_ustx_path}")
    print(f"📊 USTX has {len(test_ustx.get('voice_parts', []))} voice parts")
    
    result = web_phonemize.remote(request_data)
    print(f"✅ Result: {result}")

# This is the key part - you need a local entrypoint for Modal to find
@app.function(
    image=image,
    cpu=2,
    timeout=300
)
def fix_vocoder_installation():
    """
    Manually install vocoder by copying to the expected location
    """
    import subprocess
    import shutil
    from pathlib import Path
    
    print("🔧 Manually fixing vocoder installation...")
    
    # Check where OpenUtau expects vocoders to be installed
    possible_vocoder_dirs = [
        "/root/.local/share/OpenUtau/Dependencies",
        "/app/openutau/Dependencies", 
        "/app/openutau/Vocoders",
        "/root/.cache/OpenUtau/Dependencies"
    ]
    
    vocoder_file = "/app/openutau/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep"
    
    if not os.path.exists(vocoder_file):
        print(f"❌ Vocoder file not found: {vocoder_file}")
        return {"status": "error", "message": "Vocoder file not found"}
    
    print(f"✅ Found vocoder file: {vocoder_file} ({os.path.getsize(vocoder_file)} bytes)")
    
    # Create the most likely directory and copy vocoder
    target_dir = "/root/.local/share/OpenUtau/Dependencies"
    os.makedirs(target_dir, exist_ok=True)
    
    target_file = os.path.join(target_dir, "pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep")
    
    try:
        shutil.copy2(vocoder_file, target_file)
        print(f"✅ Copied vocoder to: {target_file}")
        
        # Also try extracting the .oudep file (it might be a zip)
        extract_dir = os.path.join(target_dir, "pc_nsf_hifigan_44.1k_hop512_128bin_2025.02")
        os.makedirs(extract_dir, exist_ok=True)
        
        try:
            # Try to extract as zip
            subprocess.run([
                "unzip", "-o", target_file, "-d", extract_dir
            ], check=True, capture_output=True)
            print(f"✅ Extracted vocoder to: {extract_dir}")
            
            # List contents
            if os.path.exists(extract_dir):
                contents = os.listdir(extract_dir)
                print(f"   Extracted contents: {contents}")
                
        except Exception as e:
            print(f"⚠️ Could not extract vocoder (might not be zip): {e}")
            
        return {
            "status": "success", 
            "message": "Vocoder manually installed",
            "vocoder_location": target_file,
            "extracted_location": extract_dir if os.path.exists(extract_dir) else None
        }
        
    except Exception as e:
        print(f"❌ Failed to copy vocoder: {e}")
        return {"status": "error", "message": str(e)}

@app.local_entrypoint()
def main():
    """Local entrypoint for deployment and testing"""
    print("🚀 OpenUtau Modal app with CPU-only inference deployed!")
    print("📋 Available functions:")
    print("  - setup_vocoders_and_voicebanks: One-time setup")
    print("  - fix_vocoder_installation: Manual vocoder fix")
    print("  - render_segment: DiffSinger audio synthesis (CPU-only)")  
    print("  - phonemize: Phoneme timing extraction")
    print("  - install_voicebank: Voicebank management")
    print("  - list_voicebanks: List available voices")
    print("")
    print("🔧 Next steps:")
    print("  1. Run: modal run modal_deploy.py::fix_vocoder_installation")
    print("  2. Test with render endpoint")
    print("")
    print("💡 Web endpoints:")
    print("  - web_render_segment: For Next.js /api/render-segment")
    print("  - web_phonemize: For Next.js /api/phonemize")
    print("  - ds_phonemizer: DiffSinger-style phonemization with proper phrase boundaries")


if __name__ == "__main__":
    main()