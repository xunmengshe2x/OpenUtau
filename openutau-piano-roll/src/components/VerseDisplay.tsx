'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface VerseDisplayProps {
  verseNumber: number;
  theme?: string;
  originalLyrics: string;
  newLyrics: string;
  syllablesPreserved?: boolean;
  onEditPitch?: (verseNumber: number) => void;
}

export default function VerseDisplay({
  verseNumber,
  theme,
  originalLyrics,
  newLyrics,
  syllablesPreserved
}: VerseDisplayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gray-800 border border-gray-600 rounded-lg p-4 my-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
            {verseNumber}
          </div>
          <div>
            <h4 className="text-white font-semibold">Verse {verseNumber}</h4>
            {theme && (
              <p className="text-sm text-gray-400">Theme: {theme}</p>
            )}
          </div>
        </div>
        
      </div>

      {/* Lyrics Comparison */}
      <div className="space-y-3">
        {/* Original Lyrics */}
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Original</p>
          <p className="text-gray-300 bg-gray-700 rounded p-2 text-sm italic">
            {originalLyrics}
          </p>
        </div>

        {/* New Lyrics */}
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Updated</p>
          <p className="text-white bg-green-900/30 border border-green-600/30 rounded p-2 text-sm">
            {newLyrics}
          </p>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-700">
          <div className="flex items-center space-x-2">
            {syllablesPreserved !== undefined && (
              <div className={`flex items-center space-x-1 text-xs ${
                syllablesPreserved ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {syllablesPreserved ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                )}
                <span>Syllables {syllablesPreserved ? 'preserved' : 'modified'}</span>
              </div>
            )}
          </div>
          
          <div className="text-xs text-gray-500">
            AI-driven pitch modifications available via chat
          </div>
        </div>
      </div>
    </motion.div>
  );
}