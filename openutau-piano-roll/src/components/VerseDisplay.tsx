'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface VerseDisplayProps {
  verseNumber: number;
  theme: string;
  originalLyrics: string;
  newLyrics: string;
  syllablesPreserved: boolean;
}

const VerseDisplay: React.FC<VerseDisplayProps> = ({
  verseNumber,
  theme,
  originalLyrics,
  newLyrics,
  syllablesPreserved
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 p-4 bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-lg border border-blue-500/30"
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-lg text-white">Verse {verseNumber}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-200 rounded">
            {theme}
          </span>
          {syllablesPreserved ? (
            <span className="text-xs px-2 py-1 bg-green-500/20 text-green-200 rounded">
              ✓ Syllables preserved
            </span>
          ) : (
            <span className="text-xs px-2 py-1 bg-red-500/20 text-red-200 rounded">
              ✗ Syllables changed
            </span>
          )}
        </div>
      </div>
      
      <div className="space-y-2">
        <div>
          <span className="text-xs text-gray-400 font-medium">Original:</span>
          <p className="text-sm text-gray-300 mt-1">{originalLyrics}</p>
        </div>
        <div>
          <span className="text-xs text-gray-400 font-medium">New:</span>
          <p className="text-sm text-white font-medium mt-1">{newLyrics}</p>
        </div>
      </div>
    </motion.div>
  );
};

export default VerseDisplay;