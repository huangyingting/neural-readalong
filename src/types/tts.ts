export type TTSModelId =
  | "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped"
  | "sahilmahendrakar/Paradee-8M-v1.3";

export type KokoroModelId = TTSModelId;

export type ConcreteQuantization =
  | "fp32"
  | "fp16"
  | "q8"
  | "q8f16"
  | "uint8"
  | "uint8f16"
  | "q4"
  | "q4f16";

export type QuantizationType = "auto" | ConcreteQuantization;

export type TransformersDtype =
  | "fp32"
  | "fp16"
  | "q8"
  | "uint8"
  | "q4"
  | "q4f16";

export type RuntimeDevice = "webgpu" | "wasm";

export type DevicePreference = "auto" | RuntimeDevice;

export type VoiceLanguage = "en-us" | "en-gb" | "hi" | "fr-fr" | "es";

export interface QuantizationOption {
  id: QuantizationType;
  label: string;
  onnxFile: string;
  approximateSize: string;
  description: string;
  requiresFp16: boolean;
}

export interface ResolvedQuantizationConfig {
  quantization: ConcreteQuantization;
  dtype: TransformersDtype;
  modelFileName: string;
  onnxFile: string;
  approximateSize: string;
  requiresFp16: boolean;
}

export interface VoiceMetadata {
  name: string;
  language: VoiceLanguage;
  gender: "Female" | "Male";
  traits?: string;
  targetQuality: string;
  overallGrade: string;
}

export interface WordTokenSpan {
  firstTokenIndex: number;
  lastTokenIndex: number;
}

export interface WordTimestamp {
  text: string;
  startMs: number;
  endMs: number;
  charStart: number;
  charEnd: number;
  chunkIndex: number;
  wordIndex: number;
}

export interface ChunkAlignment {
  chunkIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  words: WordTimestamp[];
}

export interface TextChunkSpan {
  text: string;
  charStart: number;
  charEnd: number;
}

export interface TextSegment {
  type: "word" | "whitespace";
  text: string;
  charStart: number;
  charEnd: number;
  wordIndex?: number;
}

export interface PlaybackHighlightState {
  isPlaying: boolean;
  currentTimeMs: number;
  activeChunkIndex: number | null;
  activeWord: WordTimestamp | null;
}

export interface TranscriptExport {
  text: string;
  modelId: KokoroModelId;
  quantization: ConcreteQuantization;
  voice: string;
  words: Array<{
    text: string;
    startMs: number;
    endMs: number;
  }>;
}

export type WorkerRequestMessage =
  | {
      type: "load_model";
      modelId: KokoroModelId;
      quantization: QuantizationType;
      devicePreference: DevicePreference;
    }
  | {
      type: "generate";
      text: string;
      voice: string;
      speed?: number;
    }
  | {
      type: "buffer_processed";
    }
  | {
      type: "stop";
    };

export interface ModelLoadProgressPayload {
  status?: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export type WorkerResponseMessage =
  | {
      status: "loading_model_start";
      modelId: TTSModelId;
      quantization: ConcreteQuantization;
      onnxFile: string;
      approximateSize: string;
      device: RuntimeDevice;
      webgpuAvailable: boolean;
      fp16Supported: boolean;
    }
  | {
      status: "loading_model_progress";
      progress: number;
      file?: string;
      loaded?: number;
      total?: number;
    }
  | {
      status: "loading_model_ready";
      modelId: TTSModelId;
      quantization: ConcreteQuantization;
      onnxFile: string;
      approximateSize: string;
      device: RuntimeDevice;
      webgpuAvailable: boolean;
      fp16Supported: boolean;
      voices: Record<string, VoiceMetadata>;
    }
  | {
      status: "chunk_count";
      count: number;
    }
  | {
      status: "stream_audio_data";
      audio: ArrayBuffer;
      sampleRate: number;
      chunk: ChunkAlignment;
    }
  | {
      status: "complete";
    }
  | {
      status: "error";
      error: string;
      phase: "load" | "generate";
    };
