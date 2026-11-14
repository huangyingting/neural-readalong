import { KokoroTTS, KOKORO_SAMPLE_RATE } from "@/lib/kokoro";
import { ParadeeTTS } from "@/lib/paradee";
import {
  KOKORO_TIMESTAMPED_MODEL_ID,
  PARADEE_V1_3_MODEL_ID,
  resolveQuantizationConfig,
} from "@/lib/quantization";
import { buildChunkAlignment, splitTextWithOffsets } from "@/lib/word-timestamps";
import type {
  DevicePreference,
  ModelLoadProgressPayload,
  QuantizationType,
  RuntimeDevice,
  TTSModelId,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "@/types/tts";

declare const self: DedicatedWorkerGlobalScope;

type TTSEngine = KokoroTTS | ParadeeTTS;

const MAX_QUEUE_SIZE = 6;
const DEFAULT_MODEL_ID: TTSModelId = KOKORO_TIMESTAMPED_MODEL_ID;

let currentTts: TTSEngine | null = null;
let loadedKey = "";
let loadRequestCounter = 0;
let activeGenerationId = 0;
let bufferQueueSize = 0;
let shouldStop = false;

function postResponse(
  message: WorkerResponseMessage,
  transfer?: Transferable[],
): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(message, transfer);
  } else {
    self.postMessage(message);
  }
}

async function detectHardware(): Promise<{
  webgpuAvailable: boolean;
  fp16Supported: boolean;
}> {
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
    return { webgpuAvailable: false, fp16Supported: false };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { webgpuAvailable: false, fp16Supported: false };
    }
    return {
      webgpuAvailable: true,
      fp16Supported: adapter.features.has("shader-f16"),
    };
  } catch {
    return { webgpuAvailable: false, fp16Supported: false };
  }
}

async function loadModel(
  modelId: TTSModelId,
  quantization: QuantizationType,
  devicePreference: DevicePreference,
): Promise<void> {
  const requestId = ++loadRequestCounter;
  shouldStop = true;
  activeGenerationId++;
  bufferQueueSize = 0;

  const hardware = await detectHardware();
  const device: RuntimeDevice =
    devicePreference === "auto"
      ? hardware.webgpuAvailable
        ? "webgpu"
        : "wasm"
      : devicePreference === "webgpu" && !hardware.webgpuAvailable
        ? "wasm"
        : devicePreference;

  const resolved = resolveQuantizationConfig(quantization, device, modelId);
  const targetKey = `${modelId}|${resolved.quantization}|${device}`;

  if (currentTts && loadedKey === targetKey) {
    postResponse({
      status: "loading_model_ready",
      modelId,
      quantization: resolved.quantization,
      onnxFile: resolved.onnxFile,
      approximateSize: resolved.approximateSize,
      device,
      webgpuAvailable: hardware.webgpuAvailable,
      fp16Supported: hardware.fp16Supported,
      voices: currentTts.voices,
    });
    return;
  }

  postResponse({
    status: "loading_model_start",
    modelId,
    quantization: resolved.quantization,
    onnxFile: resolved.onnxFile,
    approximateSize: resolved.approximateSize,
    device,
    webgpuAvailable: hardware.webgpuAvailable,
    fp16Supported: hardware.fp16Supported,
  });

  if (currentTts) {
    const oldModel = currentTts;
    currentTts = null;
    loadedKey = "";
    await oldModel.dispose();
  }

  if (requestId !== loadRequestCounter) {
    return;
  }

  const fileProgress = new Map<string, { loaded: number; total: number }>();
  const handleProgress = (info: ModelLoadProgressPayload | number) => {
    if (requestId !== loadRequestCounter) return;

    if (typeof info === "number") {
      const pct = info <= 1 ? info * 100 : info;
      postResponse({ status: "loading_model_progress", progress: pct });
      return;
    }

    if (
      info &&
      typeof info === "object" &&
      typeof info.loaded === "number" &&
      typeof info.total === "number" &&
      info.total > 0
    ) {
      const fileKey = info.file ?? "model";
      fileProgress.set(fileKey, {
        loaded: info.loaded,
        total: info.total,
      });

      let sumLoaded = 0;
      let sumTotal = 0;
      for (const entry of fileProgress.values()) {
        sumLoaded += entry.loaded;
        sumTotal += entry.total;
      }
      const aggregatePct = sumTotal > 0 ? (sumLoaded / sumTotal) * 100 : 0;
      postResponse({
        status: "loading_model_progress",
        progress: Math.min(99.5, Math.max(0, aggregatePct)),
        file: info.file,
        loaded: sumLoaded,
        total: sumTotal,
      });
    } else if (info && typeof info.progress === "number") {
      postResponse({
        status: "loading_model_progress",
        progress: Math.min(99.5, Math.max(0, info.progress)),
        file: info.file,
      });
    }
  };

  try {
    const tts: TTSEngine =
      modelId === PARADEE_V1_3_MODEL_ID
        ? await ParadeeTTS.fromPretrained(modelId, {
            dtype: resolved.dtype,
            modelFileName: resolved.modelFileName,
            device,
            progressCallback: handleProgress,
          })
        : await KokoroTTS.fromPretrained(modelId, {
            dtype: resolved.dtype,
            modelFileName: resolved.modelFileName,
            device,
            progressCallback: handleProgress,
          });

    if (requestId !== loadRequestCounter) {
      await tts.dispose();
      return;
    }

    currentTts = tts;
    loadedKey = targetKey;

    postResponse({
      status: "loading_model_ready",
      modelId,
      quantization: resolved.quantization,
      onnxFile: resolved.onnxFile,
      approximateSize: resolved.approximateSize,
      device,
      webgpuAvailable: hardware.webgpuAvailable,
      fp16Supported: hardware.fp16Supported,
      voices: tts.voices,
    });
  } catch (err) {
    if (requestId !== loadRequestCounter) return;
    const message =
      err instanceof Error ? err.message : String(err ?? "Unknown error");
    postResponse({
      status: "error",
      error: message,
      phase: "load",
    });
  }
}

