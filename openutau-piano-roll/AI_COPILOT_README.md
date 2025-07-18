# OpenUtau AI Copilot

An AI-powered lyrics editing interface for OpenUtau with DeepSeek R1 integration.

## Features

### 🎵 AI-Powered Lyrics Editing
- **Chat Interface**: Natural language editing of lyrics and musical parameters
- **Template Support**: Load pre-existing USTX files like `still_here.ustx`
- **Real-time Collaboration**: AI understands USTX format and musical structure

### 🎹 Copilot Layout
- **Split View**: Chat interface on the left, lyrics display on the right
- **Resizable Panels**: Adjust focus between chat and lyrics
- **Real-time Highlighting**: Lyrics highlight during playback
- **Interactive Notes**: Click notes to select and modify them

### 🤖 AI Capabilities
- **Lyrics Changes**: "Change the first verse to be about snow"
- **Pitch Adjustments**: "Increase the pitch of the chorus by 2 semitones"
- **Vibrato Control**: "Add more vibrato to the ending"
- **Timing Modifications**: "Make the bridge slower"
- **Template Loading**: "Load the still_here template"

## Setup Instructions

### 1. Install Dependencies
```bash
cd openutau-piano-roll
npm install
```

### 2. Configure OpenRouter API
1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Copy the environment file:
   ```bash
   cp .env.local.example .env.local
   ```
3. Edit `.env.local` and add your API key:
   ```
   OPENROUTER_API_KEY=your_actual_api_key_here
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

### 3. Start the Development Server
```bash
npm run dev
```

## Usage Guide

### Basic Workflow
1. **Load a USTX file** or select a template
2. **Toggle AI Copilot** mode in the header
3. **Chat with AI** to make changes:
   - "Change the first line to 'Hello world'"
   - "Raise the pitch of notes 5-10 by 3 semitones"
   - "Add vibrato to the chorus"
4. **Play audio** to hear changes with highlighted lyrics
5. **Export** your modified USTX file

### Chat Examples
```
User: Change the first verse to be about winter
AI: I'll modify the first verse lyrics to be about winter themes...

User: Make the chorus higher pitched
AI: I'll increase the pitch of the chorus by 2 semitones...

User: Add vibrato to the ending
AI: I'll add vibrato to the final notes with depth 40% and length 60%...
```

### Template System
- **still_here**: Emotional ballad template
- **empty**: Start from scratch
- **custom**: Upload your own USTX file

## Technical Architecture

### Components
- **ChatInterface**: AI chat with template dropdown
- **LyricsDisplay**: Real-time lyrics with highlighting
- **CopilotLayout**: Resizable split layout
- **AudioPlayer**: Enhanced with time callbacks

### APIs
- **`/api/ai-chat`**: OpenRouter integration with DeepSeek R1
- **`/api/templates/still_here`**: Template loading
- **`/api/render`**: Audio rendering (existing)

### Utilities
- **ustxUtils**: USTX parsing and modification
- **Real-time sync**: Audio playback with lyrics highlighting
- **AI Processing**: Natural language to USTX transformations

## AI Model Integration

### DeepSeek R1 Configuration
```typescript
{
  model: 'deepseek/deepseek-r1',
  temperature: 0.7,
  max_tokens: 4000,
  system_prompt: "Advanced USTX editing assistant..."
}
```

### Supported Operations
- **Lyrics modification**: Word-by-word or phrase replacement
- **Pitch adjustment**: Semitone shifts, scale adjustments
- **Timing changes**: Note duration and position
- **Vibrato control**: Length, depth, fade in/out
- **Expression editing**: Dynamics, voice color, attack/decay

## File Structure
```
src/
├── components/
│   ├── ChatInterface.tsx      # AI chat interface
│   ├── LyricsDisplay.tsx     # Real-time lyrics view
│   ├── CopilotLayout.tsx     # Split panel layout
│   ├── AudioPlayer.tsx       # Enhanced audio player
│   └── PianoRoll.tsx         # Original piano roll
├── app/
│   ├── api/
│   │   ├── ai-chat/          # OpenRouter integration
│   │   └── templates/        # Template loading
│   └── page.tsx              # Main application
├── utils/
│   └── ustxUtils.ts          # USTX manipulation
└── types/
    └── openutau.ts           # TypeScript definitions
```

## Development Notes

### Adding New Templates
1. Add USTX file to project root
2. Create API route in `src/app/api/templates/[name]/route.ts`
3. Add template to dropdown in `ChatInterface.tsx`

### Extending AI Capabilities
1. Update system prompt in `src/app/api/ai-chat/route.ts`
2. Add new utility functions in `src/utils/ustxUtils.ts`
3. Handle new commands in chat interface

### Customizing UI
- Modify `CopilotLayout.tsx` for layout changes
- Update `LyricsDisplay.tsx` for highlighting styles
- Customize chat UI in `ChatInterface.tsx`

## Troubleshooting

### Common Issues
1. **API Key Error**: Ensure OPENROUTER_API_KEY is set in `.env.local`
2. **Template Loading**: Check that USTX files are in correct format
3. **Audio Playback**: Verify render API is working properly
4. **Lyrics Highlighting**: Ensure phoneme timing data is available

### Debug Mode
Enable debug logging by adding to `.env.local`:
```
NODE_ENV=development
DEBUG=true
```

## Future Enhancements
- **Voice Analysis**: Pitch detection and correction
- **Harmony Generation**: Multi-part vocal arrangements
- **Style Transfer**: Apply vocal styles between different singers
- **Live Collaboration**: Real-time multi-user editing
- **Export Formats**: Support for other singing synthesis formats