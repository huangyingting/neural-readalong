import type {
  ConcreteQuantization,
  QuantizationOption,
  QuantizationType,
  ResolvedQuantizationConfig,
  RuntimeDevice,
  TransformersDtype,
  TTSModelId,
} from "@/types/tts";

export const KOKORO_TIMESTAMPED_MODEL_ID: TTSModelId =
  "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
export const PARADEE_V1_3_MODEL_ID: TTSModelId =
  "sahilmahendrakar/Paradee-8M-v1.3";

export interface ModelRepoOption {
  id: TTSModelId;
  label: string;
  shortLabel: string;
  paramsLabel: string;
  voiceSummary: string;
  sizeSummary: string;
  languages: readonly string[];
  description: string;
}

export const MODEL_REPO_OPTIONS: readonly ModelRepoOption[] = [
  {
    id: KOKORO_TIMESTAMPED_MODEL_ID,
    label: "Kokoro-82M v1.0 (Timestamped)",
    shortLabel: "Kokoro-82M v1.0",
    paramsLabel: "82M params",
    voiceSummary: "28 Voices • EN (US/UK)",
    sizeSummary: "86–326 MB • 8 Quantizations",
    languages: ["English (US)", "English (UK)"],
    description:
      "Full StyleTTS2 studio model exporting native per-token durations with 28 English voices and all 8 ONNX quantizations.",
  },
  {
    id: PARADEE_V1_3_MODEL_ID,
    label: "Paradee-8M v1.3 (Multilingual)",
    shortLabel: "Paradee-8M v1.3",
    paramsLabel: "7.88M params",
    voiceSummary: "8 Voices • EN / HI / FR / ES",
    sizeSummary: "8.5 MB INT8 • 35 MB FP32",
    languages: ["English", "Hindi", "French", "Spanish"],
    description:
      "Ultra-compact distilled Kokoro (~62× realtime on CPU) speaking English, Hindi, French & Spanish with native /Clip_output_0 token durations.",
  },
] as const;

interface ConcreteQuantizationSpec {
  id: ConcreteQuantization;
  label: string;
  onnxFile: string;
  approximateSize: string;
  description: string;
  dtype: TransformersDtype;
  modelFileName: string;
  requiresFp16: boolean;
}

/**
 * Maps every ONNX file in https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/tree/main/onnx
 * to the exact `dtype` + `model_file_name` combination expected by `@huggingface/transformers`.
 *
 * Note: `@huggingface/transformers` does not include `q8f16` or `uint8f16` in its built-in
 * `DEFAULT_DTYPE_SUFFIX_MAPPING` (passing them as `dtype` silently falls back to `fp32`/`q8`).
 * Passing `dtype: "fp32"` (empty suffix `""`) with `model_file_name: "model_q8f16"` /
 * `"model_uint8f16"` resolves directly to `onnx/model_q8f16.onnx` and `onnx/model_uint8f16.onnx`.
 */
export const CONCRETE_QUANTIZATION_SPECS: Record<
  ConcreteQuantization,
  ConcreteQuantizationSpec
> = {
  fp32: {
    id: "fp32",
    label: "FP32 (model.onnx • 326 MB)",
    onnxFile: "onnx/model.onnx",
    approximateSize: "326 MB",
    description: "Full 32-bit floating-point precision",
    dtype: "fp32",
    modelFileName: "model",
    requiresFp16: false,
  },
  fp16: {
    id: "fp16",
    label: "FP16 (model_fp16.onnx • 163 MB)",
    onnxFile: "onnx/model_fp16.onnx",
    approximateSize: "163 MB",
    description: "16-bit floating-point half precision",
    dtype: "fp16",
    modelFileName: "model",
    requiresFp16: true,
  },
  q8: {
    id: "q8",
    label: "Q8 (model_quantized.onnx • 92.4 MB)",
    onnxFile: "onnx/model_quantized.onnx",
    approximateSize: "92.4 MB",
    description: "8-bit dynamic quantized weights (recommended for CPU/WASM)",
    dtype: "q8",
    modelFileName: "model",
    requiresFp16: false,
  },
  q8f16: {
    id: "q8f16",
    label: "Q8F16 (model_q8f16.onnx • 86 MB)",
    onnxFile: "onnx/model_q8f16.onnx",
    approximateSize: "86 MB",
    description: "Smallest footprint: 8-bit quantized weights with FP16 activations",
    dtype: "fp32",
    modelFileName: "model_q8f16",
    requiresFp16: true,
  },
  uint8: {
    id: "uint8",
    label: "UINT8 (model_uint8.onnx • 177 MB)",
    onnxFile: "onnx/model_uint8.onnx",
    approximateSize: "177 MB",
    description: "Unsigned 8-bit quantized weights with FP32 activations",
    dtype: "uint8",
    modelFileName: "model",
    requiresFp16: false,
  },
  uint8f16: {
    id: "uint8f16",
    label: "UINT8F16 (model_uint8f16.onnx • 114 MB)",
    onnxFile: "onnx/model_uint8f16.onnx",
    approximateSize: "114 MB",
    description: "Unsigned 8-bit quantized weights with FP16 activations",
    dtype: "fp32",
    modelFileName: "model_uint8f16",
    requiresFp16: true,
  },
  q4: {
    id: "q4",
    label: "Q4 (model_q4.onnx • 305 MB)",
    onnxFile: "onnx/model_q4.onnx",
    approximateSize: "305 MB",
    description: "4-bit block weight quantization with FP32 activations",
    dtype: "q4",
    modelFileName: "model",
    requiresFp16: false,
  },
  q4f16: {
    id: "q4f16",
    label: "Q4F16 (model_q4f16.onnx • 154 MB)",
    onnxFile: "onnx/model_q4f16.onnx",
    approximateSize: "154 MB",
    description: "4-bit block weight quantization with FP16 activations",
    dtype: "q4f16",
    modelFileName: "model",
    requiresFp16: true,
  },
};

