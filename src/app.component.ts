import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  model,
  viewChild,
  ElementRef,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GeminiService } from './services/gemini.service';
import { ChatMessage, MediaAttachment } from './models/chat.model';
import { MarkdownPipe } from './pipes/markdown.pipe';

type AppMode = 'chat' | 'image' | 'video';
// Re-enabling 'gemini-3-pro-preview' to match the UI and feature requirements for a "Smart" model.
type ChatModel = 'gemini-2.5-flash' | 'gemini-3-pro-preview';
type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MarkdownPipe],
})
export class AppComponent {
  private geminiService = inject(GeminiService);
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  // App State
  currentMode = signal<AppMode>('chat');
  chatHistory = signal<ChatMessage[]>([]);
  isLoading = signal<boolean>(false);
  isRecording = signal<boolean>(false);

  // Form Inputs
  userInput = model<string>('');
  uploadedFile = signal<MediaAttachment | null>(null);
  
  // Chat Mode Options
  chatModel = signal<ChatModel>('gemini-2.5-flash');
  useWebSearch = signal<boolean>(false);
  
  // Image Mode Options
  imageAspectRatio = signal<ImageAspectRatio>('1:1');
  
  // Video Mode Options

  // Element Refs
  chatContainer = viewChild<ElementRef>('chatContainer');
  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  constructor() {
    effect(() => {
      // Auto-scroll to the bottom when chat history changes
      if (this.chatContainer()) {
        const container = this.chatContainer()!.nativeElement;
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  handleEnterKey(event: KeyboardEvent): void {
    if (!event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private async fileToBase64(file: File): Promise<MediaAttachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve({
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
      reader.onerror = error => reject(error);
    });
  }
  
  private stripDataUrlPrefix(dataUrl: string): string {
    return dataUrl.substring(dataUrl.indexOf(',') + 1);
  }

  async handleFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      const file = input.files[0];
      this.uploadedFile.set(await this.fileToBase64(file));
    }
  }

  triggerFileUpload(): void {
    this.fileInput()?.nativeElement.click();
  }
  
  removeUploadedFile(): void {
    this.uploadedFile.set(null);
    if(this.fileInput()) {
        this.fileInput()!.nativeElement.value = '';
    }
  }
  
  async startRecording(): Promise<void> {
    if (this.isRecording()) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.isRecording.set(true);
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(stream);
        this.mediaRecorder.ondataavailable = event => this.audioChunks.push(event.data);
        this.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            // FIX: The fileToBase64 function expects a File object, not a Blob.
            // Create a File object from the Blob to satisfy the type requirement.
            const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
            const mediaAttachment = await this.fileToBase64(audioFile);
            
            // Transcribe audio and set it as user input
            this.isLoading.set(true);
            const prompt = 'Transcribe the following audio recording.';
            const stream = this.geminiService.generateContentStream(prompt, 'gemini-2.5-flash', false, false, [{
                data: this.stripDataUrlPrefix(mediaAttachment.dataUrl),
                mimeType: mediaAttachment.mimeType,
            }]);
            let fullResponse = '';
            for await (const chunk of stream) {
                fullResponse += chunk.text || '';
            }
            this.userInput.set(fullResponse.trim());
            this.isLoading.set(false);
            stream.return?.(); // Ensure stream is closed
        };
        this.mediaRecorder.start();
    } catch (error) {
        console.error('Error accessing microphone:', error);
        this.isRecording.set(false);
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.isRecording()) {
        this.mediaRecorder.stop();
        this.isRecording.set(false);
        // Turn off microphone tracks
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  }
  
  async playAudio(message: ChatMessage): Promise<void> {
    if (message.isPlayingAudio) return;

    this.chatHistory.update(history => history.map(m => m.id === message.id ? {...m, isPlayingAudio: true} : m));

    try {
        const audioBuffer = await this.geminiService.textToSpeech(message.text);
        const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        audio.onended = () => {
            this.chatHistory.update(history => history.map(m => m.id === message.id ? {...m, isPlayingAudio: false} : m));
            URL.revokeObjectURL(audioUrl);
        };
    } catch(e) {
        console.error('Error playing audio', e);
        this.chatHistory.update(history => history.map(m => m.id === message.id ? {...m, isPlayingAudio: false} : m));
    }
  }

  async sendMessage(): Promise<void> {
    const userMessageText = this.userInput().trim();
    if (!userMessageText && !this.uploadedFile() || this.isLoading()) {
      return;
    }

    this.isLoading.set(true);
    
    // Create and add user message to history
    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      text: userMessageText,
      image: this.uploadedFile()?.mimeType.startsWith('image/') ? this.uploadedFile()! : undefined,
      video: this.uploadedFile()?.mimeType.startsWith('video/') ? this.uploadedFile()! : undefined,
    };
    this.chatHistory.update(history => [...history, userMessage]);
    
    // Reset inputs
    this.userInput.set('');
    this.removeUploadedFile();
    
    const modelMessageId = Date.now() + 1;
    
    // Add placeholder for model response
    this.chatHistory.update(history => [...history, { id: modelMessageId, role: 'model', text: '', isLoading: true }]);

    try {
      switch (this.currentMode()) {
        case 'chat':
          await this.handleChat(userMessage, modelMessageId);
          break;
        case 'image':
          await this.handleImageGeneration(userMessage.text, modelMessageId);
          break;
        case 'video':
          await this.handleVideoGeneration(userMessage, modelMessageId);
          break;
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      this.chatHistory.update(history => history.map(msg => msg.id === modelMessageId ? {
        ...msg,
        text: "I'm sorry, I encountered an error. Please try again.",
        isLoading: false
      } : msg));
    } finally {
      this.isLoading.set(false);
    }
  }

  private async handleChat(userMessage: ChatMessage, modelMessageId: number): Promise<void> {
    const media = userMessage.image || userMessage.video;
    const stream = this.geminiService.generateContentStream(
      userMessage.text,
      this.chatModel(),
      this.chatModel() === 'gemini-3-pro-preview',
      this.useWebSearch(),
      media ? [{ data: this.stripDataUrlPrefix(media.dataUrl), mimeType: media.mimeType }] : undefined
    );

    for await (const chunk of stream) {
      this.chatHistory.update(history =>
        history.map(msg => {
          if (msg.id === modelMessageId) {
            return {
              ...msg,
              text: msg.text + (chunk.text || ''),
              groundingChunks: chunk.groundingChunks || msg.groundingChunks,
            };
          }
          return msg;
        })
      );
    }
    
    this.chatHistory.update(history => history.map(msg => msg.id === modelMessageId ? { ...msg, isLoading: false } : msg));
  }

  private async handleImageGeneration(prompt: string, modelMessageId: number): Promise<void> {
      const base64Image = await this.geminiService.generateImage(prompt, this.imageAspectRatio());
      const image: MediaAttachment = {
        dataUrl: `data:image/png;base64,${base64Image}`,
        mimeType: 'image/png'
      };
      this.chatHistory.update(history => history.map(msg => msg.id === modelMessageId ? {
        ...msg,
        text: `Here is the generated image for: "${prompt}"`,
        image,
        isLoading: false
      } : msg));
  }

  private async handleVideoGeneration(userMessage: ChatMessage, modelMessageId: number): Promise<void> {
      const imageAttachment = userMessage.image ? {
          data: this.stripDataUrlPrefix(userMessage.image.dataUrl),
          mimeType: userMessage.image.mimeType
      } : undefined;
      
      let operation = await this.geminiService.generateVideo(userMessage.text, imageAttachment);
      
      this.chatHistory.update(history => history.map(msg => msg.id === modelMessageId ? { ...msg, text: '📹 Video generation started... This might take a few minutes.' } : msg));

      while (!operation.done) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          operation = await this.geminiService.getVideosOperation(operation);
          this.chatHistory.update(history => history.map(msg => msg.id === modelMessageId ? { ...msg, text: `📹 Video generation in progress... Status: ${operation.metadata?.state || 'processing'}` } : msg));
      }
      
      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (videoUri) {
          const videoUrl = `${videoUri}&key=${(process.env as any).API_KEY}`;
           const response = await fetch(videoUrl);
           const blob = await response.blob();
           const dataUrl = await this.fileToBase64(new File([blob], "video.mp4", {type: "video/mp4"}));

          this.chatHistory.update(history => history.map(msg => msg.id === modelMessageId ? {
            ...msg,
            text: `Here is the generated video for: "${userMessage.text}"`,
            video: dataUrl,
            isLoading: false
          } : msg));
      } else {
          this.chatHistory.update(history => history.map(msg => msg.id === modelMessageId ? { ...msg, text: 'Sorry, video generation failed.', isLoading: false } : msg));
      }
  }

  startNewChat(prompt: string): void {
      this.currentMode.set('chat');
      this.userInput.set(prompt);
      this.sendMessage();
  }
}
