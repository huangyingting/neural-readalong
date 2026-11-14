import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONCRETE_QUANTIZATION_SPECS,
  getQuantizationOptionsForModel,
  KOKORO_TIMESTAMPED_MODEL_ID,
  MODEL_REPO_OPTIONS,
  normalizeQuantizationForModel,
  PARADEE_V1_3_MODEL_ID,
  QUANTIZATION_OPTIONS,
  resolveQuantizationConfig,
} from "../src/lib/quantization.ts";
import { getVoicesForModel } from "../src/lib/voices.ts";
import type { ConcreteQuantization, TransformersDtype } from "../src/types/tts.ts";

// Mirrors @huggingface/transformers DEFAULT_DTYPE_SUFFIX_MAPPING + getCoreModelFile
const TRANSFORMERS_DTYPE_SUFFIX: Record<TransformersDtype, string> = {
  fp32: "",
  fp16: "_fp16",
  uint8: "_uint8",
  q8: "_quantized",
  q4: "_q4",
  q4f16: "_q4f16",
};

function buildTransformersOnnxPath(
  dtype: TransformersDtype,
  modelFileName: string,
): string {
  const suffix = TRANSFORMERS_DTYPE_SUFFIX[dtype];
  return `onnx/${modelFileName}${suffix}.onnx`;
}

describe("Kokoro ONNX quantization support", () => {
  it("supports all 8 ONNX model files in onnx-community/Kokoro-82M-ONNX/tree/main/onnx", () => {
    const expectedOnnxFiles: Record<ConcreteQuantization, string> = {
      fp32: "onnx/model.onnx",
      fp16: "onnx/model_fp16.onnx",
      q4: "onnx/model_q4.onnx",
      q4f16: "onnx/model_q4f16.onnx",
      q8f16: "onnx/model_q8f16.onnx",
      q8: "onnx/model_quantized.onnx",
      uint8: "onnx/model_uint8.onnx",
      uint8f16: "onnx/model_uint8f16.onnx",
    };

    assert.equal(
      Object.keys(CONCRETE_QUANTIZATION_SPECS).length,
      Object.keys(expectedOnnxFiles).length,
    );

    for (const [quant, expectedPath] of Object.entries(expectedOnnxFiles) as [
      ConcreteQuantization,
      string,
    ][]) {
      const resolved = resolveQuantizationConfig(quant, "wasm");
      assert.equal(resolved.onnxFile, expectedPath);

      // Verify that @huggingface/transformers resolves dtype + model_file_name to the exact file
      const actualLoadedPath = buildTransformersOnnxPath(
        resolved.dtype,
        resolved.modelFileName,
      );
      assert.equal(actualLoadedPath, expectedPath);
    }
  });

  it("resolves 'auto' quantization to fp32 on WebGPU and q8 on WASM", () => {
    const webgpuResolved = resolveQuantizationConfig("auto", "webgpu");
    assert.equal(webgpuResolved.quantization, "fp32");
    assert.equal(webgpuResolved.onnxFile, "onnx/model.onnx");

    const wasmResolved = resolveQuantizationConfig("auto", "wasm");
    assert.equal(wasmResolved.quantization, "q8");
    assert.equal(wasmResolved.onnxFile, "onnx/model_quantized.onnx");
  });

  it("exposes auto plus all 8 explicit quantizations in QUANTIZATION_OPTIONS", () => {
    assert.equal(QUANTIZATION_OPTIONS.length, 9);
    assert.equal(QUANTIZATION_OPTIONS[0].id, "auto");
  });

  it("exposes only timestamped Kokoro v1.0 and Paradee-8M v1.3 (non-timestamped Kokoro removed)", () => {
    assert.deepEqual(
      MODEL_REPO_OPTIONS.map((m) => m.id),
      [
        "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped",
        "sahilmahendrakar/Paradee-8M-v1.3",
      ],
    );
  });

  it("resolves Paradee-8M v1.3 INT8 and FP32 ONNX files and normalizes Kokoro-only quantizations", () => {
    const paradeeOpts = getQuantizationOptionsForModel(PARADEE_V1_3_MODEL_ID);
    assert.deepEqual(
      paradeeOpts.map((o) => o.id),
      ["auto", "q8", "fp32"],
    );

    const wasmAuto = resolveQuantizationConfig(
      "auto",
      "wasm",
      PARADEE_V1_3_MODEL_ID,
    );
    assert.equal(wasmAuto.quantization, "q8");
    assert.equal(wasmAuto.onnxFile, "onnx/paradee_int8.onnx");
    assert.equal(wasmAuto.approximateSize, "8.5 MB");

    const webgpuAuto = resolveQuantizationConfig(
      "auto",
      "webgpu",
      PARADEE_V1_3_MODEL_ID,
    );
    assert.equal(webgpuAuto.quantization, "fp32");
    assert.equal(webgpuAuto.onnxFile, "onnx/paradee.onnx");
    assert.equal(webgpuAuto.approximateSize, "35 MB");

    assert.equal(
      normalizeQuantizationForModel("q4f16", PARADEE_V1_3_MODEL_ID),
      "auto",
    );
    assert.equal(
      normalizeQuantizationForModel("q8", PARADEE_V1_3_MODEL_ID),
      "q8",
    );
  });

  it("provides 28 voices for Kokoro v1.0 timestamped and all 8 multilingual voices in model order for Paradee v1.3", () => {
    const kokoroVoices = getVoicesForModel(KOKORO_TIMESTAMPED_MODEL_ID);
    assert.equal(Object.keys(kokoroVoices).length, 28);
    assert.equal("af" in kokoroVoices, false);

    const paradeeVoices = getVoicesForModel(PARADEE_V1_3_MODEL_ID);
    assert.deepEqual(Object.keys(paradeeVoices), [
      "af_heart",
      "bf_isabella",
      "am_puck",
      "bm_fable",
      "hf_alpha",
      "hm_omega",
      "ff_siwis",
      "em_alex",
    ]);
  });
});
