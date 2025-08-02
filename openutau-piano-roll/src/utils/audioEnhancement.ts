export interface AudioEnhancementSettings {
  // Core DiffSinger quality
  useStudioQuality: boolean;
  
  // Audio post-processing
  enableNormalization: boolean;
  enableNoiseReduction: boolean;
  enableReverb: boolean;
  enableCompressor: boolean;
  
  // Advanced settings
  sampleRate: 44100 | 48000 | 96000;
  bitDepth: 16 | 24 | 32;
  
  // Enhancement presets
  preset: 'natural' | 'professional' | 'broadcast' | 'audiophile';
}

export const ENHANCEMENT_PRESETS: Record<string, AudioEnhancementSettings> = {
  natural: {
    useStudioQuality: false,
    enableNormalization: true,
    enableNoiseReduction: false,
    enableReverb: false,
    enableCompressor: false,
    sampleRate: 44100,
    bitDepth: 16,
    preset: 'natural'
  },
  professional: {
    useStudioQuality: true,
    enableNormalization: true,
    enableNoiseReduction: true,
    enableReverb: true,
    enableCompressor: true,
    sampleRate: 48000,
    bitDepth: 24,
    preset: 'professional'
  },
  broadcast: {
    useStudioQuality: true,
    enableNormalization: true,
    enableNoiseReduction: true,
    enableReverb: false,
    enableCompressor: true,
    sampleRate: 48000,
    bitDepth: 24,
    preset: 'broadcast'
  },
  audiophile: {
    useStudioQuality: true,
    enableNormalization: false, // Preserve dynamic range
    enableNoiseReduction: true,
    enableReverb: true,
    enableCompressor: false, // Preserve dynamics
    sampleRate: 96000,
    bitDepth: 32,
    preset: 'audiophile'
  }
};

/**
 * Generate FFmpeg command for audio enhancement
 */
export function generateAudioEnhancementCommand(
  inputPath: string,
  outputPath: string,
  settings: AudioEnhancementSettings
): string {
  const filters: string[] = [];
  
  // Noise reduction (using afftdn filter)
  if (settings.enableNoiseReduction) {
    filters.push('afftdn=nf=-25:nt=w'); // Reduce noise by 25dB
  }
  
  // Compressor for vocal consistency
  if (settings.enableCompressor) {
    filters.push('acompressor=threshold=0.5:ratio=3:attack=5:release=50'); // Gentle compression
  }
  
  // Reverb for natural sound
  if (settings.enableReverb) {
    filters.push('aecho=0.8:0.88:60:0.4'); // Subtle room reverb
  }
  
  // Normalization (should be last)
  if (settings.enableNormalization) {
    filters.push('dynaudnorm=p=0.95:m=10:s=12'); // Dynamic range normalization
  }
  
  // Build FFmpeg command
  let command = `ffmpeg -i "${inputPath}"`;
  
  // Apply filters if any
  if (filters.length > 0) {
    command += ` -af "${filters.join(',')}"`;
  }
  
  // Set audio format
  command += ` -ar ${settings.sampleRate} -sample_fmt s${settings.bitDepth}`;
  
  // Output
  command += ` "${outputPath}" -y`;
  
  return command;
}

/**
 * Get quality recommendations for better audio
 */
export function getQualityRecommendations(): {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  timeImpact: string;
}[] {
  return [
    {
      title: '🎙️ Use Studio Quality Mode',
      description: 'Switch to Studio quality for audiophile-grade rendering with 300 diffusion steps',
      impact: 'high',
      timeImpact: '20x slower but incredible quality'
    },
    {
      title: '🔧 Enable Audio Post-Processing',
      description: 'Add noise reduction, normalization, and subtle reverb for professional sound',
      impact: 'high',
      timeImpact: '+5-10 seconds per render'
    },
    {
      title: '📈 Increase Sample Rate',
      description: 'Use 48kHz or 96kHz instead of 44.1kHz for better frequency response',
      impact: 'medium',
      timeImpact: 'Minimal impact'
    },
    {
      title: '💾 Higher Bit Depth',
      description: 'Use 24-bit or 32-bit audio for better dynamic range and less quantization noise',
      impact: 'medium',
      timeImpact: 'No impact on render time'
    },
    {
      title: '🎚️ Professional Preset',
      description: 'Use the "Professional" preset which combines all quality improvements',
      impact: 'high',
      timeImpact: '20x render time but studio quality'
    }
  ];
}

/**
 * Estimate quality improvement impact
 */
export function estimateQualityImprovement(
  currentSettings: AudioEnhancementSettings,
  newSettings: AudioEnhancementSettings
): {
  qualityGain: number; // 0-100%
  timeMultiplier: number; // How much slower
  description: string;
} {
  let qualityGain = 0;
  let timeMultiplier = 1;
  let improvements: string[] = [];
  
  // Studio quality impact
  if (!currentSettings.useStudioQuality && newSettings.useStudioQuality) {
    qualityGain += 40;
    timeMultiplier *= 20;
    improvements.push('Studio-grade DiffSinger quality');
  }
  
  // Post-processing impacts
  if (!currentSettings.enableNoiseReduction && newSettings.enableNoiseReduction) {
    qualityGain += 15;
    timeMultiplier *= 1.1;
    improvements.push('Noise reduction');
  }
  
  if (!currentSettings.enableNormalization && newSettings.enableNormalization) {
    qualityGain += 10;
    timeMultiplier *= 1.05;
    improvements.push('Audio normalization');
  }
  
  if (!currentSettings.enableReverb && newSettings.enableReverb) {
    qualityGain += 8;
    timeMultiplier *= 1.02;
    improvements.push('Natural reverb');
  }
  
  if (!currentSettings.enableCompressor && newSettings.enableCompressor) {
    qualityGain += 12;
    timeMultiplier *= 1.03;
    improvements.push('Vocal compression');
  }
  
  // Sample rate improvements
  if (currentSettings.sampleRate < newSettings.sampleRate) {
    qualityGain += 8;
    improvements.push(`Higher sample rate (${newSettings.sampleRate}Hz)`);
  }
  
  // Bit depth improvements
  if (currentSettings.bitDepth < newSettings.bitDepth) {
    qualityGain += 5;
    improvements.push(`Higher bit depth (${newSettings.bitDepth}-bit)`);
  }
  
  return {
    qualityGain: Math.min(100, qualityGain),
    timeMultiplier,
    description: improvements.length > 0 
      ? `Improvements: ${improvements.join(', ')}` 
      : 'No significant improvements'
  };
}