export const PARADEE_QUANTIZATION_SPECS: Readonly<
  Record<"q8" | "fp32", ConcreteQuantizationSpec>
> = {
  q8: {
    id: "q8",
    label: "INT8 (paradee_int8.onnx • 8.5 MB)",
    onnxFile: "onnx/paradee_int8.onnx",
    approximateSize: "8.5 MB",
    description: "8-bit quantized single-file graph (recommended default)",
    dtype: "q8",
    modelFileName: "paradee_int8",
    requiresFp16: false,
  },
  fp32: {
    id: "fp32",
    label: "FP32 (paradee.onnx • 35 MB)",
    onnxFile: "onnx/paradee.onnx",
    approximateSize: "35 MB",
    description: "Full 32-bit floating-point single-file graph",
    dtype: "fp32",
    modelFileName: "paradee",
    requiresFp16: false,
  },
};

export const QUANTIZATION_OPTIONS: readonly QuantizationOption[] = [
  {
    id: "auto",
    label: "Auto (FP32 on WebGPU / Q8 on WASM)",
    onnxFile: "auto",
    approximateSize: "92.4–326 MB",
    description: "Automatically selects FP32 for WebGPU or Q8 for WASM",
    requiresFp16: false,
  },
  ...Object.values(CONCRETE_QUANTIZATION_SPECS).map(
    ({ id, label, onnxFile, approximateSize, description, requiresFp16 }) => ({
      id,
      label,
      onnxFile,
      approximateSize,
      description,
      requiresFp16,
    }),
  ),
];

export const PARADEE_QUANTIZATION_OPTIONS: readonly QuantizationOption[] = [
  {
    id: "auto",
    label: "Auto (FP32 on WebGPU / INT8 on WASM)",
    onnxFile: "auto",
    approximateSize: "8.5–35 MB",
    description: "Automatically selects FP32 for WebGPU or 8.5 MB INT8 for WASM",
    requiresFp16: false,
  },
  ...Object.values(PARADEE_QUANTIZATION_SPECS).map(
    ({ id, label, onnxFile, approximateSize, description, requiresFp16 }) => ({
      id,
      label,
      onnxFile,
      approximateSize,
      description,
      requiresFp16,
    }),
  ),
];

export function getQuantizationOptionsForModel(
  modelId: TTSModelId,
): readonly QuantizationOption[] {
  return modelId === PARADEE_V1_3_MODEL_ID
    ? PARADEE_QUANTIZATION_OPTIONS
    : QUANTIZATION_OPTIONS;
}

export function normalizeQuantizationForModel(
  quantization: QuantizationType,
  modelId: TTSModelId,
): QuantizationType {
  if (modelId === PARADEE_V1_3_MODEL_ID) {
    if (quantization === "auto" || quantization === "q8" || quantization === "fp32") {
      return quantization;
    }
    return "auto";
  }
  return quantization;
}

export function resolveQuantizationConfig(
  quantization: QuantizationType,
  device: RuntimeDevice,
  modelId: TTSModelId = KOKORO_TIMESTAMPED_MODEL_ID,
): ResolvedQuantizationConfig {
  const normalized = normalizeQuantizationForModel(quantization, modelId);

  if (modelId === PARADEE_V1_3_MODEL_ID) {
    const paradeeConcrete: "q8" | "fp32" =
      normalized === "auto"
        ? device === "wasm"
          ? "q8"
          : "fp32"
        : normalized === "fp32"
          ? "fp32"
          : "q8";
    const spec = PARADEE_QUANTIZATION_SPECS[paradeeConcrete];
    return {
      quantization: spec.id,
      dtype: spec.dtype,
      modelFileName: spec.modelFileName,
      onnxFile: spec.onnxFile,
      approximateSize: spec.approximateSize,
      requiresFp16: spec.requiresFp16,
    };
  }

  const concrete: ConcreteQuantization =
    normalized === "auto"
      ? device === "wasm"
        ? "q8"
        : "fp32"
      : normalized;

  const spec = CONCRETE_QUANTIZATION_SPECS[concrete];
  return {
    quantization: spec.id,
    dtype: spec.dtype,
    modelFileName: spec.modelFileName,
    onnxFile: spec.onnxFile,
    approximateSize: spec.approximateSize,
    requiresFp16: spec.requiresFp16,
  };
}
