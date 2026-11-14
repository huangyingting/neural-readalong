import { KOKORO_SAMPLE_RATE } from "@/lib/kokoro";

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
}

function createWavHeader(dataByteLength: number, sampleRate = KOKORO_SAMPLE_RATE): ArrayBuffer {
  const headerBuffer = new ArrayBuffer(44);
  const view = new DataView(headerBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 3, true); // IEEE float32 format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // ByteRate
  view.setUint16(32, 4, true); // BlockAlign
  view.setUint16(34, 32, true); // BitsPerSample
  writeString(36, "data");
  view.setUint32(40, dataByteLength, true);

  return headerBuffer;
}

export class AudioDiskSaver {
  private fileStream: FileSystemWritableFileStream | null = null;
  private memoryChunks: ArrayBuffer[] = [];
  private useMemoryFallback = false;
  private totalAudioChunks = 1;
  private processedAudioChunks = 0;
  private dataSize = 0;

  async initSave(suggestedName = "kokoro_speech.wav"): Promise<void> {
    this.reset();
    const pickerWindow = window as SaveFilePickerWindow;

    if (typeof pickerWindow.showSaveFilePicker === "function") {
      const fileHandle = await pickerWindow.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "WAV Audio File",
            accept: { "audio/wav": [".wav"] },
          },
        ],
      });
      this.fileStream = await fileHandle.createWritable();
      await this.fileStream.write(createWavHeader(0));
      this.useMemoryFallback = false;
    } else {
      // Fallback for browsers without File System Access API (Firefox/Safari)
      this.useMemoryFallback = true;
      this.memoryChunks = [];
    }
  }

  setTotalChunks(totalChunks: number): void {
    this.totalAudioChunks = Math.max(1, totalChunks);
    this.processedAudioChunks = 0;
  }

  async addAudioChunk(audioData: ArrayBuffer): Promise<number> {
    if (this.useMemoryFallback) {
      this.memoryChunks.push(audioData.slice(0));
    } else {
      if (!this.fileStream) {
        throw new Error("File stream not initialized");
      }
      await this.fileStream.write(audioData);
    }

    this.dataSize += audioData.byteLength;
    this.processedAudioChunks++;
    return Math.min(
      (this.processedAudioChunks / Math.max(1, this.totalAudioChunks)) * 100,
      99,
    );
  }

  async finalizeSave(fallbackFilename = "kokoro_speech.wav"): Promise<void> {
    try {
      if (this.useMemoryFallback) {
        if (this.dataSize > 0) {
          const header = createWavHeader(this.dataSize);
          const blob = new Blob([header, ...this.memoryChunks], {
            type: "audio/wav",
          });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = fallbackFilename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      } else if (this.fileStream) {
        await this.updateStreamWavHeader();
        await this.fileStream.close();
      }
    } finally {
      this.reset();
    }
  }

  async stopSave(): Promise<void> {
    try {
      if (this.useMemoryFallback) {
        if (this.dataSize > 0) {
          await this.finalizeSave("kokoro_speech_partial.wav");
          return;
        }
      } else if (this.fileStream) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await this.updateStreamWavHeader();
        await this.fileStream.close();
      }
    } catch (error) {
      console.error("Error stopping disk save:", error);
      if (this.fileStream) {
        try {
          await this.fileStream.close();
        } catch {
          // Ignore close error
        }
      }
    } finally {
      this.reset();
    }
  }

  private async updateStreamWavHeader(): Promise<void> {
    if (!this.fileStream) return;
    const fileSize = this.dataSize + 36;

    await this.fileStream.seek(4);
    const fileSizeBuf = new ArrayBuffer(4);
    new DataView(fileSizeBuf).setUint32(0, fileSize, true);
    await this.fileStream.write(fileSizeBuf);

    await this.fileStream.seek(40);
    const dataSizeBuf = new ArrayBuffer(4);
    new DataView(dataSizeBuf).setUint32(0, this.dataSize, true);
    await this.fileStream.write(dataSizeBuf);
  }

  reset(): void {
    this.fileStream = null;
    this.memoryChunks = [];
    this.useMemoryFallback = false;
    this.processedAudioChunks = 0;
    this.dataSize = 0;
  }
}
