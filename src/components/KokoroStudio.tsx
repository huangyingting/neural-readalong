"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTimeMs, WordHighlightView } from "@/components/WordHighlightView";
import { AudioDiskSaver } from "@/lib/audio-disk-saver";
import { AudioPlayer } from "@/lib/audio-player";
import {
  getQuantizationOptionsForModel,
  KOKORO_TIMESTAMPED_MODEL_ID,
  MODEL_REPO_OPTIONS,
  normalizeQuantizationForModel,
  PARADEE_V1_3_MODEL_ID,
} from "@/lib/quantization";
import { segmentTextIntoWords } from "@/lib/word-timestamps";
import type {
  ChunkAlignment,
  ConcreteQuantization,
  DevicePreference,
  PlaybackHighlightState,
  QuantizationType,
  RuntimeDevice,
  TranscriptExport,
  TTSModelId,
  VoiceLanguage,
  VoiceMetadata,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "@/types/tts";

type ActiveMode = "none" | "stream" | "disk";
type ViewTab = "edit" | "highlight";

interface VoiceGroup {
  key: string;
  label: string;
  options: Array<{ id: string; label: string }>;
}

const LANGUAGE_GROUP_LABELS: Readonly<
  Record<VoiceLanguage, { label: string; shortLabel: string; order: number }>
> = {
  "en-us": {
    label: "🇺🇸 American English",
    shortLabel: "English (US)",
    order: 1,
  },
  "en-gb": {
    label: "🇬🇧 British English",
    shortLabel: "English (UK)",
    order: 2,
  },
  hi: {
    label: "🇮🇳 Hindi (हिन्दी)",
    shortLabel: "Hindi",
    order: 3,
  },
  "fr-fr": {
    label: "🇫🇷 French (Français)",
    shortLabel: "French",
    order: 4,
  },
  es: {
    label: "🇪🇸 Spanish (Español)",
    shortLabel: "Spanish",
    order: 5,
  },
};

interface SamplePreset {
  id: string;
  label: string;
  requiresParadee?: boolean;
  preferredVoice: string;
  text?: string;
  loadFromPublicUrl?: string;
}

const SAMPLE_PRESETS: readonly SamplePreset[] = [
  {
    id: "hemingway",
    label: "Hemingway Story (EN)",
    preferredVoice: "af_heart",
    loadFromPublicUrl: "/end.txt",
  },
  {
    id: "en-demo",
    label: "English (US/UK)",
    preferredVoice: "bf_isabella",
    text: "Parakeets are small, fast birds that live in warm forests and travel in colorful flocks. Every spoken word is synchronized directly from neural duration frames inside your browser.",
  },
  {
    id: "hi-demo",
    label: "हिन्दी (HI)",
    requiresParadee: true,
    preferredVoice: "hf_alpha",
    text: "नमस्ते दुनिया। पैराडी मॉडल अब सीधे आपके ब्राउज़र में सटीक शब्द समय के साथ हिंदी, अंग्रेजी, फ्रेंच और स्पेनिश बोल सकता है।",
  },
  {
    id: "fr-demo",
    label: "Français (FR)",
    requiresParadee: true,
    preferredVoice: "ff_siwis",
    text: "Bonjour à tous ! Les perruches sont de petits oiseaux rapides qui vivent dans les forêts chaudes et voyagent en groupes colorés.",
  },
  {
    id: "es-demo",
    label: "Español (ES)",
    requiresParadee: true,
    preferredVoice: "em_alex",
    text: "¡Hola a todos! Los periquitos son aves pequeñas y rápidas que viven en bosques cálidos y viajan en bandadas coloridas.",
  },
];

function buildVoiceGroups(voices: Record<string, VoiceMetadata>): {
  groups: VoiceGroup[];
  defaultVoiceId: string;
} {
  const buckets = new Map<
    string,
    {
      order: number;
      label: string;
      items: Array<{ id: string; name: string; label: string }>;
    }
  >();

  for (const [id, voice] of Object.entries(voices)) {
    const langMeta = LANGUAGE_GROUP_LABELS[voice.language] ?? {
      label: voice.language.toUpperCase(),
      shortLabel: voice.language,
      order: 99,
    };
    const bucketKey = `${voice.language}:${voice.gender}`;
    const bucketOrder =
      langMeta.order * 10 + (voice.gender === "Female" ? 0 : 1);
    const bucketLabel = `${langMeta.label} — ${voice.gender}`;
    const optionLabel = `${voice.name}${voice.traits ? ` ${voice.traits}` : ""} (${id})`;

    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.items.push({ id, name: voice.name, label: optionLabel });
    } else {
      buckets.set(bucketKey, {
        order: bucketOrder,
        label: bucketLabel,
        items: [{ id, name: voice.name, label: optionLabel }],
      });
    }
  }

  const sortedBuckets = Array.from(buckets.entries()).sort(
    (a, b) => a[1].order - b[1].order,
  );

  const groups: VoiceGroup[] = [];
  let firstVoiceId = "";

  for (const [key, bucket] of sortedBuckets) {
    const sortedItems = [...bucket.items].sort((a, b) => {
      if (a.id === "af_heart") return -1;
      if (b.id === "af_heart") return 1;
      return a.name.localeCompare(b.name);
    });
    if (!firstVoiceId && sortedItems.length > 0) {
      firstVoiceId = sortedItems[0].id;
    }
    groups.push({
      key,
      label: bucket.label,
      options: sortedItems.map(({ id, label }) => ({ id, label })),
    });
  }

  const defaultVoiceId = Object.prototype.hasOwnProperty.call(voices, "af_heart")
    ? "af_heart"
    : firstVoiceId || "af_heart";

  return { groups, defaultVoiceId };
}

