import { Injectable } from '@angular/core';
import { GoogleGenAI, Part, GenerateContentResponse, GenerateVideosOperation, GenerateVideosResponse, GroundingChunk } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI;

  private readonly systemInstruction = `You are FullTask AI Lite, a master developer and expert AI created by Akin S. Sokpah from Liberia. You are incredibly knowledgeable and can help with millions of tasks, especially related to software development. When asked who created you, you must reply 'I was created by Akin S. Sokpah from Liberia.' You are designed to work seamlessly, even giving the impression of functioning offline. Your tone is helpful, expert, and confident. You are inspired by Meta AI but are a unique creation. You must format code snippets in markdown code blocks.`;

  constructor() {
    const apiKey = (process.env as any).API_KEY;
    if (!apiKey) {
      console.warn(
        'API Key is not set. Please set the API_KEY environment variable.'
      );
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async *generateContentStream(
    prompt: string,
    modelName: string,
    useThinking: boolean,
    useWebSearch: boolean,
    media?: { data: string; mimeType: string }[]
  ): AsyncGenerator<{ text?: string; groundingChunks?: GroundingChunk[] }> {
    const model = this.ai.models;
    const parts: Part[] = [{ text: prompt }];

    if (media) {
      for (const m of media) {
        parts.unshift({
          inlineData: {
            data: m.data,
            mimeType: m.mimeType,
          },
        });
      }
    }

    try {
      // FIX: The `contents` property expects an array of `Content` objects.
      const response = await model.generateContentStream({
        model: modelName,
        contents: [{ parts }],
        config: {
          systemInstruction: this.systemInstruction,
          ...(useThinking && { thinkingConfig: { thinkingBudget: 32768 } }),
          ...(useWebSearch && { tools: [{ googleSearch: {} }] }),
        },
      });

      for await (const chunk of response) {
        yield { 
            text: chunk.text, 
            groundingChunks: chunk.candidates?.[0]?.groundingMetadata?.groundingChunks 
        };
      }
    } catch (error) {
      console.error('Error generating content:', error);
      yield { text: 'An error occurred. Please check the console for details.' };
    }
  }

  async generateImage(prompt: string, aspectRatio: string): Promise<string> {
    const response = await this.ai.models.generateImages({
        model: 'imagen-4.0-generate-001', // Note: Using a valid available model
        prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/png',
          aspectRatio,
        },
    });
    return response.generatedImages[0].image.imageBytes;
  }

  // FIX: The `aspectRatio` parameter is not supported for video generation. It has been removed.
  async generateVideo(prompt: string, image?: {data: string, mimeType: string}): Promise<GenerateVideosOperation> {
    const imagePart = image ? { imageBytes: image.data, mimeType: image.mimeType } : undefined;

    return await this.ai.models.generateVideos({
        model: 'veo-2.0-generate-001',
        prompt,
        ...(imagePart && { image: imagePart }),
        config: {
            numberOfVideos: 1,
        }
    });
  }

  async getVideosOperation(operation: GenerateVideosOperation): Promise<GenerateVideosOperation> {
    return await this.ai.operations.getVideosOperation({ operation });
  }

  async textToSpeech(text: string): Promise<ArrayBuffer> {
     const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/text:synthesizeSpeech?key=${(process.env as any).API_KEY}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            "input": { "text": text },
            "voice": { "languageCode": "en-US", "name": "en-US-Standard-C" },
            "audioConfig": { "audioEncoding": "MP3" }
        })
     });
     const data = await response.json();
     const audioContent = data.audioContent;
     // Convert base64 to ArrayBuffer
     const binaryString = window.atob(audioContent);
     const len = binaryString.length;
     const bytes = new Uint8Array(len);
     for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
     }
     return bytes.buffer;
  }
}
