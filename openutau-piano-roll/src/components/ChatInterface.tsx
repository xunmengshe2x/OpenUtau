'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { USTXData } from '@/types/openutau';
import { useStreamingChat } from '@/hooks/useStreamingChat';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatInterfaceProps {
  ustxData?: USTXData;
  onUSTXUpdate?: (newData: USTXData) => void;
  onTemplateSelect?: (templateName: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  ustxData, 
  onUSTXUpdate, 
  onTemplateSelect 
}) => {
  const { messages, sendMessage, clearMessages, isLoading } = useStreamingChat(ustxData, onUSTXUpdate);
  const [inputValue, setInputValue] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const templates = [
    { id: 'still_here', name: 'Still Here', description: 'Emotional ballad template' },
    { id: 'empty', name: 'Empty Project', description: 'Start from scratch' },
    { id: 'custom', name: 'Custom Upload', description: 'Upload your own USTX file' },
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    
    const message = inputValue;
    setInputValue('');
    
    try {
      await sendMessage(message);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };


  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (onTemplateSelect) {
      onTemplateSelect(templateId);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {/* Header */}
      <motion.div 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="p-4 border-b border-gray-700 bg-gray-750"
      >
        <h2 className="text-lg font-semibold mb-3 text-white">AI Lyrics Assistant</h2>
        
        {/* Template Selection */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Template
          </label>
          <motion.select
            whileFocus={{ scale: 1.02 }}
            value={selectedTemplate}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="w-full px-3 py-2 border border-gray-600 rounded-md text-sm bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
          >
            <option value="">Select a template...</option>
            {templates.map(template => (
              <option key={template.id} value={template.id}>
                {template.name} - {template.description}
              </option>
            ))}
          </motion.select>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setInputValue('Change the first verse to be about snow')}
            className="px-3 py-1 bg-blue-600 text-blue-100 rounded-full text-xs hover:bg-blue-500 transition-colors"
          >
            Change lyrics
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setInputValue('Increase the pitch of the chorus')}
            className="px-3 py-1 bg-green-600 text-green-100 rounded-full text-xs hover:bg-green-500 transition-colors"
          >
            Adjust pitch
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setInputValue('Add more vibrato to the ending')}
            className="px-3 py-1 bg-purple-600 text-purple-100 rounded-full text-xs hover:bg-purple-500 transition-colors"
          >
            Add vibrato
          </motion.button>
        </div>
      </motion.div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence mode="popLayout">
          {messages.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center text-gray-400 py-8"
            >
              <p className="mb-2 text-white">Welcome to the AI Lyrics Assistant!</p>
              <p className="text-sm">Try asking me to:</p>
              <ul className="text-sm mt-2 space-y-1">
                <li>• Change lyrics: "Make the first verse about winter"</li>
                <li>• Adjust pitch: "Raise the chorus by 2 semitones"</li>
                <li>• Add expression: "Add vibrato to the ending"</li>
                <li>• Modify timing: "Make the bridge slower"</li>
              </ul>
            </motion.div>
          ) : (
            messages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ delay: index * 0.1 }}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className={`max-w-4xl px-6 py-4 rounded-2xl shadow-lg ${
                    message.role === 'user'
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-purple-500/20'
                      : 'bg-gray-800 text-gray-50 border border-gray-700 shadow-gray-900/30'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="space-y-3">
                      {/* Response Section */}
                      <div className="prose prose-lg prose-invert max-w-none">
                        <ReactMarkdown 
                          components={{
                            p: ({ children }) => <p className="mb-4 text-gray-100 leading-relaxed">{children}</p>,
                            h1: ({ children }) => <h1 className="text-2xl font-bold mb-4 text-white">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-xl font-semibold mb-3 text-white">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-lg font-medium mb-2 text-white">{children}</h3>,
                            ul: ({ children }) => <ul className="list-disc ml-6 mb-4 space-y-1">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal ml-6 mb-4 space-y-1">{children}</ol>,
                            li: ({ children }) => <li className="text-gray-200">{children}</li>,
                            code: ({ children, className }) => 
                              className ? (
                                <pre className="bg-gray-900 border border-gray-600 rounded-lg p-4 my-4 overflow-x-auto">
                                  <code className="text-sm text-cyan-300">{children}</code>
                                </pre>
                              ) : (
                                <code className="bg-gray-700 px-2 py-1 rounded text-cyan-300 text-sm">{children}</code>
                              ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-4 border-blue-500 pl-4 my-4 italic text-gray-300">
                                {children}
                              </blockquote>
                            ),
                            strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                            em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                        {message.isStreaming && (
                          <motion.span
                            animate={{ opacity: [1, 0.3] }}
                            transition={{ duration: 1.2, repeat: Infinity }}
                            className="inline-block w-3 h-5 bg-gradient-to-t from-cyan-400 to-blue-400 ml-2 rounded-sm"
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="prose prose-lg max-w-none">
                      <p className="text-white font-medium leading-relaxed m-0">{message.content}</p>
                    </div>
                  )}
                  <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-600/30">
                    <p className="text-xs text-gray-400 font-medium">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                    {message.role === 'assistant' && (
                      <div className="flex items-center space-x-1">
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                        <span className="text-xs text-green-400 font-medium">Kimi K2</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
        
        <AnimatePresence>
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex justify-start"
            >
              <div className="bg-gray-700 px-4 py-3 rounded-lg">
                <div className="flex items-center space-x-3">
                  <motion.div 
                    animate={{ 
                      scale: [1, 1.2, 1],
                      opacity: [0.7, 1, 0.7]
                    }}
                    transition={{ 
                      duration: 1.5, 
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="w-3 h-3 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full"
                  />
                  <motion.span
                    animate={{ 
                      opacity: [0.5, 1, 0.5]
                    }}
                    transition={{ 
                      duration: 2, 
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="text-sm text-gray-300 font-medium"
                  >
                    thinking...
                  </motion.span>
                  <motion.div 
                    animate={{ 
                      scale: [1, 1.2, 1],
                      opacity: [0.7, 1, 0.7]
                    }}
                    transition={{ 
                      duration: 1.5, 
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 0.3
                    }}
                    className="w-3 h-3 bg-gradient-to-r from-pink-400 to-purple-400 rounded-full"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="p-4 border-t border-gray-700 bg-gray-750"
      >
        <div className="flex space-x-2">
          <motion.textarea
            whileFocus={{ scale: 1.01 }}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe what you'd like to change..."
            className="flex-1 px-3 py-2 border border-gray-600 rounded-md resize-none bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            rows={2}
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-md hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Send
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};

export default ChatInterface;