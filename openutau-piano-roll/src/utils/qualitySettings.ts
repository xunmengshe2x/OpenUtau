export interface QualitySettings {
  diffSingerDepth: number;
  diffSingerSteps: number;
  diffSingerStepsPitch: number;
  diffSingerStepsVariance: number;
  description: string;
  estimatedSpeedMultiplier: number;
}

export const QUALITY_PRESETS: Record<'preview' | 'standard' | 'high' | 'super' | 'studio', QualitySettings> = {
  preview: {
    diffSingerDepth: 0.6,
    diffSingerSteps: 10,
    diffSingerStepsPitch: 5,
    diffSingerStepsVariance: 10,
    description: 'Fast preview - Good for quick testing and iteration',
    estimatedSpeedMultiplier: 3.0 // 3x faster than standard
  },
  standard: {
    diffSingerDepth: 1.0,
    diffSingerSteps: 20,
    diffSingerStepsPitch: 10,
    diffSingerStepsVariance: 20,
    description: 'Balanced quality and speed - Default OpenUtau settings',
    estimatedSpeedMultiplier: 1.0 // Baseline
  },
  high: {
    diffSingerDepth: 1.8,
    diffSingerSteps: 80,
    diffSingerStepsPitch: 25,
    diffSingerStepsVariance: 40,
    description: 'Maximum quality - Best for final renders',
    estimatedSpeedMultiplier: 0.2 // 5x slower than standard
  },
  super: {
    diffSingerDepth: 2.5,
    diffSingerSteps: 150,
    diffSingerStepsPitch: 50,
    diffSingerStepsVariance: 80,
    description: 'Ultra quality - Professional studio-grade rendering',
    estimatedSpeedMultiplier: 0.1 // 10x slower than standard
  },
  studio: {
    diffSingerDepth: 3.5,
    diffSingerSteps: 300,
    diffSingerStepsPitch: 100,
    diffSingerStepsVariance: 150,
    description: '🎙️ Studio Master - Audiophile-grade quality for final masters',
    estimatedSpeedMultiplier: 0.05 // 20x slower than standard, but incredible quality
  }
};

export function getQualitySettings(mode: 'preview' | 'standard' | 'high' | 'super' | 'studio'): QualitySettings {
  return QUALITY_PRESETS[mode];
}

export function getQualityIcon(mode: 'preview' | 'standard' | 'high' | 'super' | 'studio'): string {
  switch (mode) {
    case 'preview': return '⚡';
    case 'standard': return '⚖️';
    case 'high': return '💎';
    case 'super': return '🚀';
    case 'studio': return '🎙️';
    default: return '⚖️';
  }
}

export function getQualityColor(mode: 'preview' | 'standard' | 'high' | 'super' | 'studio'): string {
  switch (mode) {
    case 'preview': return 'text-green-400';
    case 'standard': return 'text-blue-400';
    case 'high': return 'text-purple-400';
    case 'super': return 'text-orange-400';
    case 'studio': return 'text-pink-400';
    default: return 'text-blue-400';
  }
}