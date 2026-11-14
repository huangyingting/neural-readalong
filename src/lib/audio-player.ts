import { KOKORO_SAMPLE_RATE } from "@/lib/kokoro";
import { findActiveWordInChunk } from "@/lib/word-timestamps";
import type {
  ChunkAlignment,
  PlaybackHighlightState,
  WorkerRequestMessage,
} from "@/types/tts";

/**
 * Small perceptual lead (in ms) compensating for 1–1.5 display frames of
 * compositor/scanout latency so visual highlight snaps simultaneously with speech.
 */
const VISUAL_LEAD_MS = 25;

interface ScheduledAudioItem {
  source: AudioBufferSourceNode;
  chunk: ChunkAlignment;
  startContextTime: number;
  endContextTime: number;
}

export interface AudioPlayerCallbacks {
  onHighlightChange?: (state: PlaybackHighlightState) => void;
  onTimeUpdate?: (currentTimeMs: number) => void;
  onProgress?: (percent: number, message: string) => void;
  onPlaybackComplete?: () => void;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private scheduledItems: ScheduledAudioItem[] = [];
  private enqueueChain: Promise<void> = Promise.resolve();
  private nextStartTime = 0;
  private sessionId = 0;
  private isPlaying = false;
  private generationComplete = false;
  private stopped = false;
  private worker: Worker | null;
  private totalAudioChunks = 0;
  private processedAudioChunks = 0;
  private rafId: number | null = null;
  private lastEmittedKey = "";
  private callbacks: AudioPlayerCallbacks;

