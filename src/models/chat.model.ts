export type ChatRole = 'user' | 'model';

export interface MediaAttachment {
  dataUrl: string;
  mimeType: string;
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
  image?: MediaAttachment;
  video?: MediaAttachment;
  audio?: MediaAttachment;
  groundingChunks?: GroundingChunk[];
  isLoading?: boolean; // For streaming or long operations like video generation
  isPlayingAudio?: boolean; // For TTS
}
