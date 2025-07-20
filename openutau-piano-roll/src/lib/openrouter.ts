// Server-side OpenRouter utilities
// This file is now only used server-side to avoid exposing API keys

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamResponse {
  content: string;
}