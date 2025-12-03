import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  viewChild,
  ElementRef,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GeminiService } from './services/gemini.service';
import { ChatMessage, MediaAttachment, GroundingChunk } from './models/chat.model';
import { MarkdownPipe } from './pipes/markdown.pipe';

type AppMode = 'chat' | 'image' | 'video';
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
  private readonly storageKey = 'fulltask_ai_lite_history';

  // App State
  currentMode = signal<AppMode>('chat');
  chatHistory = signal<ChatMessage[]>([]);
  isLoading = signal<boolean>(false);
  isRecording = signal<boolean>(false);
  micError = signal<string | null>(null);

  // Form Inputs
  userInput = signal<string>('');
  uploadedFile = signal<MediaAttachment | null>(null);
  
  // Chat Mode Options
  chatModel = signal<ChatModel>('gemini-2.5-flash');
  useWebSearch = signal<boolean>(false);
  
  // Image Mode Options
  imageAspectRatio = signal<ImageAspectRatio>('1:1');

  // Element Refs
  chatContainer = viewChild<ElementRef>('chatContainer');
  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  constructor() {
    this.loadChatHistory();

    effect(() => {
      // Auto-scroll to the bottom when chat history changes
      if (this.chatContainer()) {
        const container = this.chatContainer()!.nativeElement;
        container.scrollTop = container.scrollHeight;
      }
    });

    effect(() => {
      this.saveChatHistory();
    });
  }
  
  private saveChatHistory(): void {
    try {
      const historyToSave = this.chatHistory().map(msg => ({
        role: msg.role,
        text: msg.text,
        groundingChunks: msg.groundingChunks
      }));
      localStorage.setItem(this.storageKey, JSON.stringify(historyToSave));
    } catch (e) {
      console.error("Failed to save chat history:", e);
    }
  }

  private loadChatHistory(): void {
    try {
      const savedHistory = localStorage.getItem(this.storageKey);
      if (savedHistory) {
        const parsedHistory: Omit<ChatMessage, 'id'>[] = JSON.parse(savedHistory);
        const historyWithIds = parsedHistory.map((msg, index) => ({
            ...msg,
            id: Date.now() + index,
            isLoading: false,
            isPlayingAudio: false
        }));
        this.chatHistory.set(historyWithIds);
      }
    } catch (e) {
      console.error("Failed to load or parse chat history:", e);
      localStorage.removeItem(this.storageKey);
    }
  }

  startNewConversation(): void {
      this.chatHistory.set([]);
      this.userInput.set('');
      this.uploadedFile.set(null);
      localStorage.removeItem(this.storageKey);
  }
  
  startNewChat(prompt: string): void {
    this.startNewConversation();
    this.userInput.set(prompt);
    // Use a microtask to ensure the input value updates in the DOM before sending.
    Promise.resolve().then(() => this.sendMessage());
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
    this.micError.set(null);
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.isRecording.set(true);
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(stream);
        this.mediaRecorder.ondataavailable = event => this.audioChunks.push(event.data);
        this.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
            const mediaAttachment = await this.fileToBase64(audioFile);
            
            this.isLoading.set(true);
            const prompt = 'Transcribe the following audio recording.';
            const streamGen = this.geminiService.generateContentStream(prompt, 'gemini-2.5-flash', false, [{
                data: this.stripDataUrlPrefix(mediaAttachment.dataUrl),
                mimeType: mediaAttachment.mimeType,
            }]);
            let fullResponse = '';
            for await (const chunk of streamGen) {
                fullResponse += chunk.text || '';
            }
            this.userInput.set(fullResponse.trim());
            this.isLoading.set(false);
        };
        this.mediaRecorder.start();
    } catch (error: any) {
        console.error('Error accessing microphone:', error);
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
             this.micError.set('Microphone permission denied. Please allow access in your browser settings.');
        } else {
            this.micError.set('Could not access the microphone. Please ensure it is connected and enabled.');
        }
        this.isRecording.set(false);
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.isRecording()) {
        this.mediaRecorder.stop();
        this.isRecording.set(false);
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
    if ((!userMessageText && !this.uploadedFile()) || this.isLoading()) {
      return;
    }

    this.isLoading.set(true);

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      text: userMessageText,
      image: this.uploadedFile()?.mimeType.startsWith('image/') ? this.uploadedFile()! : undefined,
      video: this.uploadedFile()?.mimeType.startsWith('video/') ? this.uploadedFile()! : undefined,
      audio: this.uploadedFile()?.mimeType.startsWith('audio/') ? this.uploadedFile()! : undefined,
    };

    this.chatHistory.update(history => [...history, userMessage]);
    this.userInput.set('');

    // Dispatch to the correct handler based on the current mode
    switch (this.currentMode()) {
      case 'chat':
        await this.handleChat(userMessage);
        break;
      case 'image':
        await this.handleImageGeneration(userMessage);
        break;
      case 'video':
        await this.handleVideoGeneration(userMessage);
        break;
    }

    this.removeUploadedFile(); // Clear file after sending
    this.isLoading.set(false);
  }

  private async handleChat(userMessage: ChatMessage): Promise<void> {
    const modelResponseId = Date.now() + 1;
    this.chatHistory.update(history => [...history, {
      id: modelResponseId,
      role: 'model',
      text: '',
      isLoading: true
    }]);

    const media = userMessage.image || userMessage.video || userMessage.audio;
    const mediaParts = media ? [{
      data: this.stripDataUrlPrefix(media.dataUrl),
      mimeType: media.mimeType,
    }] : undefined;

    const stream = this.geminiService.generateContentStream(
      userMessage.text,
      this.chatModel(),
      this.useWebSearch(),
      mediaParts
    );

    let fullText = '';
    let groundingChunks: GroundingChunk[] = [];
    for await (const chunk of stream) {
      fullText += chunk.text || '';
      if (chunk.groundingChunks) {
        groundingChunks.push(...chunk.groundingChunks);
      }
      this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? { ...m, text: fullText, groundingChunks } : m));
    }

    this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? { ...m, isLoading: false } : m));
  }

  private async handleImageGeneration(userMessage: ChatMessage): Promise<void> {
    const modelResponseId = Date.now() + 1;
    this.chatHistory.update(history => [...history, {
      id: modelResponseId,
      role: 'model',
      text: `Generating an image for: "${userMessage.text}"`,
      isLoading: true
    }]);

    try {
      const imageBytes = await this.geminiService.generateImage(userMessage.text, this.imageAspectRatio());
      const dataUrl = `data:image/png;base64,${imageBytes}`;
      const imageAttachment: MediaAttachment = { dataUrl, mimeType: 'image/png' };

      this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? {
        ...m,
        text: '',
        image: imageAttachment,
        isLoading: false
      } : m));
    } catch (e) {
      console.error("Image generation failed:", e);
      this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? {
        ...m,
        text: 'Sorry, I was unable to generate the image. Please try again.',
        isLoading: false
      } : m));
    }
  }

  private async handleVideoGeneration(userMessage: ChatMessage): Promise<void> {
    const modelResponseId = Date.now() + 1;
    this.chatHistory.update(history => [...history, {
      id: modelResponseId,
      role: 'model',
      text: '🎬 Starting video generation... This may take a few minutes.',
      isLoading: true
    }]);

    try {
      const image = userMessage.image ? {
        data: this.stripDataUrlPrefix(userMessage.image.dataUrl),
        mimeType: userMessage.image.mimeType
      } : this.uploadedFile()?.mimeType.startsWith('image/') ? {
        data: this.stripDataUrlPrefix(this.uploadedFile()!.dataUrl),
        mimeType: this.uploadedFile()!.mimeType
      } : undefined;

      let operation = await this.geminiService.generateVideo(userMessage.text, image);

      this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? { ...m, text: '🤖 Processing video request... The AI is thinking.' } : m));

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10 seconds
        operation = await this.geminiService.getVideosOperation(operation);
      }

      const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (uri) {
        this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? { ...m, text: '✅ Video processed! Downloading...' } : m));
        const dataUrl = await this.geminiService.fetchVideoAsDataUrl(uri);
        const videoAttachment: MediaAttachment = { dataUrl, mimeType: 'video/mp4' };
        this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? {
          ...m,
          text: '',
          video: videoAttachment,
          isLoading: false
        } : m));
      } else {
        throw new Error("Video generation completed, but no URI was returned.");
      }
    } catch (e) {
      console.error("Video generation failed:", e);
      this.chatHistory.update(history => history.map(m => m.id === modelResponseId ? {
        ...m,
        text: 'Sorry, I was unable to generate the video. Please try again or check the console.',
        isLoading: false
      } : m));
    }
  }
}
