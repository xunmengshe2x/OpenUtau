'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ChatInterface from './ChatInterface';
import LyricsDisplay from './LyricsDisplay';
import { USTXData, USTXNote, PhonemeTiming, DetailedPhonemeTiming } from '@/types/openutau';
import { usePhonemeProcessing } from '@/hooks/usePhonemeProcessing';

interface CopilotLayoutProps {
  ustxData?: USTXData;
  phonemeData?: PhonemeTiming[];
  currentTime: number;
  isPlaying: boolean;
  onUSTXUpdate?: (newData: USTXData) => void;
  onNoteSelect?: (note: USTXNote) => void;
  onTemplateSelect?: (templateName: string) => void;
  singerId?: string; // Add singer ID for phoneme processing
}

const CopilotLayout: React.FC<CopilotLayoutProps> = ({
  ustxData,
  phonemeData,
  currentTime,
  isPlaying,
  onUSTXUpdate,
  onNoteSelect,
  onTemplateSelect,
  singerId
}) => {
  const [leftPanelWidth, setLeftPanelWidth] = useState(50); // Percentage
  const [isDragging, setIsDragging] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'lyrics'>('chat');
  
  // Initialize phoneme processing hook
  const { phonemeData: processedPhonemes, isProcessing, processUSTX, error } = usePhonemeProcessing();

  // Auto-enable copilot mode when USTX data is loaded
  useEffect(() => {
    if (ustxData) {
      setShowCopilot(true);
    }
  }, [ustxData]);

  // Process phonemes when USTX data is loaded
  useEffect(() => {
    console.log('PHONEME PROCESSING CHECK:', {
      hasUstxData: !!ustxData,
      singerId,
      hasProcessedPhonemes: !!processedPhonemes,
      isProcessing,
      error
    });
    
    if (ustxData && !processedPhonemes && !isProcessing) {
      console.log('Processing phonemes for USTX data...');
      processUSTX(ustxData, 'default'); // Use default since we don't need singer-specific processing
    }
  }, [ustxData, singerId, processedPhonemes, processUSTX]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    
    const containerRect = (e.target as HTMLElement).closest('.copilot-container')?.getBoundingClientRect();
    if (!containerRect) return;
    
    const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    setLeftPanelWidth(Math.max(20, Math.min(80, newWidth)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  const handleTemplateSelect = async (templateName: string) => {
    if (onTemplateSelect) {
      onTemplateSelect(templateName);
    }

    // Load template data
    if (templateName === 'still_here') {
      try {
        const response = await fetch('/api/templates/still_here');
        if (response.ok) {
          const templateData = await response.json();
          if (onUSTXUpdate) {
            onUSTXUpdate(templateData);
          }
        }
      } catch (error) {
        console.error('Error loading template:', error);
      }
    }
  };

  if (!showCopilot) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-center h-full bg-gray-900"
      >
        <div className="text-center">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
          >
            <h2 className="text-3xl font-bold text-white mb-4">AI Copilot Mode</h2>
            <p className="text-gray-300 mb-6">
              Load a USTX file or select a template to start using the AI assistant
            </p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowCopilot(true)}
              className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all duration-200 shadow-lg"
            >
              Enable Copilot
            </motion.button>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="copilot-container flex h-full bg-gray-900 relative"
    >
      {/* Left Panel - Chat Interface */}
      <motion.div 
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="bg-gray-800 border-r border-gray-700 flex flex-col"
        style={{ width: `${leftPanelWidth}%` }}
      >
        <div className="flex items-center justify-between p-3 border-b border-gray-700 bg-gray-750">
          <h3 className="font-semibold text-white">AI Assistant</h3>
          <div className="flex items-center space-x-2">
            <motion.div 
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-2 h-2 bg-green-500 rounded-full"
            />
            <span className="text-xs text-gray-300">Online</span>
          </div>
        </div>
        
        <div className="flex-1 min-h-0">
          <ChatInterface
            ustxData={ustxData}
            onUSTXUpdate={onUSTXUpdate}
            onTemplateSelect={handleTemplateSelect}
          />
        </div>
      </motion.div>

      {/* Resize Handle */}
      <motion.div
        whileHover={{ scale: 1.1 }}
        className="w-1 bg-gray-700 hover:bg-purple-500 cursor-col-resize flex items-center justify-center relative group transition-colors duration-200"
        onMouseDown={handleMouseDown}
      >
        <motion.div 
          whileHover={{ scale: 1.2 }}
          className="w-1 h-8 bg-purple-500 rounded-full group-hover:bg-purple-400 transition-colors"
        />
      </motion.div>

      {/* Right Panel - Lyrics Display */}
      <motion.div 
        initial={{ x: 20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="bg-gray-800 flex flex-col"
        style={{ width: `${100 - leftPanelWidth}%` }}
      >
        <div className="flex items-center justify-between p-3 border-b border-gray-700 bg-gray-750">
          <h3 className="font-semibold text-white">Lyrics View</h3>
          <div className="flex items-center space-x-2">
            <AnimatePresence>
              {isPlaying && (
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0 }}
                  className="flex items-center space-x-2"
                >
                  <motion.div 
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-2 h-2 bg-red-500 rounded-full"
                  />
                  <span className="text-xs text-gray-300">Playing</span>
                </motion.div>
              )}
            </AnimatePresence>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowCopilot(false)}
              className="text-gray-400 hover:text-white p-1 transition-colors"
              title="Exit Copilot Mode"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </motion.button>
          </div>
        </div>
        
        <div className="flex-1 min-h-0">
          {/* Show phoneme processing status */}
          {isProcessing && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-blue-900 text-white p-3 text-sm flex items-center space-x-2"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              />
              <span>Processing phonemes for accurate phrase detection...</span>
            </motion.div>
          )}
          
          {/* Show phoneme processing error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-900 text-white p-3 text-sm"
            >
              Phoneme processing failed: {error}
            </motion.div>
          )}
          
          <LyricsDisplay
            ustxData={ustxData}
            phonemeData={(() => {
              const data = processedPhonemes || phonemeData;
              console.log('COPILOT LAYOUT: Passing phoneme data to LyricsDisplay:', {
                hasProcessedPhonemes: !!processedPhonemes,
                hasPhonemeData: !!phonemeData,
                finalData: !!data,
                processingError: error,
                isProcessing: isProcessing
              });
              return data;
            })()}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onNoteClick={onNoteSelect}
          />
        </div>
      </motion.div>

      {/* Floating Controls */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-2 bg-gray-800 rounded-lg shadow-2xl p-2 border border-gray-700"
      >
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setLeftPanelWidth(50)}
          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          title="Reset panel sizes"
        >
          Reset
        </motion.button>
        
        <div className="w-px h-6 bg-gray-600"></div>
        
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setLeftPanelWidth(leftPanelWidth > 50 ? 30 : 70)}
          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          title="Toggle panel focus"
        >
          {leftPanelWidth > 50 ? 'Focus Lyrics' : 'Focus Chat'}
        </motion.button>
      </motion.div>

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black bg-opacity-20 cursor-col-resize z-10"
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default CopilotLayout;