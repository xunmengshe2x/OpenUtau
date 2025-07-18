'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { getQualitySettings, getQualityIcon, getQualityColor } from '@/utils/qualitySettings';

interface QualityModeIndicatorProps {
  mode: 'preview' | 'standard' | 'high' | 'super';
  className?: string;
}

const QualityModeIndicator: React.FC<QualityModeIndicatorProps> = ({ mode, className = '' }) => {
  const settings = getQualitySettings(mode);
  const icon = getQualityIcon(mode);
  const colorClass = getQualityColor(mode);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex items-center space-x-2 ${className}`}
    >
      <span className="text-lg">{icon}</span>
      <div className="flex flex-col">
        <span className={`text-sm font-medium ${colorClass}`}>
          {mode.charAt(0).toUpperCase() + mode.slice(1)} Quality
        </span>
        <span className="text-xs text-gray-400">
          ~{settings.estimatedSpeedMultiplier}x speed
        </span>
      </div>
    </motion.div>
  );
};

export default QualityModeIndicator;