  constructor(worker: Worker | null, callbacks: AudioPlayerCallbacks = {}) {
    this.worker = worker;
    this.callbacks = callbacks;
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext({
        sampleRate: KOKORO_SAMPLE_RATE,
        latencyHint: "interactive",
      });
    }
    return this.audioContext;
  }

  setWorker(worker: Worker | null): void {
    this.worker = worker;
  }

  setCallbacks(callbacks: AudioPlayerCallbacks): void {
    this.callbacks = callbacks;
  }

  startSession(totalChunks = 1): void {
    this.stopScheduledSources();
    this.sessionId++;
    this.stopped = false;
    this.generationComplete = false;
    this.isPlaying = false;
    this.totalAudioChunks = Math.max(1, totalChunks);
    this.processedAudioChunks = 0;
    this.nextStartTime = 0;
    this.lastEmittedKey = "";
    this.enqueueChain = Promise.resolve();

    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }

  setTotalChunks(totalChunks: number): void {
    this.totalAudioChunks = Math.max(1, totalChunks);
  }

  markGenerationComplete(): void {
    const session = this.sessionId;
    this.enqueueChain = this.enqueueChain.then(() => {
      if (this.stopped || session !== this.sessionId) return;
      this.generationComplete = true;
      this.checkPlaybackComplete();
    });
  }

  queueAudio(
    audioData: ArrayBuffer,
    chunk: ChunkAlignment,
    sampleRate = KOKORO_SAMPLE_RATE,
  ): Promise<void> {
    const session = this.sessionId;
    const task = this.enqueueChain.then(async () => {
      if (this.stopped || session !== this.sessionId) return;

      const samples = new Float32Array(audioData);
      if (samples.length === 0) {
        this.processedAudioChunks++;
        this.postToWorker({ type: "buffer_processed" });
        this.checkPlaybackComplete();
        return;
      }

      const ctx = this.ensureContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      if (this.stopped || session !== this.sessionId) return;

      const audioBuffer = ctx.createBuffer(1, samples.length, sampleRate);
      audioBuffer.getChannelData(0).set(samples);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      // Schedule gaplessly right after the last scheduled buffer (or immediately if queue was empty)
      const startContextTime = Math.max(
        ctx.currentTime + 0.005,
        this.nextStartTime,
      );
      const endContextTime = startContextTime + audioBuffer.duration;
      this.nextStartTime = endContextTime;

      const scheduledItem: ScheduledAudioItem = {
        source,
        chunk,
        startContextTime,
        endContextTime,
      };
      this.scheduledItems.push(scheduledItem);
      this.isPlaying = true;

      source.onended = () => {
        const idx = this.scheduledItems.indexOf(scheduledItem);
        if (idx !== -1) {
          this.scheduledItems.splice(idx, 1);
        }
        if (this.stopped || session !== this.sessionId) return;

        this.processedAudioChunks++;
        const percent = Math.min(
          (this.processedAudioChunks / Math.max(1, this.totalAudioChunks)) *
            100,
          99,
        );
        this.callbacks.onProgress?.(
          percent,
          `Playing chunk ${this.processedAudioChunks} of ${this.totalAudioChunks}...`,
        );

        this.postToWorker({ type: "buffer_processed" });

        if (this.scheduledItems.length === 0) {
          this.isPlaying = false;
          this.stopRaf();
          this.checkPlaybackComplete();
        }
      };

      source.start(startContextTime);
      this.ensureHighlightLoop();
    });

    this.enqueueChain = task.catch((err) => {
      console.error("Error queueing audio chunk:", err);
    });
    return this.enqueueChain;
  }

  private checkPlaybackComplete(): void {
    if (
      !this.stopped &&
      this.generationComplete &&
      this.scheduledItems.length === 0
    ) {
      this.isPlaying = false;
      this.emitIdleHighlight();
      this.callbacks.onPlaybackComplete?.();
    }
  }

  private postToWorker(msg: WorkerRequestMessage): void {
    this.worker?.postMessage(msg);
  }

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private stopScheduledSources(): void {
    this.stopRaf();
    for (const item of this.scheduledItems) {
      try {
        item.source.onended = null;
        item.source.stop();
        item.source.disconnect();
      } catch {
        // Source may have already finished
      }
    }
    this.scheduledItems = [];
  }

  private emitIdleHighlight(): void {
    this.stopRaf();
    this.lastEmittedKey = "idle";
    this.callbacks.onTimeUpdate?.(0);
    this.callbacks.onHighlightChange?.({
      isPlaying: false,
      currentTimeMs: 0,
      activeChunkIndex: null,
      activeWord: null,
    });
  }

  private ensureHighlightLoop(): void {
    if (this.rafId !== null) return;

    const tick = () => {
      if (
        this.stopped ||
        !this.isPlaying ||
        this.scheduledItems.length === 0 ||
        !this.audioContext
      ) {
        this.rafId = null;
        return;
      }

      const now = this.audioContext.currentTime;
      let activeItem = this.scheduledItems[0];
      for (let i = 0; i < this.scheduledItems.length; i++) {
        const candidate = this.scheduledItems[i];
        if (now < candidate.endContextTime) {
          activeItem = candidate;
          break;
        }
        activeItem = candidate;
      }

      const elapsedMs = Math.max(
        0,
        (now - activeItem.startContextTime) * 1000,
      );
      const currentTimeMs = Math.min(
        activeItem.chunk.endMs,
        activeItem.chunk.startMs + elapsedMs,
      );

      this.callbacks.onTimeUpdate?.(currentTimeMs);

      const activeWord = findActiveWordInChunk(
        activeItem.chunk,
        currentTimeMs + VISUAL_LEAD_MS,
      );

      // Only trigger React state updates when the active word or sentence actually changes!
      const nextKey = `1|${activeItem.chunk.chunkIndex}|${activeWord?.wordIndex ?? -1}`;
      if (nextKey !== this.lastEmittedKey) {
        this.lastEmittedKey = nextKey;
        this.callbacks.onHighlightChange?.({
          isPlaying: true,
          currentTimeMs,
          activeChunkIndex: activeItem.chunk.chunkIndex,
          activeWord,
        });
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop(notifyWorker = true): void {
    this.stopped = true;
    this.sessionId++;
    this.stopScheduledSources();
    this.nextStartTime = 0;
    this.isPlaying = false;
    this.generationComplete = false;
    this.emitIdleHighlight();

    if (notifyWorker) {
      this.postToWorker({ type: "stop" });
    }
  }

  close(): void {
    this.stop(false);
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}
