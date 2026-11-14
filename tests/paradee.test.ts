import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PARADEE_DURATIONS_TENSOR, ParadeeTTS, patchOnnxGraphOutput } from "../src/lib/paradee.ts";
import {
  softenSpanishInitial,
  toMisaki,
  verbalizeFrenchNumber,
  verbalizeHindiNumber,
  verbalizeSpanishNumber,
} from "../src/lib/paradee-g2p.ts";
import { PARADEE_V1_3_MODEL_ID } from "../src/lib/quantization.ts";
import { buildChunkAlignment, segmentTextIntoWords } from "../src/lib/word-timestamps.ts";

describe("Paradee-8M v1.3 ONNX patcher, Misaki English & multilingual G2P", () => {
  it("patches ONNX ModelProto GraphProto (field 7) with /Clip_output_0 output (field 12)", () => {
    // Minimal synthetic ModelProto: ir_version = 8 (field 1: 0x08 0x08), graph = { name: "g" (field 1: 0x0a 0x01 'g') }
    const graphBody = new Uint8Array([0x0a, 0x01, 0x67]);
    const modelProto = new Uint8Array([
      0x08,
      0x08,
      (7 << 3) | 2,
      graphBody.length,
      ...graphBody,
    ]);

    const patched = patchOnnxGraphOutput(modelProto, PARADEE_DURATIONS_TENSOR);
    assert.ok(patched.byteLength > modelProto.byteLength);
    const decoded = new TextDecoder().decode(patched);
    assert.ok(decoded.includes("/Clip_output_0"));

    // Idempotent when called a second time for the same output tensor
    const patchedTwice = patchOnnxGraphOutput(patched, PARADEE_DURATIONS_TENSOR);
    assert.equal(patchedTwice.byteLength, patched.byteLength);
  });

  it("patches WebGPU /head/Slice_27 negative-step Slice bug in fp32 paradee.onnx so /head/Mul_41 tensors match", async () => {
    const fp32Tts = await ParadeeTTS.fromPretrained(PARADEE_V1_3_MODEL_ID, {
      dtype: "fp32",
      device: "webgpu",
    });
    try {
      const res = await fp32Tts.generate("Testing WebGPU burst STFT frames.", {
        voice: "af_heart",
        speed: 1.0,
      });
      assert.ok(res.audio.audio.length > 0);
      assert.ok(res.durations && res.durations.length > 0);
      let maxAbs = 0;
      for (let i = 0; i < res.audio.audio.length; i++) {
        const sample = res.audio.audio[i];
        assert.ok(Number.isFinite(sample), "Audio sample must be finite");
        const abs = Math.abs(sample);
        if (abs > maxAbs) maxAbs = abs;
      }
      assert.ok(maxAbs > 0.01, `Expected audible speech peak, got ${maxAbs}`);
    } finally {
      await fp32Tts.dispose();
    }
  });

  it("converts American and British eSpeak IPA into Misaki symbols", () => {
    assert.equal(
      toMisaki("fˈaɪv thˈaʊzənd dˈeɪz əv hˈoʊm", false),
      "fˈIv thˈWzənd dˈAz əv hˈOm",
    );
    assert.equal(
      toMisaki("hˈəʊm fˈeə flˈɒks", true),
      "hˈQm fˈɛː flˈɒks",
    );
    assert.equal(toMisaki("lˈɪɾəl", false), "lˈɪTᵊl");
  });

  it("verbalizes Hindi, French, and Spanish numbers with Spanish consonant softening", () => {
    const hiTable = {
      "0": "ʃˈuːnjə",
      "1": "ˈeːk",
      "5": "pˈɑːntʃ",
      "25": "pəttʃˈiːs",
      "100": "sˈɔː",
      thousand: "həzˈɑːɾ",
      lakh: "lˈɑːkʰ",
      crore: "kəɾˈoːɽ",
    };
    assert.deepEqual(verbalizeHindiNumber(100_025, hiTable), [
      "ˈeːk",
      "lˈɑːkʰ",
      "pəttʃˈiːs",
    ]);

    // French drops stress on all but final word of number ("12 000" -> ["duz", "mˈil"])
    const frTable = {
      "0": "zeʁˈo",
      "12": "dˈuz",
      thousand: "mˈil",
    };
    assert.deepEqual(verbalizeFrenchNumber(12_000, frTable), ["duz", "mˈil"]);

    // Spanish apocopates veintiuno -> veintiún before mil and softens b/d/ɡ after vowels
    const esTable = {
      "0": "θˈeɾo",
      "21": "bˌejntjˈuno",
      "100+": "θjˈento",
      "5": "θˈiŋko",
      thousand: "mˈil",
    };
    assert.deepEqual(verbalizeSpanishNumber(21_105, esTable), [
      "bˌejntjˈun",
      "mˈil",
      "θjˈento",
      "θˈiŋko",
    ]);
    assert.equal(softenSpanishInitial("ˈdos", "a"), "ˈðos");
    assert.equal(softenSpanishInitial("ˈdos", "#"), "ˈdos");
    assert.equal(softenSpanishInitial("ˈdos", "l"), "ˈdos");
  });

  it("synthesizes audio + exact 600-sample /Clip_output_0 word timestamps across English & multilingual Paradee-8M v1.3 voices", async () => {
    const tts = await ParadeeTTS.fromPretrained(PARADEE_V1_3_MODEL_ID, {
      dtype: "q8",
      device: "wasm",
    });

    try {
      const cases = [
        {
          voice: "af_heart",
          text: "Parakeets travel in colorful flocks.",
        },
        {
          voice: "ff_siwis",
          text: "Bonjour à tous, bienvenue en 2025 !",
        },
        {
          voice: "em_alex",
          text: "¡Hola mundo! ¿Dónde están las 12 aves?",
        },
        {
          voice: "hf_alpha",
          text: "नमस्ते दुनिया। आज 25% बढ़ोतरी हुई है।",
        },
      ] as const;

      for (const { voice, text } of cases) {
        const res = await tts.generate(text, { voice, speed: 1.0 });
        assert.ok(res.audio.audio.length > 0, `Expected audio for ${voice}`);
        assert.ok(res.tokens && res.durations, `Expected tokens & durations for ${voice}`);
        assert.equal(res.tokens.length, res.durations.length);

        const totalRoundedFrames = Array.from(res.durations).reduce(
          (acc, d) => acc + Math.round(d),
          0,
        );
        assert.equal(
          totalRoundedFrames * 600,
          res.audio.audio.length,
          `Frame sum * 600 must equal exact waveform sample count for ${voice}`,
        );

        const chunk = buildChunkAlignment({
          chunkIndex: 0,
          span: { text, charStart: 0, charEnd: text.length },
          samples: res.audio.audio,
          tokens: res.tokens,
          durations: res.durations,
          wordTokenSpans: res.wordTokenSpans,
          chunkSamples: res.audio.audio.length,
          totalSamplesBeforeChunk: 0,
          sampleRate: res.audio.sampling_rate,
          startingWordIndex: 0,
        });

        const expectedWords = segmentTextIntoWords(text).segments.filter(
          (s) => s.type === "word",
        );
        assert.equal(chunk.words.length, expectedWords.length);
        for (let i = 0; i < chunk.words.length; i++) {
          assert.equal(chunk.words[i].text, expectedWords[i].text);
          assert.ok(chunk.words[i].endMs >= chunk.words[i].startMs);
          if (i > 0) {
            assert.ok(chunk.words[i].startMs >= chunk.words[i - 1].endMs);
          }
        }
      }
    } finally {
      await tts.dispose();
    }
  });
});
