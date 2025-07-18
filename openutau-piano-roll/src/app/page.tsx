'use client';

import React, { useState } from 'react';
import PianoRoll from '@/components/PianoRoll';
import AudioPlayer from '@/components/AudioPlayer';
import { USTXData, PhonemeTiming } from '@/types/openutau';
import yaml from 'js-yaml';

export default function Home() {
  const [ustxData, setUstxData] = useState<USTXData | null>(null);
  const [phonemeData, setPhonemeData] = useState<PhonemeTiming[] | null>(null);
  const [selectedNote, setSelectedNote] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [status, setStatus] = useState<string>('Load a USTX file to begin');
  const [singerId, setSingerId] = useState<string>('fem_1_ln');

  const handleUSTXFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus('Loading USTX file...');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsedData = yaml.load(content) as USTXData;
        setUstxData(parsedData);
        setStatus('USTX file loaded successfully');
      } catch (error) {
        console.error('Error parsing USTX file:', error);
        setStatus('Error parsing USTX file: ' + (error as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const handlePhonemeFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus('Loading phoneme data...');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsedData = JSON.parse(content) as PhonemeTiming[];
        setPhonemeData(parsedData);
        setStatus('Phoneme data loaded successfully');
      } catch (error) {
        console.error('Error parsing phoneme file:', error);
        setStatus('Error parsing phoneme file: ' + (error as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const handleNoteSelect = (note: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    setSelectedNote(note);
  };

  const handleNoteEdit = (note: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log('Edit note:', note);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">OpenUtau Piano Roll</h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Singer:</label>
              <input
                type="text"
                value={singerId}
                onChange={(e) => setSingerId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm w-32"
                placeholder="Singer ID"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="file"
                accept=".ustx"
                onChange={handleUSTXFileUpload}
                className="hidden"
                id="ustx-upload"
              />
              <label
                htmlFor="ustx-upload"
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 cursor-pointer"
              >
                Load USTX
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="file"
                accept=".json"
                onChange={handlePhonemeFileUpload}
                className="hidden"
                id="phoneme-upload"
              />
              <label
                htmlFor="phoneme-upload"
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 cursor-pointer"
              >
                Load Phonemes
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => window.open('/copilot', '_blank')}
                className="px-4 py-2 rounded transition-all duration-200 bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg"
              >
                🤖 Open AI Copilot
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 text-sm text-gray-600">
          Status: {status}
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-white shadow-sm border-r p-4">
          <h2 className="text-lg font-semibold mb-4">Project Info</h2>
          {ustxData ? (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Name:</span> {ustxData.name}
              </div>
              <div>
                <span className="font-medium">Resolution:</span> {ustxData.resolution} ticks/beat
              </div>
              <div>
                <span className="font-medium">BPM:</span> {ustxData.bpm}
              </div>
              <div>
                <span className="font-medium">Tracks:</span> {ustxData.tracks?.length || 0}
              </div>
              <div>
                <span className="font-medium">Parts:</span> {ustxData.voice_parts?.length || 0}
              </div>
              <div>
                <span className="font-medium">Total Notes:</span> {
                  ustxData.voice_parts?.reduce((sum, part) => sum + (part.notes?.length || 0), 0) || 0
                }
              </div>
            </div>
          ) : (
            <div className="text-gray-500">No project loaded</div>
          )}

          {selectedNote && (
            <div className="mt-6">
              <h3 className="text-md font-semibold mb-2">Selected Note</h3>
              <div className="space-y-1 text-sm">
                <div><span className="font-medium">Lyric:</span> {selectedNote.lyric}</div>
                <div><span className="font-medium">MIDI:</span> {selectedNote.pitch}</div>
                <div><span className="font-medium">Position:</span> {selectedNote.ustxNote?.position || 0}</div>
                <div><span className="font-medium">Duration:</span> {selectedNote.ustxNote?.duration || 0}</div>
              </div>
            </div>
          )}

          {phonemeData && (
            <div className="mt-6">
              <h3 className="text-md font-semibold mb-2">Phoneme Data</h3>
              <div className="text-sm text-gray-600">
                <div>Total phonemes: {phonemeData.length}</div>
                <div>Parts: {[...new Set(phonemeData.map(p => p.PartName))].join(', ')}</div>
              </div>
            </div>
          )}

          <div className="mt-6">
            <h3 className="text-md font-semibold mb-2">Instructions</h3>
            <div className="space-y-2 text-sm text-gray-600">
              <div>1. Load a USTX file to see notes</div>
              <div>2. Set singer ID (e.g., "default" or voicebank name)</div>
              <div>3. Click Play to render and play audio</div>
              <div>4. Click and drag notes to move them</div>
              <div>5. View pitch curves and phonemes</div>
              <div>6. <strong>Open AI Copilot</strong> for lyrics editing</div>
            </div>
          </div>
        </div>

        {/* Piano Roll */}
        <div className="flex-1 bg-gray-50">
          <PianoRoll
            ustxData={ustxData || undefined}
            phonemeData={phonemeData || undefined}
            onNoteSelect={handleNoteSelect}
            onNoteEdit={handleNoteEdit}
          />
        </div>
      </div>
      
      {/* Audio Player */}
      <AudioPlayer
        ustxData={ustxData || undefined}
        singerId={singerId}
      />
    </div>
  );
}