async function handleGenerate(
  text: string,
  voice: string,
  speed = 1,
): Promise<void> {
  if (!currentTts) {
    postResponse({
      status: "error",
      error: "TTS model is not loaded yet.",
      phase: "generate",
    });
    return;
  }

  const generationId = ++activeGenerationId;
  shouldStop = false;
  bufferQueueSize = 0;

  const spans = splitTextWithOffsets(text, 200);
  if (spans.length === 0) {
    postResponse({ status: "complete" });
    return;
  }

  postResponse({ status: "chunk_count", count: spans.length });

  let totalSamples = 0;
  let nextWordIndex = 0;

  try {
    for (let chunkIndex = 0; chunkIndex < spans.length; chunkIndex++) {
      if (shouldStop || generationId !== activeGenerationId || !currentTts) {
        return;
      }

      while (
        bufferQueueSize >= MAX_QUEUE_SIZE &&
        !shouldStop &&
        generationId === activeGenerationId
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (shouldStop || generationId !== activeGenerationId || !currentTts) {
        return;
      }

      const span = spans[chunkIndex];
      const generated = await currentTts.generate(span.text, { voice, speed });

      if (shouldStop || generationId !== activeGenerationId) {
        return;
      }

      const sampleRate = generated.audio.sampling_rate || KOKORO_SAMPLE_RATE;
      const samples = generated.audio.audio;
      const chunkAlignment = buildChunkAlignment({
        chunkIndex,
        span,
        samples,
        tokens: generated.tokens,
        durations: generated.durations,
        wordTokenSpans: generated.wordTokenSpans,
        chunkSamples: samples.length,
        totalSamplesBeforeChunk: totalSamples,
        sampleRate,
        startingWordIndex: nextWordIndex,
      });

      totalSamples += samples.length;
      nextWordIndex += chunkAlignment.words.length;

      const arrayBuffer =
        samples.byteOffset === 0 &&
        samples.byteLength === samples.buffer.byteLength
          ? (samples.buffer as ArrayBuffer)
          : (samples.slice().buffer as ArrayBuffer);

      bufferQueueSize++;
      postResponse(
        {
          status: "stream_audio_data",
          audio: arrayBuffer,
          sampleRate,
          chunk: chunkAlignment,
        },
        [arrayBuffer],
      );
    }

    if (!shouldStop && generationId === activeGenerationId) {
      postResponse({ status: "complete" });
    }
  } catch (err) {
    if (shouldStop || generationId !== activeGenerationId) return;
    const message =
      err instanceof Error ? err.message : String(err ?? "Generation failed");
    postResponse({
      status: "error",
      error: message,
      phase: "generate",
    });
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequestMessage>) => {
  const data = event.data;
  if (!data) return;

  switch (data.type) {
    case "load_model":
      void loadModel(data.modelId, data.quantization, data.devicePreference);
      break;

    case "stop":
      shouldStop = true;
      activeGenerationId++;
      bufferQueueSize = 0;
      break;

    case "buffer_processed":
      bufferQueueSize = Math.max(0, bufferQueueSize - 1);
      break;

    case "generate":
      void handleGenerate(data.text, data.voice, data.speed ?? 1);
      break;
  }
});

// Auto-initialize default model on worker startup
void loadModel(DEFAULT_MODEL_ID, "auto", "auto");