export function KokoroStudio() {
  const [text, setText] = useState("");
  const [viewTab, setViewTab] = useState<ViewTab>("edit");

  // Engine, quantization, device & speed configuration
  const [modelId, setModelId] = useState<TTSModelId>(
    KOKORO_TIMESTAMPED_MODEL_ID,
  );
  const [quantization, setQuantization] = useState<QuantizationType>("auto");
  const [devicePreference, setDevicePreference] =
    useState<DevicePreference>("auto");
  const [speed, setSpeed] = useState<number>(1.0);

  // Loaded model runtime telemetry
  const [isModelLoading, setIsModelLoading] = useState<boolean>(true);
  const [isModelReady, setIsModelReady] = useState<boolean>(false);
  const [loadedModelId, setLoadedModelId] = useState<TTSModelId>(
    KOKORO_TIMESTAMPED_MODEL_ID,
  );
  const [loadedQuantization, setLoadedQuantization] =
    useState<ConcreteQuantization>("fp32");
  const [loadedOnnxFile, setLoadedOnnxFile] =
    useState<string>("onnx/model.onnx");
  const [loadedApproxSize, setLoadedApproxSize] = useState<string>("326 MB");
  const [activeDevice, setActiveDevice] = useState<RuntimeDevice>("wasm");
  const [webgpuAvailable, setWebgpuAvailable] = useState<boolean>(false);
  const [fp16Supported, setFp16Supported] = useState<boolean>(false);

  // Voices
  const [voices, setVoices] = useState<Record<string, VoiceMetadata>>({});
  const [selectedVoice, setSelectedVoice] = useState<string>("af_heart");
  const pendingVoiceRef = useRef<string | null>(null);

  // Streaming / disk mode, progress & cache notices
  const [mode, setMode] = useState<ActiveMode>("none");
  const [isGeneratingFirstChunk, setIsGeneratingFirstChunk] =
    useState<boolean>(false);
  const [progressVisible, setProgressVisible] = useState<boolean>(true);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>(
    "Initializing neural TTS engine...",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);

  // Word timestamps & playback highlighting
  const [chunks, setChunks] = useState<ChunkAlignment[]>([]);
  const [highlightState, setHighlightState] = useState<PlaybackHighlightState>({
    isPlaying: false,
    currentTimeMs: 0,
    activeChunkIndex: null,
    activeWord: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const audioDiskSaverRef = useRef<AudioDiskSaver | null>(null);
  const hemingwayTextRef = useRef<string>("");
  const clockElRef = useRef<HTMLSpanElement | null>(null);
  const lastTimeMsRef = useRef<number>(0);
  const modeRef = useRef<ActiveMode>("none");
  const hideProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const updateMode = useCallback((nextMode: ActiveMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const showProgress = useCallback((percent: number, message?: string) => {
    if (hideProgressTimerRef.current) {
      clearTimeout(hideProgressTimerRef.current);
      hideProgressTimerRef.current = null;
    }
    const clamped = Math.max(0, Math.min(100, percent));
    setProgressVisible(true);
    setProgressPercent(clamped);
    if (message) {
      setProgressMessage(message);
    }
    if (clamped >= 100) {
      hideProgressTimerRef.current = setTimeout(() => {
        setProgressVisible(false);
      }, 2200);
    }
  }, []);

  const postWorkerMessage = useCallback((msg: WorkerRequestMessage) => {
    workerRef.current?.postMessage(msg);
  }, []);

  // Load default Hemingway text + optional localhost service worker
  useEffect(() => {
    let cancelled = false;
    fetch("/end.txt")
      .then((res) => (res.ok ? res.text() : ""))
      .then((content) => {
        if (!cancelled && content) {
          hemingwayTextRef.current = content;
          setText((prev) => (prev ? prev : content));
        }
      })
      .catch(() => {
        // Ignore if offline
      });

    if (
      typeof window !== "undefined" &&
      window.location.hostname === "localhost" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {
        // Ignore service worker registration errors
      });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize Web Worker, AudioPlayer, and AudioDiskSaver
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/tts.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    const diskSaver = new AudioDiskSaver();
    audioDiskSaverRef.current = diskSaver;

    const player = new AudioPlayer(worker, {
      onHighlightChange: (state) => {
        setHighlightState(state);
      },
      onTimeUpdate: (timeMs) => {
        lastTimeMsRef.current = timeMs;
        if (clockElRef.current) {
          const formatted = formatTimeMs(timeMs);
          if (clockElRef.current.textContent !== formatted) {
            clockElRef.current.textContent = formatted;
          }
        }
      },
      onProgress: (pct, msg) => {
        showProgress(pct, msg);
      },
      onPlaybackComplete: () => {
        if (modeRef.current === "stream") {
          updateMode("none");
          setIsGeneratingFirstChunk(false);
          showProgress(100, "Streaming complete");
        }
      },
    });
    audioPlayerRef.current = player;

    const handleMessage = async (event: MessageEvent<WorkerResponseMessage>) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.status) {
        case "loading_model_start": {
          setErrorMessage(null);
          setIsModelLoading(true);
          setIsModelReady(false);
          setLoadedModelId(msg.modelId);
          setLoadedQuantization(msg.quantization);
          setLoadedOnnxFile(msg.onnxFile);
          setLoadedApproxSize(msg.approximateSize);
          setActiveDevice(msg.device);
          setWebgpuAvailable(msg.webgpuAvailable);
          setFp16Supported(msg.fp16Supported);
          showProgress(
            0,
            `Loading ${msg.onnxFile} (${msg.approximateSize} • ${msg.device.toUpperCase()})...`,
          );
          break;
        }

        case "loading_model_progress": {
          const pct = Number.isFinite(msg.progress) ? msg.progress : 0;
          const fileLabel = msg.file ? ` (${msg.file})` : "";
          showProgress(
            pct,
            `Downloading model${fileLabel}: ${Math.round(pct)}%`,
          );
          break;
        }

        case "loading_model_ready": {
          setIsModelLoading(false);
          setIsModelReady(true);
          setLoadedModelId(msg.modelId);
          setLoadedQuantization(msg.quantization);
          setLoadedOnnxFile(msg.onnxFile);
          setLoadedApproxSize(msg.approximateSize);
          setActiveDevice(msg.device);
          setWebgpuAvailable(msg.webgpuAvailable);
          setFp16Supported(msg.fp16Supported);
          setVoices(msg.voices);

          const requestedVoice = pendingVoiceRef.current;
          pendingVoiceRef.current = null;
          const { defaultVoiceId } = buildVoiceGroups(msg.voices);
          setSelectedVoice((prev) => {
            if (
              requestedVoice &&
              Object.prototype.hasOwnProperty.call(msg.voices, requestedVoice)
            ) {
              return requestedVoice;
            }
            return Object.prototype.hasOwnProperty.call(msg.voices, prev)
              ? prev
              : defaultVoiceId;
          });

          const shortEngine =
            msg.modelId === PARADEE_V1_3_MODEL_ID
              ? "Paradee-8M v1.3"
              : "Kokoro-82M v1.0";
          showProgress(
            100,
            `${shortEngine} ready (${msg.quantization.toUpperCase()} • ${msg.device.toUpperCase()})`,
          );
          break;
        }

        case "chunk_count": {
          player.setTotalChunks(msg.count);
          diskSaver.setTotalChunks(msg.count);
          break;
        }

        case "stream_audio_data": {
          setChunks((prev) => [...prev, msg.chunk]);
          setIsGeneratingFirstChunk(false);

          if (modeRef.current === "disk") {
            const pct = await diskSaver.addAudioChunk(msg.audio);
            showProgress(pct, "Saving synthesized audio & word timestamps...");
            worker.postMessage({
              type: "buffer_processed",
            } satisfies WorkerRequestMessage);
          } else if (modeRef.current === "stream") {
            await player.queueAudio(msg.audio, msg.chunk, msg.sampleRate);
          }
          break;
        }

        case "complete": {
          if (modeRef.current === "disk") {
            try {
              showProgress(99.5, "Finalizing WAV file...");
              await diskSaver.finalizeSave();
              showProgress(100, "Audio saved successfully!");
            } catch (err) {
              console.error("Error finalizing WAV:", err);
              setErrorMessage("Failed to finalize WAV file.");
              showProgress(100, "Error saving file");
            } finally {
              updateMode("none");
              setIsGeneratingFirstChunk(false);
            }
          } else if (modeRef.current === "stream") {
            player.markGenerationComplete();
          }
          break;
        }

        case "error": {
          setIsModelLoading(false);
          setIsGeneratingFirstChunk(false);
          if (modeRef.current === "stream") {
            player.stop(false);
          } else if (modeRef.current === "disk") {
            await diskSaver.stopSave();
          }
          updateMode("none");
          setErrorMessage(msg.error);
          showProgress(100, "Operation failed");
          break;
        }
      }
    };

    const handleWorkerError = (event: ErrorEvent) => {
      console.error("TTS Worker error:", event);
      setIsModelLoading(false);
      setIsGeneratingFirstChunk(false);
      player.stop(false);
      updateMode("none");
      setErrorMessage(
        event.message || "Unexpected Web Worker error occurred.",
      );
      showProgress(100, "Worker error");
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleWorkerError);

    return () => {
      if (hideProgressTimerRef.current) {
        clearTimeout(hideProgressTimerRef.current);
      }
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleWorkerError);
      player.close();
      worker.terminate();
    };
  }, [showProgress, updateMode]);

  const { groups: voiceGroups } = useMemo(
    () => buildVoiceGroups(voices),
    [voices],
  );

  const quantizationOptions = useMemo(
    () => getQuantizationOptionsForModel(modelId),
    [modelId],
  );

  const wordCount = useMemo(
    () => segmentTextIntoWords(text).wordCount,
    [text],
  );

  const applyModelConfig = useCallback(
    (
      nextModelId: TTSModelId,
      nextQuantization: QuantizationType,
      nextDevicePref: DevicePreference,
    ) => {
      if (modeRef.current === "stream") {
        audioPlayerRef.current?.stop(true);
      } else if (modeRef.current === "disk") {
        postWorkerMessage({ type: "stop" });
        void audioDiskSaverRef.current?.stopSave();
      }
      updateMode("none");
      setIsGeneratingFirstChunk(false);

      postWorkerMessage({
        type: "load_model",
        modelId: nextModelId,
        quantization: nextQuantization,
        devicePreference: nextDevicePref,
      });
    },
    [postWorkerMessage, updateMode],
  );

  const handleEngineSelect = useCallback(
    (nextModel: TTSModelId) => {
      if (nextModel === modelId || isModelLoading || mode !== "none") return;
      const normalizedQuant = normalizeQuantizationForModel(
        quantization,
        nextModel,
      );
      setModelId(nextModel);
      setQuantization(normalizedQuant);
      setCacheNotice(null);
      applyModelConfig(nextModel, normalizedQuant, devicePreference);
    },
    [applyModelConfig, devicePreference, isModelLoading, mode, modelId, quantization],
  );

  const handleQuantizationChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextQuant = e.target.value as QuantizationType;
    setQuantization(nextQuant);
    applyModelConfig(modelId, nextQuant, devicePreference);
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextDevice = e.target.value as DevicePreference;
    setDevicePreference(nextDevice);
    applyModelConfig(modelId, quantization, nextDevice);
  };

  const handleSelectPreset = async (preset: SamplePreset) => {
    if (mode !== "none") return;
    setErrorMessage(null);
    setCacheNotice(null);

    let nextText = preset.text ?? "";
    if (preset.loadFromPublicUrl) {
      if (hemingwayTextRef.current) {
        nextText = hemingwayTextRef.current;
      } else {
        try {
          const res = await fetch(preset.loadFromPublicUrl);
          if (res.ok) {
            nextText = await res.text();
            hemingwayTextRef.current = nextText;
          }
        } catch {
          // Ignore network error
        }
      }
    }

    if (nextText) {
      setText(nextText);
      setChunks([]);
      setViewTab("edit");
    }

    if (preset.requiresParadee && modelId !== PARADEE_V1_3_MODEL_ID) {
      if (!isModelLoading) {
        pendingVoiceRef.current = preset.preferredVoice;
        const normalizedQuant = normalizeQuantizationForModel(
          quantization,
          PARADEE_V1_3_MODEL_ID,
        );
        setModelId(PARADEE_V1_3_MODEL_ID);
        setQuantization(normalizedQuant);
        applyModelConfig(PARADEE_V1_3_MODEL_ID, normalizedQuant, devicePreference);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(voices, preset.preferredVoice)) {
      setSelectedVoice(preset.preferredVoice);
    }
  };

  const handleClearModelCache = async () => {
    if (typeof caches === "undefined" || isClearingCache) return;
    setIsClearingCache(true);
    setErrorMessage(null);
    try {
      const removedNames: string[] = [];
      for (const cacheName of ["transformers-cache", "kokoro-voices"]) {
        const deleted = await caches.delete(cacheName);
        if (deleted) removedNames.push(cacheName);
      }
      setCacheNotice(
        removedNames.length > 0
          ? `Cleared browser model cache (${removedNames.join(", ")}). Current in-memory session stays active until reload or model switch.`
          : "Browser model cache is already empty.",
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? `Failed to clear browser cache: ${err.message}`
          : "Failed to clear browser cache.",
      );
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleStreamButtonClick = () => {
    if (mode === "stream") {
      audioPlayerRef.current?.stop(true);
      updateMode("none");
      setIsGeneratingFirstChunk(false);
      showProgress(100, "Streaming stopped");
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      setErrorMessage("Please enter some text to synthesize.");
      return;
    }

    setErrorMessage(null);
    setCacheNotice(null);
    setChunks([]);
    setViewTab("highlight");
    updateMode("stream");
    setIsGeneratingFirstChunk(true);

    const estimatedChunks = Math.max(1, Math.ceil(text.length / 180));
    audioPlayerRef.current?.startSession(estimatedChunks);
    showProgress(0, "Synthesizing first sentence...");

    postWorkerMessage({
      type: "generate",
      text,
      voice: selectedVoice,
      speed,
    });
  };

  const isParadee = loadedModelId === PARADEE_V1_3_MODEL_ID;
  const filePrefix = isParadee ? "paradee" : "kokoro";

  const handleDiskButtonClick = async () => {
    if (mode === "disk") {
      postWorkerMessage({ type: "stop" });
      await audioDiskSaverRef.current?.stopSave();
      updateMode("none");
      setIsGeneratingFirstChunk(false);
      showProgress(100, "Audio download stopped");
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      setErrorMessage("Please enter some text to synthesize.");
      return;
    }

    setErrorMessage(null);
    setCacheNotice(null);
    updateMode("disk");
    setIsGeneratingFirstChunk(true);

    try {
      showProgress(0, "Preparing WAV output...");
      await audioDiskSaverRef.current?.initSave(`${filePrefix}_speech.wav`);
      setChunks([]);
      const estimatedChunks = Math.max(1, Math.ceil(text.length / 180));
      audioDiskSaverRef.current?.setTotalChunks(estimatedChunks);
      showProgress(0, "Generating audio for download...");

      postWorkerMessage({
        type: "generate",
        text,
        voice: selectedVoice,
        speed,
      });
    } catch (err) {
      updateMode("none");
      setIsGeneratingFirstChunk(false);
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to initialize file save",
        );
      }
      showProgress(100, isAbort ? "Save cancelled" : "Error initializing save");
    }
  };

  const handleRequestEdit = useCallback(() => {
    setViewTab("edit");
  }, []);

  const handleExportTimestamps = useCallback(() => {
    const words = chunks.flatMap((chunk) =>
      chunk.words.map(({ text: wordText, startMs, endMs }) => ({
        text: wordText,
        startMs,
        endMs,
      })),
    );
    if (words.length === 0) return;

    const payload: TranscriptExport = {
      text,
      modelId: loadedModelId,
      quantization: loadedQuantization,
      voice: selectedVoice,
      words,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filePrefix}_word_timestamps.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [chunks, filePrefix, loadedModelId, loadedQuantization, selectedVoice, text]);

  const isBusy = mode !== "none";
  const activeVoiceMeta = voices[selectedVoice];
  const activeLanguageLabel = activeVoiceMeta
    ? (LANGUAGE_GROUP_LABELS[activeVoiceMeta.language]?.shortLabel ??
      activeVoiceMeta.language)
    : "Loading...";
  const showFp16Note =
    activeDevice === "webgpu" &&
    !fp16Supported &&
    quantizationOptions.find((q) => q.id === quantization)?.requiresFp16;

  return (
    <main className="container">
      {/* Studio Header & Runtime Telemetry */}
      <header className="header">
        <div className="header-top">
          <div className="brand-block">
            <h1>Neural Readalong</h1>
            <p className="subtitle">
              100% client-side WebGPU &amp; WASM synthesis with exact neural
              per-token word timestamps
            </p>
          </div>
          <div className="runtime-badges">
            <span className="badge badge-engine" title={loadedModelId}>
              {isParadee ? "Paradee-8M v1.3" : "Kokoro-82M v1.0"}
            </span>
            <span className="badge badge-device">
              {activeDevice === "webgpu" ? "WebGPU" : "WASM CPU"}
            </span>
            <span className="badge badge-quant" title={loadedOnnxFile}>
              {loadedQuantization === "q8" && isParadee
                ? "INT8"
                : loadedQuantization.toUpperCase()}{" "}
              • {loadedApproxSize}
            </span>
            <button
              type="button"
              className="cache-clear-btn"
              onClick={handleClearModelCache}
              disabled={isClearingCache}
              title="Delete downloaded ONNX models and voice embeddings from browser Cache Storage"
            >
              {isClearingCache ? "Clearing..." : "Clear Model Cache"}
            </button>
          </div>
        </div>
      </header>

      {/* Dual Timestamped Engine Selector Cards */}
      <section
        className="engine-cards"
        role="radiogroup"
        aria-label="Timestamped TTS Engine"
      >
        {MODEL_REPO_OPTIONS.map((repo) => {
          const isSelected = modelId === repo.id;
          return (
            <button
              key={repo.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`engine-card ${isSelected ? "selected" : ""}`}
              onClick={() => handleEngineSelect(repo.id)}
              disabled={isModelLoading || isBusy}
            >
              <div className="engine-card-top">
                <div className="engine-title-row">
                  <span className="engine-radio-dot" aria-hidden="true" />
                  <span className="engine-title">{repo.label}</span>
                </div>
                <span className="engine-params-pill">{repo.paramsLabel}</span>
              </div>
              <p className="engine-desc">{repo.description}</p>
              <div className="engine-meta-row">
                <span className="engine-meta-chip">{repo.voiceSummary}</span>
                <span className="engine-meta-chip">{repo.sizeSummary}</span>
                <span className="engine-repo-code">{repo.id}</span>
              </div>
            </button>
          );
        })}
      </section>

      {/* Unified Synthesis Configuration Toolbar */}
      <section
        className="settings-grid"
        aria-label="Voice, quantization, device, and speed settings"
      >
        <div className="field-group field-voice">
          <label htmlFor="voiceSelector">Voice &amp; Language</label>
          <select
            id="voiceSelector"
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            disabled={!isModelReady || isModelLoading || isBusy}
          >
            {voiceGroups.length === 0 ? (
              <option value="">Loading voices...</option>
            ) : (
              voiceGroups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))
            )}
          </select>
        </div>

        <div className="field-group field-quant">
          <label htmlFor="quantSelector">ONNX Quantization</label>
          <select
            id="quantSelector"
            value={quantization}
            onChange={handleQuantizationChange}
            disabled={isModelLoading || isBusy}
          >
            {quantizationOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor="deviceSelector">Execution Device</label>
          <select
            id="deviceSelector"
            value={devicePreference}
            onChange={handleDeviceChange}
            disabled={isModelLoading || isBusy}
          >
            <option value="auto">
              Auto ({webgpuAvailable ? "WebGPU" : "WASM"})
            </option>
            <option value="webgpu" disabled={!webgpuAvailable}>
              WebGPU {!webgpuAvailable ? "(Unavailable)" : ""}
            </option>
            <option value="wasm">WASM (CPU)</option>
          </select>
        </div>

        <div className="field-group field-speed">
          <div className="speed-label-row">
            <label htmlFor="speedRange">Speed: {speed.toFixed(2)}x</label>
            {speed !== 1 && (
              <button
                type="button"
                className="speed-reset-btn"
                onClick={() => setSpeed(1.0)}
                disabled={isBusy}
              >
                Reset
              </button>
            )}
          </div>
          <input
            id="speedRange"
            type="range"
            min="0.7"
            max="1.5"
            step="0.05"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isBusy}
          />
        </div>
      </section>

      {showFp16Note && (
        <div className="notice-banner warning-banner" role="status">
          <span>
            Your WebGPU adapter did not report <code>shader-f16</code> support.
            If this FP16 quantization fails on WebGPU, switch Execution Device
            to <strong>WASM (CPU)</strong> or select <strong>Q8 / FP32</strong>.
          </span>
        </div>
      )}

      {cacheNotice && (
        <div className="notice-banner info-banner" role="status">
          <span>{cacheNotice}</span>
          <button
            type="button"
            className="banner-dismiss"
            onClick={() => setCacheNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="notice-banner error-banner" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="banner-dismiss"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workspace Bar: Mode Tabs + Multilingual Sample Presets */}
      <div className="workspace-bar">
        <div className="workspace-bar-left">
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label="Text view mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === "edit"}
              className={`tab-btn ${viewTab === "edit" ? "active" : ""}`}
              onClick={() => setViewTab("edit")}
              disabled={mode === "stream"}
            >
              Edit Script
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewTab === "highlight"}
              className={`tab-btn ${viewTab === "highlight" ? "active" : ""}`}
              onClick={() => setViewTab("highlight")}
            >
              Word Highlight Reader
              {highlightState.isPlaying && (
                <span className="live-pill">LIVE</span>
              )}
            </button>
          </div>
          <span className="script-stats">
            {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"} •{" "}
            {text.length.toLocaleString()} chars
          </span>
        </div>

        <div className="preset-bar" aria-label="Sample text presets">
          <span className="preset-label">Samples:</span>
          {SAMPLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-chip ${
                preset.requiresParadee && modelId !== PARADEE_V1_3_MODEL_ID
                  ? "preset-chip-multilingual"
                  : ""
              }`}
              onClick={() => void handleSelectPreset(preset)}
              disabled={isBusy || (preset.requiresParadee === true && isModelLoading)}
              title={
                preset.requiresParadee && modelId !== PARADEE_V1_3_MODEL_ID
                  ? `Switch to Paradee-8M v1.3 and load ${preset.label} sample`
                  : `Load ${preset.label} sample`
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Text / Highlight Area */}
      <div className="text-input">
        {viewTab === "edit" ? (
          <textarea
            id="ta"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (chunks.length > 0) {
                setChunks([]);
              }
            }}
            placeholder="Enter or paste English, Hindi (हिन्दी), French, or Spanish text to synthesize with live neural word highlighting..."
            disabled={mode === "stream"}
          />
        ) : (
          <WordHighlightView
            text={text}
            chunks={chunks}
            isPlaying={highlightState.isPlaying}
            initialTimeMs={lastTimeMsRef.current}
            clockRef={clockElRef}
            activeChunkIndex={highlightState.activeChunkIndex}
            activeWord={highlightState.activeWord}
            onRequestEdit={handleRequestEdit}
            onExportTimestamps={handleExportTimestamps}
          />
        )}
      </div>

      {/* Progress Section */}
      {progressVisible && (
        <div id="progressContainer" className="footer-section">
          <div className="progress-header">
            <p id="progressLabel">{progressMessage}</p>
            <p id="progressStatus">
              {progressPercent >= 100
                ? "Complete"
                : `${Math.round(progressPercent)}%`}
            </p>
          </div>
          <div className="progress-bar">
            <div
              id="progressBar"
              className={`progress-bar-fill ${progressPercent >= 100 ? "success" : ""}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Playback & WAV Export Action Footer */}
      <footer className="control-panel">
        <div className="active-voice-summary">
          <span className="summary-dot" aria-hidden="true" />
          {activeVoiceMeta ? (
            <span>
              Speaking as{" "}
              <strong>
                {activeVoiceMeta.name}
                {activeVoiceMeta.traits ? ` ${activeVoiceMeta.traits}` : ""}
              </strong>{" "}
              • {activeLanguageLabel} •{" "}
              <code>{loadedOnnxFile}</code>
            </span>
          ) : (
            <span>Loading engine voices...</span>
          )}
        </div>

        <div className="action-buttons">
          <button
            id="streamAudioContext"
            type="button"
            className={`primary-action-btn ${
              mode === "stream" && !isGeneratingFirstChunk
                ? "stop-streaming"
                : ""
            }`}
            onClick={handleStreamButtonClick}
            disabled={!isModelReady || isModelLoading || mode === "disk"}
          >
            {mode === "stream" && isGeneratingFirstChunk ? (
              <span className="btn-content">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="spin btn-icon"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                Synthesizing... (Cancel)
              </span>
            ) : mode === "stream" ? (
              <span className="btn-content">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="btn-icon"
                >
                  <circle cx="12" cy="12" r="10" />
                  <rect x="9" y="9" width="6" height="6" />
                </svg>
                Stop Streaming
              </span>
            ) : (
              <span className="btn-content">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="btn-icon"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
                Stream Speech
              </span>
            )}
          </button>

          <button
            id="streamAudioDisk"
            type="button"
            className={`secondary-action-btn ${
              mode === "disk" ? "stop-saving" : ""
            }`}
            onClick={handleDiskButtonClick}
            disabled={!isModelReady || isModelLoading || mode === "stream"}
          >
            {mode === "disk" ? (
              <span className="btn-content">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="btn-icon"
                >
                  <circle cx="12" cy="12" r="10" />
                  <rect x="9" y="9" width="6" height="6" />
                </svg>
                Cancel WAV Save
              </span>
            ) : (
              <span className="btn-content">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="btn-icon"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download WAV
              </span>
            )}
          </button>
        </div>
      </footer>
    </main>
  );
}
