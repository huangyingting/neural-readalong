import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildChunkAlignment,
  buildDurationWordAlignmentData,
  buildWaveformWordAlignmentData,
  buildWordAlignmentData,
  findActiveWordInChunk,
  segmentTextIntoWords,
  splitTextWithOffsets,
} from "../src/lib/word-timestamps.ts";

describe("word-timestamps & word-break alignment", () => {
  it("matches Ryan Welch's reference character-proportional word timestamp math", () => {
    const sampleText =
      "All around the light is golden and liquid and heavy, like it's just beginning on its second glass of wine.";
    const durationSeconds = 5.3;
    const offsetSeconds = 1.2;

    const words = buildWordAlignmentData(
      sampleText,
      durationSeconds,
      offsetSeconds,
    );

    // Reference calculation from https://ryanwelch.co.uk/blog/kokoro-word-timestamps/
    const chars = Array.from(sampleText);
    const charDuration = durationSeconds / chars.length;

    assert.equal(words[0].text, "All");
    assert.equal(words[0].startMs, Math.round(offsetSeconds * 1000));
    assert.equal(
      words[0].endMs,
      Math.round((offsetSeconds + 3 * charDuration) * 1000),
    );

    const lastWord = words.at(-1)!;
    assert.equal(lastWord.text, "wine.");
    assert.equal(
      lastWord.endMs,
      Math.round((offsetSeconds + durationSeconds) * 1000),
    );

    // Every word's charStart..charEnd must slice back to its exact text
    for (const w of words) {
      assert.equal(sampleText.slice(w.charStart, w.charEnd), w.text);
      assert.ok(w.endMs >= w.startMs);
    }
  });

  it("handles Unicode surrogate pairs (emojis) without drifting UTF-16 charStart/charEnd", () => {
    const text = "Hello ❤️ world 🔥 today!";
    const words = buildWordAlignmentData(text, 2.4, 0);

    assert.deepEqual(
      words.map((w) => w.text),
      ["Hello", "❤️", "world", "🔥", "today!"],
    );
    for (const w of words) {
      assert.equal(text.slice(w.charStart, w.charEnd), w.text);
    }
  });

  it("preserves a 1-to-1 mapping between segmentTextIntoWords and splitTextWithOffsets + buildChunkAlignment on full Hemingway story", () => {
    const storyPath = path.resolve(process.cwd(), "public/end.txt");
    const fullText = fs.readFileSync(storyPath, "utf8");

    const { segments, wordCount } = segmentTextIntoWords(fullText);
    const wordSegments = segments.filter((s) => s.type === "word");
    assert.equal(wordSegments.length, wordCount);
    assert.ok(wordCount > 1000);

    // Reconstructs original text losslessly including all line breaks
    assert.equal(segments.map((s) => s.text).join(""), fullText);

    const spans = splitTextWithOffsets(fullText, 280);
    assert.ok(spans.length > 40);

    let totalSamples = 0;
    let nextWordIdx = 0;
    const sampleRate = 24000;
    const allAlignedWords = [];

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      // Every chunk is an exact slice of fullText and bounded
      assert.equal(fullText.slice(span.charStart, span.charEnd), span.text);
      assert.ok(span.text.length <= 280);

      const fakeSamples = span.text.length * 1400;
      const chunk = buildChunkAlignment({
        chunkIndex: i,
        span,
        chunkSamples: fakeSamples,
        totalSamplesBeforeChunk: totalSamples,
        sampleRate,
        startingWordIndex: nextWordIdx,
      });

      totalSamples += fakeSamples;
      nextWordIdx += chunk.words.length;
      allAlignedWords.push(...chunk.words);
    }

    // Every segmented word in the reader corresponds 1-to-1 with an aligned word
    assert.equal(allAlignedWords.length, wordSegments.length);
    for (let i = 0; i < wordSegments.length; i++) {
      assert.equal(allAlignedWords[i].wordIndex, wordSegments[i].wordIndex);
      assert.equal(allAlignedWords[i].text, wordSegments[i].text);
      assert.equal(allAlignedWords[i].charStart, wordSegments[i].charStart);
      assert.equal(allAlignedWords[i].charEnd, wordSegments[i].charEnd);
    }
  });

  it("does not split prematurely on abbreviations or decimal numbers", () => {
    const text =
      "Dr. Smith paid $9.99 at 3:30 p.m. on Jan. 5th. Then Mrs. Jones arrived!";
    const spans = splitTextWithOffsets(text, 280);
    assert.deepEqual(
      spans.map((s) => s.text),
      [
        "Dr. Smith paid $9.99 at 3:30 p.m. on Jan. 5th.",
        "Then Mrs. Jones arrived!",
      ],
    );
  });

  it("finds active words smoothly without inter-word whitespace flicker", () => {
    const span = { text: "One two three", charStart: 0, charEnd: 13 };
    // 13 chars over 1.3s -> 100ms per char:
    // "One" = 0..300ms, " " = 300..400ms, "two" = 400..700ms, " " = 700..800ms, "three" = 800..1300ms
    const chunk = buildChunkAlignment({
      chunkIndex: 0,
      span,
      chunkSamples: 24000 * 1.3,
      totalSamplesBeforeChunk: 0,
      sampleRate: 24000,
      startingWordIndex: 0,
    });

    assert.equal(findActiveWordInChunk(chunk, 0)?.text, "One");
    assert.equal(findActiveWordInChunk(chunk, 150)?.text, "One");
    // During space at 350ms, keeps "One" highlighted smoothly until "two" begins at 400ms
    assert.equal(findActiveWordInChunk(chunk, 350)?.text, "One");
    assert.equal(findActiveWordInChunk(chunk, 400)?.text, "two");
    assert.equal(findActiveWordInChunk(chunk, 750)?.text, "two");
    assert.equal(findActiveWordInChunk(chunk, 800)?.text, "three");
    assert.equal(findActiveWordInChunk(chunk, 1300)?.text, "three");
  });

  it("strips Kokoro leading/trailing waveform silence and anchors comma pauses so words do not lag", () => {
    const sr = 24000;
    const text = '"Marjorie," Nick said, "it isn\'t fun anymore."';
    // Construct a realistic 3.35s waveform matching Kokoro's acoustic profile:
    // - 0..320ms: leading silence
    // - 320..1460ms: first clause ('"Marjorie," Nick said,')
    // - 1460..1780ms: 320ms silent comma pause valley
    // - 1780..2840ms: second clause ('"it isn\'t fun anymore."')
    // - 2840..3350ms: 510ms trailing silence
    const totalSamples = Math.round(sr * 3.35);
    const samples = new Float32Array(totalSamples);
    const fillSpeech = (startMs: number, endMs: number, amp = 0.12) => {
      const s0 = Math.floor((startMs / 1000) * sr);
      const s1 = Math.min(totalSamples, Math.floor((endMs / 1000) * sr));
      for (let i = s0; i < s1; i++) {
        samples[i] = amp * Math.sin((2 * Math.PI * 200 * i) / sr);
      }
    };
    fillSpeech(320, 1460);
    fillSpeech(1780, 2840);

    const words = buildWaveformWordAlignmentData(text, samples, sr, 0);
    assert.equal(words.length, 7);

    // First word starts near speech onset (~320ms), not 0ms
    assert.ok(
      words[0].startMs >= 290 && words[0].startMs <= 340,
      `Expected first word near 320ms, got ${words[0].startMs}ms`,
    );

    // "said," ends right at the comma pause (~1460ms) and '"it' starts right after (~1780ms)
    const saidWord = words[2];
    const itWord = words[3];
    assert.equal(saidWord.text, "said,");
    assert.equal(itWord.text, '"it');
    assert.ok(
      Math.abs(saidWord.endMs - 1460) <= 30,
      `Expected "said," to end near 1460ms, got ${saidWord.endMs}ms`,
    );
    assert.ok(
      Math.abs(itWord.startMs - 1780) <= 30,
      `Expected '"it' to start near 1780ms after pause, got ${itWord.startMs}ms`,
    );

    // Final word ("anymore.\"") ends near speech offset (~2840ms), NOT lagging to 3350ms!
    const lastWord = words[6];
    assert.equal(lastWord.text, 'anymore."');
    assert.ok(
      lastWord.endMs >= 2820 && lastWord.endMs <= 2870,
      `Expected last word to end near 2840ms instead of 3350ms, got ${lastWord.endMs}ms`,
    );

    // Exact source slice & monotonic timestamps preserved
    for (let i = 0; i < words.length; i++) {
      assert.equal(text.slice(words[i].charStart, words[i].charEnd), words[i].text);
      assert.ok(words[i].endMs >= words[i].startMs);
      if (i > 0) {
        assert.ok(words[i].startMs >= words[i - 1].endMs);
      }
    }
  });

  it("computes exact word timestamps from Kokoro-82M-v1.0-ONNX-timestamped tokens and durations", () => {
    const sr = 24000;
    const text = '"Marjorie," Nick said, "it isn\'t fun anymore."';
    // Exact tokens and predicted durations from onnx-community/Kokoro-82M-v1.0-ONNX-timestamped (80,400 samples = 134 * 600)
    const phonemes = '"mˈɑːɹdʒɚɹi," nˈɪk sˈɛd, "ɪɾ ˌɪzənt fˈʌn ˌɛnɪmˈoːɹ."';
    const tokens = ["$", ...Array.from(phonemes), "$"];
    const durations = new Float32Array([
      13.21, 2.67, 1.61, 2.0, 1.04, 1.48, 2.0, 2.06, 1.99, 2.0, 3.1, 4.82, 1.44,
      1.03, 1.39, 1.04, 1.65, 2.0, 1.95, 2.0, 1.99, 3.08, 2.92, 8.5, 3.96, 1.91,
      1.96, 1.97, 1.15, 1.1, 1.02, 1.74, 2.0, 1.36, 1.05, 1.17, 2.74, 1.38,
      1.99, 1.55, 1.05, 1.01, 1.01, 1.02, 1.99, 2.98, 1.94, 2.38, 1.94, 2.88,
      12.55, 5.56, 1.7, 1.0,
    ]);

    const chunk = buildChunkAlignment({
      chunkIndex: 0,
      span: { text, charStart: 0, charEnd: text.length },
      tokens,
      durations,
      chunkSamples: 80400,
      totalSamplesBeforeChunk: 0,
      sampleRate: sr,
      startingWordIndex: 0,
    });

    assert.deepEqual(
      chunk.words.map((w) => [w.text, w.startMs, w.endMs]),
      [
        ['"Marjorie,"', 400, 950],
        ["Nick", 1025, 1200],
        ["said,", 1250, 1650],
        ['"it', 1850, 1925],
        ["isn't", 1950, 2150],
        ["fun", 2225, 2375],
        ['anymore."', 2400, 3125],
      ],
    );

    // During initial 0..339ms BOS + opening quote silence, no word highlights prematurely
    assert.equal(findActiveWordInChunk(chunk, 100), null);
    assert.equal(findActiveWordInChunk(chunk, 360)?.text, '"Marjorie,"');
    assert.equal(findActiveWordInChunk(chunk, 1860)?.text, '"it');
  });

  it("handles clitic-merged phoneme clusters, currency expansions, and standalone em-dash tokens in duration alignment", () => {
    const sr = 24000;
    // 1. Clitic merge ("In the" -> "ɪnðɪ") + standalone em-dash ("—") + money ("$5" -> "fˈaɪv dˈɑːlɚz")
    const text = "In the — $5!";
    const phonemes = "ɪnðɪ — fˈaɪv dˈɑːlɚz!";
    const tokens = ["$", ...Array.from(phonemes), "$"];
    const durations = new Float32Array(tokens.length).fill(2);
    durations[0] = 10; // 250ms BOS silence
    durations[tokens.length - 1] = 4; // 100ms EOS silence
    const totalFrames = Array.from(durations).reduce(
      (sum, d) => sum + Math.round(d),
      0,
    );

    const words = buildDurationWordAlignmentData(
      text,
      tokens,
      durations,
      totalFrames * 600,
      sr,
      0,
    );

    assert.deepEqual(
      words.map((w) => w.text),
      ["In", "the", "—", "$5!"],
    );
    // "In" = tokens 1..2 ("ɪn" = 4 frames = 250..350ms), "the" = tokens 3..4 ("ðɪ" = 4 frames = 350..450ms)
    assert.equal(words[0].startMs, 250);
    assert.equal(words[0].endMs, 350);
    assert.equal(words[1].startMs, 350);
    assert.equal(words[1].endMs, 450);
    // "—" gets the exact em-dash pause token (token 6 = 500..550ms)
    assert.equal(words[2].startMs, 500);
    assert.equal(words[2].endMs, 550);
    // "$5!" spans both "fˈaɪv" and "dˈɑːlɚz" (600..1250ms)
    assert.equal(words[3].startMs, 600);
    assert.equal(words[3].endMs, 1250);

    for (const w of words) {
      assert.equal(text.slice(w.charStart, w.charEnd), w.text);
    }
  });

  it("aligns Misaki uppercase diphthong/flap symbols (A, I, O, Q, W, Y, T) for Paradee English", () => {
    const sr = 24000;
    const text = "Fly out home, mate!";
    // Misaki phonemes: I=aɪ, W=aʊ, O=oʊ, A=eɪ
    const phonemes = "flˈI ˈWt hˈOm, mˈAt!";
    const tokens = ["$", ...Array.from(phonemes), "$"];
    const durations = new Float32Array(tokens.length).fill(2);
    durations[0] = 8; // 200ms BOS
    durations[14] = 6; // 150ms comma pause
    durations[tokens.length - 1] = 4; // 100ms EOS
    const totalFrames = Array.from(durations).reduce(
      (sum, d) => sum + Math.round(d),
      0,
    );

    const words = buildDurationWordAlignmentData(
      text,
      tokens,
      durations,
      totalFrames * 600,
      sr,
      0,
    );

    assert.deepEqual(
      words.map((w) => w.text),
      ["Fly", "out", "home,", "mate!"],
    );
    // "Fly" = tokens 1..4 ("flˈI", 8 frames = 200..400ms)
    assert.equal(words[0].startMs, 200);
    assert.equal(words[0].endMs, 400);
    // "home," = tokens 10..13 ("hˈOm", 8 frames = 650..850ms), excluding token 14 (150ms comma pause)
    assert.equal(words[2].startMs, 650);
    assert.equal(words[2].endMs, 850);
    assert.equal(words[3].startMs, 1050);
  });

  it("splits Hindi danda (। / ॥) sentences cleanly and maps direct wordTokenSpans for multilingual G2P", () => {
    const hindi = "नमस्ते दुनिया। आज मौसम अच्छा है॥";
    const spans = splitTextWithOffsets(hindi, 200);
    assert.deepEqual(
      spans.map((s) => s.text),
      ["नमस्ते दुनिया।", "आज मौसम अच्छा है॥"],
    );

    // Direct wordTokenSpans alignment for French ("Bonjour — monde!")
    const frText = "Bonjour — monde!";
    const tokens = [
      "$",
      ..."bɔ̃ʒˈuʁ — mˈɔ̃d!",
      "$",
    ];
    const durations = new Float32Array(tokens.length).fill(2);
    durations[0] = 6; // 150ms BOS
    const totalFrames = Array.from(durations).reduce(
      (sum, d) => sum + Math.round(d),
      0,
    );

    const chunk = buildChunkAlignment({
      chunkIndex: 0,
      span: { text: frText, charStart: 0, charEnd: frText.length },
      tokens,
      durations,
      wordTokenSpans: [
        { firstTokenIndex: 1, lastTokenIndex: 7 }, // "bɔ̃ʒˈuʁ"
        null, // standalone "—" resolved via interstitial punctuation token 9
        { firstTokenIndex: 11, lastTokenIndex: 15 }, // "mˈɔ̃d" (excludes trailing '!')
      ],
      chunkSamples: totalFrames * 600,
      totalSamplesBeforeChunk: 0,
      sampleRate: 24000,
      startingWordIndex: 0,
    });

    assert.deepEqual(
      chunk.words.map((w) => [w.text, w.startMs, w.endMs]),
      [
        ["Bonjour", 150, 500],
        ["—", 550, 600],
        ["monde!", 650, 900],
      ],
    );
  });
});
