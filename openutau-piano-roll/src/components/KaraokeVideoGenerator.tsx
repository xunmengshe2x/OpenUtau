'use client';

import React, { useState, useEffect } from 'react';

interface UstxFile {
  name: string;
  path: string;
}

export default function KaraokeVideoGenerator() {
  const [ustxFiles, setUstxFiles] = useState<UstxFile[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [singerId, setSingerId] = useState('');
  const [spritePath, setSpritePath] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  // Load available USTX files on component mount
  useEffect(() => {
    loadUstxFiles();
  }, []);

  const loadUstxFiles = async () => {
    try {
      const response = await fetch('/api/karaoke-video');
      const data = await response.json();
      
      if (data.ustxFiles) {
        setUstxFiles(data.ustxFiles);
        if (data.ustxFiles.length > 0) {
          setSelectedFile(data.ustxFiles[0].path);
        }
      }
    } catch (err) {
      console.error('Failed to load USTX files:', err);
      setError('Failed to load USTX files');
    }
  };

  const handleRender = async () => {
    if (!selectedFile || !singerId) {
      setError('Please select a USTX file and enter a singer ID');
      return;
    }

    setIsRendering(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/karaoke-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ustxFile: selectedFile,
          singerId,
          spritePath: spritePath || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to render karaoke video');
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">
        🎤 Karaoke Video Generator
      </h2>
      
      <div className="space-y-4">
        {/* USTX File Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select USTX File:
          </label>
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            disabled={isRendering}
          >
            <option value="">Choose a file...</option>
            {ustxFiles.map((file) => (
              <option key={file.path} value={file.path}>
                {file.name}
              </option>
            ))}
          </select>
        </div>

        {/* Singer ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Singer ID:
          </label>
          <input
            type="text"
            value={singerId}
            onChange={(e) => setSingerId(e.target.value)}
            placeholder="e.g., singer-name"
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            disabled={isRendering}
          />
        </div>

        {/* Optional Sprite Path */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Sprite Path (optional):
          </label>
          <input
            type="text"
            value={spritePath}
            onChange={(e) => setSpritePath(e.target.value)}
            placeholder="/path/to/character/sprite.png"
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            disabled={isRendering}
          />
        </div>

        {/* Render Button */}
        <button
          onClick={handleRender}
          disabled={isRendering || !selectedFile || !singerId}
          className={`w-full py-2 px-4 rounded-md text-white font-medium ${
            isRendering || !selectedFile || !singerId
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          } transition-colors`}
        >
          {isRendering ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Rendering Video...
            </span>
          ) : (
            '🎬 Generate Karaoke Video'
          )}
        </button>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Success Result */}
        {result && result.success && (
          <div className="p-4 bg-green-100 border border-green-400 text-green-700 rounded-md">
            <div className="mb-2">
              <strong>Success!</strong> {result.message}
            </div>
            
            {/* Video Player */}
            <div className="mt-4">
              <h3 className="font-medium mb-2">Generated Video:</h3>
              <video
                controls
                className="w-full max-w-md mx-auto border border-gray-300 rounded"
                src={result.videoUrl}
              >
                Your browser does not support the video tag.
              </video>
              <div className="mt-2 text-sm">
                <a
                  href={result.videoUrl}
                  download
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  Download Video
                </a>
              </div>
            </div>

            {/* Logs */}
            {result.logs && (
              <details className="mt-4">
                <summary className="cursor-pointer font-medium">View Render Logs</summary>
                <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-32">
                  {result.logs}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}