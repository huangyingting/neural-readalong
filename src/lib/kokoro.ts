import {
  AutoTokenizer,
  RawAudio,
  StyleTextToSpeech2Model,
  Tensor,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type ProgressCallback,
} from "@huggingface/transformers";
import { phonemize } from "./phonemize.ts";
import { getVoiceData, getVoicesForModel } from "./voices.ts";
import type {
  KokoroModelId,
  RuntimeDevice,
  TransformersDtype,
  VoiceMetadata,
  WordTokenSpan,
} from "../types/tts";

const STYLE_DIM = 256;
export const KOKORO_SAMPLE_RATE = 24000;
const MAX_STYLE_INDEX = 509;

export interface KokoroLoadOptions {
  dtype?: TransformersDtype;
  modelFileName?: string;
  device?: RuntimeDevice;
  progressCallback?: ProgressCallback;
}

export interface KokoroGenerateResult {
  audio: RawAudio;
  tokens?: string[];
  durations?: Float32Array;
  phonemes?: string;
  wordTokenSpans?: Array<WordTokenSpan | null>;
}

export class KokoroTTS {
  readonly modelId: KokoroModelId;
  private model: PreTrainedModel;
  private tokenizer: PreTrainedTokenizer;
  readonly voices: Record<string, VoiceMetadata>;

  constructor(
    modelId: KokoroModelId,
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizer,
  ) {
    this.modelId = modelId;
    this.model = model;
    this.tokenizer = tokenizer;
    this.voices = getVoicesForModel(modelId);
  }

  static async fromPretrained(
    modelId: KokoroModelId,
    {
      dtype = "fp32",
      modelFileName = "model",
      device = "wasm",
      progressCallback,
    }: KokoroLoadOptions = {},
  ): Promise<KokoroTTS> {
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(modelId, {
        dtype,
        model_file_name: modelFileName,
        device,
        progress_callback: progressCallback,
      }),
      AutoTokenizer.from_pretrained(modelId, {
        progress_callback: progressCallback,
      }),
    ]);

    return new KokoroTTS(modelId, model, tokenizer);
  }

  async generate(
    text: string,
    { voice = "af_heart", speed = 1 }: { voice?: string; speed?: number } = {},
  ): Promise<KokoroGenerateResult> {
    const resolvedVoice = Object.prototype.hasOwnProperty.call(
      this.voices,
      voice,
    )
      ? voice
      : Object.keys(this.voices)[0];

    const language: "a" | "b" = resolvedVoice.startsWith("b") ? "b" : "a";
    const phonemes = await phonemize(text, language);
    if (!phonemes) {
      return {
        audio: new RawAudio(new Float32Array(0), KOKORO_SAMPLE_RATE),
      };
    }

    const { input_ids } = this.tokenizer(phonemes, {
      truncation: true,
    });

    const tokenIds = Array.from(
      input_ids.data as ArrayLike<number | bigint>,
      (value) => Number(value),
    );
    const tokens = this.tokenizer.model.convert_ids_to_tokens(tokenIds);

    const seqLen = Number(input_ids.dims.at(-1) ?? 2);
    const numTokens = Math.min(Math.max(seqLen - 2, 0), MAX_STYLE_INDEX);

    const voiceDataFull = await getVoiceData(this.modelId, resolvedVoice);
    const maxAvailableIndex = Math.max(
      0,
      Math.floor(voiceDataFull.length / STYLE_DIM) - 1,
    );
    const safeTokens = Math.min(numTokens, maxAvailableIndex);
    const offset = safeTokens * STYLE_DIM;
    const voiceSlice = voiceDataFull.slice(offset, offset + STYLE_DIM);

    const inputs = {
      input_ids,
      style: new Tensor("float32", voiceSlice, [1, STYLE_DIM]),
      speed: new Tensor("float32", [speed], [1]),
    };

    const output = (await this.model(inputs)) as {
      waveform: Tensor;
      durations?: Tensor;
    };
    const samples =
      output.waveform.data instanceof Float32Array
        ? output.waveform.data
        : Float32Array.from(output.waveform.data as ArrayLike<number>);

    const durations = output.durations
      ? output.durations.data instanceof Float32Array
        ? output.durations.data
        : Float32Array.from(output.durations.data as ArrayLike<number>)
      : undefined;

    return {
      audio: new RawAudio(samples, KOKORO_SAMPLE_RATE),
      tokens,
      durations,
      phonemes,
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.model.dispose();
    } catch (e) {
      console.warn("Error disposing previous Kokoro model session:", e);
    }
  }
}
