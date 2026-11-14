# Neural Readalong — WebGPU/WASM TTS Studio (Kokoro-82M v1.0 & Paradee-8M v1.3)

## Overview

**Neural Readalong** is a 100% client-side **Next.js + TypeScript** text-to-speech application running entirely inside a browser Web Worker via **WebGPU** or **WebAssembly (WASM)**. Every supported engine produces **native per-token neural duration frames** (`600` samples / `25ms` at `24 kHz`) for lag-free, frame-accurate live word highlighting.

## Supported Timestamped Engines

1. **[`onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped)** *(Default)*
   - **82M parameters** • **28 English voices** (American & British)
   - Reads native `durations` + `waveform` outputs directly from ONNX
   - Supports all **8 ONNX quantizations** (`fp32`, `fp16`, `q8`, `q8f16`, `uint8`, `uint8f16`, `q4`, `q4f16`) plus `auto` (`86–326 MB`)
2. **[`sahilmahendrakar/Paradee-8M-v1.3`](https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3)** *(Multilingual)*
   - **7.88M parameters** distilled from Kokoro-82M (~62× realtime on a single CPU thread)
   - **8 voices across 4 languages**: American English (`af_heart`, `am_puck`), British English (`bf_isabella`, `bm_fable`), Hindi (`hf_alpha`, `hm_omega`), French (`ff_siwis`), and Spanish (`em_alex`)
   - Exposes exact rounded per-token frame durations via zero-copy ONNX `GraphProto` output patching (`"/Clip_output_0"`) and runs Misaki English IPA conversion + Paradee's Apache-2.0 neural multilingual G2P (`g2p.onnx` + `g2p.json.gz`)
   - Supports **INT8** (`onnx/paradee_int8.onnx`, **8.5 MB**) and **FP32** (`onnx/paradee.onnx`, **35 MB**) plus `auto`

> Non-timestamped legacy Kokoro repositories (`Kokoro-82M-v1.0-ONNX` and `Kokoro-82M-ONNX`) have been removed so all synthesis uses genuine neural duration alignment.

## Features

- **Dual-Engine Studio UI**: Switch seamlessly between Kokoro-82M v1.0 and Paradee-8M v1.3, pick multilingual sample scripts (English, हिन्दी, Français, Español, or Hemingway), and clear cached browser models (`transformers-cache` & `kokoro-voices`) in one click.
- **Exact Neural Word-Break Highlighting**: Synchronizes word spans directly against `AudioContext.currentTime` with lookahead scheduling, auto-scrolls long passages, and exports `{ text, modelId, quantization, voice, words: [{ text, startMs, endMs }] }` JSON transcripts.
- **WebGPU & WASM Execution**: Auto-detects WebGPU with automatic WASM fallback, or lets you explicitly select execution devices.
- **WAV Audio Download**: Streams 24 kHz 32-bit float WAV audio directly to disk via the File System Access API (with automatic browser download fallback).

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in a modern browser (Chromium-based browsers recommended for WebGPU acceleration).

## Scripts

- `npm run dev` — Start the Next.js development server
- `npm run build` — Create an optimized production build
- `npm start` — Start the Next.js production server
- `npm run typecheck` — Run TypeScript type checking (`tsc --noEmit`)
- `npm test` — Run unit and live ONNX synthesis tests for Kokoro quantization, Paradee-8M v1.3, and word-break alignment

## License

Apache 2.0 License.

## Acknowledgments

- [Kokoro-82M](https://github.com/hexgrad/kokoro) & [onnx-community/Kokoro-82M-v1.0-ONNX-timestamped](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped)
- [Paradee-8M v1.3](https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3) & [sahilmahendrakar/paradee](https://github.com/sahilmahendrakar/paradee)
- [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js)
- [Kokoro for TTS and word timestamps by Ryan Welch](https://ryanwelch.co.uk/blog/kokoro-word-timestamps/)
