import { env } from "@huggingface/transformers";
import * as ort from "onnxruntime-web";
import { phonemize as espeakng } from "phonemizer";
import { normalizeText } from "./phonemize.ts";
import { segmentTextIntoWords } from "./word-timestamps.ts";
import type { ModelLoadProgressPayload } from "../types/tts";

export type ParadeeMultilingualCode = "hi" | "fr" | "es";

export const PARADEE_CACHE_NAME = "transformers-cache";

const PARADEE_G2P_BASE_URL =
  "https://raw.githubusercontent.com/sahilmahendrakar/paradee/main/paradee/data";
const PARADEE_G2P_DATA_URL = `${PARADEE_G2P_BASE_URL}/g2p.json.gz`;
const PARADEE_G2P_MODEL_URL = `${PARADEE_G2P_BASE_URL}/g2p.onnx`;

const MAX_G2P_WORD_CHARS = 60;

const PERCENT_WORDS: Readonly<Record<ParadeeMultilingualCode, string>> = {
  hi: "प्रतिशत",
  fr: "pour cent",
  es: "por ciento",
};

const DEVANAGARI_DIGIT_MAP: Readonly<Record<string, string>> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

const E2M_RULES: ReadonlyArray<readonly [string, string]> = [
  ["ʔˌn̩", "ʔn"],
  ["ʔn̩", "ʔn"],
  ["aɪ", "I"],
  ["aʊ", "W"],
  ["dʒ", "ʤ"],
  ["eɪ", "A"],
  ["e", "A"],
  ["tʃ", "ʧ"],
  ["ɔɪ", "Y"],
  ["ʲo", "jo"],
  ["ʲə", "jə"],
  ["ʲ", ""],
  ["ɚ", "əɹ"],
  ["r", "ɹ"],
  ["x", "k"],
  ["ç", "k"],
  ["ɬ", "l"],
  ["̃", ""],
];

/**
 * Converts eSpeak-NG English IPA into the exact Misaki/Kokoro phoneme alphabet
 * expected by `sahilmahendrakar/Paradee-8M-v1.3` (`af_heart`, `am_puck`, `bf_isabella`, `bm_fable`).
 * Ported from official `sahilmahendrakar/paradee/web/misaki.js` (Apache-2.0).
 */
export function toMisaki(ps: string, british = false): string {
  let out = ps;
  if (british) {
    out = out.split("eə").join("ɛː");
  }
  for (const [src, dst] of E2M_RULES) {
    out = out.split(src).join(dst);
  }
  out = out.replace(/(\S)̩/gu, "ᵊ$1").replace(/̩/g, "");
  out = out.replace(/əl(?=[\s;:,.!?—…"“”()]|$)/gu, "ᵊl");
  out = british
    ? out.replace(/ɐ(?!n?(?:[\s;:,.!?—…"“”()]|$))/gu, "ə")
    : out.replace(/ɐ(?![\s;:,.!?—…"“”()]|$)/gu, "ə");
  if (british) {
    out = out.split("iə").join("ɪə").split("əʊ").join("Q");
    out = out.replace(/(^|\s)ðɪ(?=\s|$)/gu, "$1ði");
  } else {
    out = out
      .split("oʊ")
      .join("O")
      .split("ɜːɹ")
      .join("ɜɹ")
      .split("ɜː")
      .join("ɜɹ")
      .split("ɪə")
      .join("iə")
      .split("ː")
      .join("");
  }
  out = out.split("o").join("ɔ");
  return out.split("ɾ").join("T").split("ʔ").join("t");
}

export function normalizeParadeeEnglishText(text: string): string {
  return normalizeText(text).replace(/«/g, "(").replace(/»/g, ")");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ENGLISH_PUNCTUATION = ';:,.!?¡¿—…"()“”{}[]';
const ENGLISH_PUNCTUATION_PATTERN = new RegExp(
  `(\\s*[${escapeRegExp(ENGLISH_PUNCTUATION)}]+\\s*)+`,
  "g",
);

function splitKeepingDelimiters(
  text: string,
  regex: RegExp,
): Array<{ match: boolean; text: string }> {
  const result: Array<{ match: boolean; text: string }> = [];
  let prev = 0;
  for (const match of text.matchAll(regex)) {
    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;
    if (prev < matchIndex) {
      result.push({ match: false, text: text.slice(prev, matchIndex) });
    }
    if (fullMatch.length > 0) {
      result.push({ match: true, text: fullMatch });
    }
    prev = matchIndex + fullMatch.length;
  }
  if (prev < text.length) {
    result.push({ match: false, text: text.slice(prev) });
  }
  return result;
}

/**
 * Phonemizes American (`british = false`) or British (`british = true`) English text
 * for `Paradee-8M-v1.3` using `espeak-ng` WASM + `toMisaki`.
 */
export async function phonemizeParadeeEnglish(
  rawText: string,
  british = false,
): Promise<string> {
  const text = normalizeParadeeEnglishText(rawText);
  if (!text) return "";

  const sections = splitKeepingDelimiters(text, ENGLISH_PUNCTUATION_PATTERN);
  // Note: phonemizer's bundled WASM exposes "en-us" (American) and "en" (British RP).
  const espeakVoice = british ? "en" : "en-us";

  const parts: string[] = [];
  for (const section of sections) {
    if (section.match) {
      parts.push(section.text);
    } else {
      const ipaLines = await espeakng(section.text, espeakVoice);
      parts.push(ipaLines.join(" "));
    }
  }

  return toMisaki(
    parts
      .join("")
      .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
      .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
      .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
      .replace(/ z(?=[;:,.!?¡¿—…"()“” ]|$)/g, "z"),
    british,
  ).trim();
}

const IN_MEMORY_FETCH_CACHE = new Map<string, Promise<Uint8Array>>();

export function ensureOrtWebConfigured(): void {
  if (ort.env?.wasm) {
    const isNodeRuntime =
      typeof process !== "undefined" && Boolean(process.versions?.node);
    const isServiceWorker =
      typeof ServiceWorkerGlobalScope !== "undefined" &&
      typeof self !== "undefined" &&
      self instanceof ServiceWorkerGlobalScope;
    if (!isNodeRuntime && !isServiceWorker && !ort.env.wasm.wasmPaths) {
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${env.version}/dist/`;
    }
    ort.env.wasm.proxy = false;
  }
}

let sessionCreationChain: Promise<unknown> = Promise.resolve();
let sessionRunChain: Promise<unknown> = Promise.resolve();

export async function createSerializedOrtSession(
  modelBytes: Uint8Array,
  options: ort.InferenceSession.SessionOptions,
): Promise<ort.InferenceSession> {
  ensureOrtWebConfigured();
  const next = sessionCreationChain.then(
    () => ort.InferenceSession.create(modelBytes, options),
    () => ort.InferenceSession.create(modelBytes, options),
  );
  sessionCreationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function runSerializedOrtSession(
  session: ort.InferenceSession,
  feeds: ort.InferenceSession.FeedsType,
): Promise<ort.InferenceSession.ReturnType> {
  const isNodeRuntime =
    typeof process !== "undefined" && Boolean(process.versions?.node);
  if (isNodeRuntime) {
    return session.run(feeds);
  }
  const next = sessionRunChain.then(
    () => session.run(feeds),
    () => session.run(feeds),
  );
  sessionRunChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function fetchCachedBytes(
  url: string,
  options: {
    cacheName?: string;
    fileLabel?: string;
    progressCallback?: (info: ModelLoadProgressPayload) => void;
  } = {},
): Promise<Uint8Array> {
  const {
    cacheName = PARADEE_CACHE_NAME,
    fileLabel = url.split("/").pop() ?? "model",
    progressCallback,
  } = options;

  let cache: Cache | undefined;
  if (typeof caches !== "undefined") {
    try {
      cache = await caches.open(cacheName);
      const cached = await cache.match(url);
      if (cached) {
        const buf = new Uint8Array(await cached.arrayBuffer());
        progressCallback?.({
          file: fileLabel,
          loaded: buf.byteLength,
          total: buf.byteLength,
          progress: 100,
        });
        return buf;
      }
    } catch (err) {
      console.warn("Unable to read from browser Cache Storage:", err);
    }
  } else {
    const pending = IN_MEMORY_FETCH_CACHE.get(url);
    if (pending) {
      const buf = await pending;
      progressCallback?.({
        file: fileLabel,
        loaded: buf.byteLength,
        total: buf.byteLength,
        progress: 100,
      });
      return buf;
    }
  }

  const downloadPromise = (async (): Promise<Uint8Array> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url} (${response.status} ${response.statusText})`,
      );
    }

    const contentLengthHeader = response.headers.get("content-length");
    const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : 0;

    let bytes: Uint8Array;
    if (response.body && totalBytes > 0 && progressCallback) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          loaded += value.byteLength;
          progressCallback({
            file: fileLabel,
            loaded,
            total: totalBytes,
            progress: (loaded / totalBytes) * 100,
          });
        }
      }

      bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 0) {
        progressCallback?.({
          file: fileLabel,
          loaded: bytes.byteLength,
          total: bytes.byteLength,
          progress: 100,
        });
      }
    }

    if (cache) {
      try {
        const headers = new Headers(response.headers);
        headers.set("content-length", String(bytes.byteLength));
        await cache.put(
          url,
          new Response(bytes.slice().buffer, {
            status: 200,
            statusText: "OK",
            headers,
          }),
        );
      } catch (err) {
        console.warn("Unable to write to browser Cache Storage:", err);
      }
    }

    return bytes;
  })();

  if (typeof caches === "undefined") {
    IN_MEMORY_FETCH_CACHE.set(url, downloadPromise);
    downloadPromise.catch(() => {
      IN_MEMORY_FETCH_CACHE.delete(url);
    });
  }

  return downloadPromise;
}

async function gunzipJson<T>(compressed: Uint8Array): Promise<T> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream('gzip') is not supported in this runtime.");
  }
  const stream = new Blob([compressed.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return (await new Response(stream).json()) as T;
}

const EDGE_CHAR_RE = /^[\p{P}\p{S}\p{Z}\u200B\u200C\u200D\uFEFF]$/u;
const ALNUM_CHAR_RE = /[\p{L}\p{N}]/u;

function stripWordEdges(word: string): {
  lead: string;
  core: string;
  trail: string;
} {
  const chars = Array.from(word);
  let start = 0;
  let end = chars.length;
  while (start < end && EDGE_CHAR_RE.test(chars[start])) {
    start++;
  }
  while (end > start && EDGE_CHAR_RE.test(chars[end - 1])) {
    end--;
  }
  const core = chars.slice(start, end).join("");
  if (!core || !ALNUM_CHAR_RE.test(core)) {
    return { lead: word, core: "", trail: "" };
  }
  return {
    lead: chars.slice(0, start).join(""),
    core,
    trail: chars.slice(end).join(""),
  };
}

function unstress(phonemes: string): string {
  return phonemes.replace(/[ˈˌ]/g, "");
}

export function verbalizeHindiNumber(
  n: number,
  table: Readonly<Record<string, string>>,
): string[] {
  if (n < 100) {
    return [table[String(n)]];
  }
  const out: string[] = [];
  const scales: ReadonlyArray<readonly [number, string]> = [
    [10_000_000, "crore"],
    [100_000, "lakh"],
    [1_000, "thousand"],
  ];
  let rem = n;
  for (const [div, name] of scales) {
    if (rem >= div) {
      out.push(...verbalizeHindiNumber(Math.floor(rem / div), table), table[name]);
      rem %= div;
    }
  }
  if (rem >= 100) {
    out.push(table[String(Math.floor(rem / 100) * 100)]);
    rem %= 100;
  }
  if (rem > 0) {
    out.push(table[String(rem)]);
  }
  return out;
}

export function verbalizeFrenchNumber(
  n: number,
  table: Readonly<Record<string, string>>,
  top = true,
): string[] {
  const out: string[] = [];
  let rem = n;
  const bigScales: ReadonlyArray<readonly [number, string, string]> = [
    [1_000_000_000, "milliard", "milliards"],
    [1_000_000, "million", "millions"],
  ];
  for (const [div, singular, plural] of bigScales) {
    if (rem >= div) {
      const q = Math.floor(rem / div);
      if (q === 1) {
        out.push("œ̃");
      } else {
        out.push(...verbalizeFrenchNumber(q, table, false));
      }
      out.push(table[q === 1 ? singular : plural]);
      rem %= div;
    }
  }
  if (rem >= 1_000) {
    const q = Math.floor(rem / 1_000);
    if (q !== 1) {
      out.push(...verbalizeFrenchNumber(q, table, false));
    }
    out.push(table.thousand);
    rem %= 1_000;
  }
  if (rem >= 100) {
    out.push(table[String(Math.floor(rem / 100) * 100)]);
    rem %= 100;
  }
  if (rem > 0 || out.length === 0) {
    out.push(table[String(rem)]);
  }
  if (top && out.length > 1) {
    for (let i = 0; i < out.length - 1; i++) {
      out[i] = unstress(out[i]);
    }
  }
  return out;
}

export function verbalizeSpanishNumber(
  n: number,
  table: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  let rem = n;
  if (rem >= 1_000_000) {
    const q = Math.floor(rem / 1_000_000);
    if (q === 1) {
      out.push(table["millón"]);
    } else {
      out.push(...verbalizeSpanishNumber(q, table), table.millones);
    }
    rem %= 1_000_000;
  }
  if (rem >= 1_000) {
    const q = Math.floor(rem / 1_000);
    if (q === 1) {
      out.push(table.thousand);
    } else {
      const parts = verbalizeSpanishNumber(q, table);
      if (
        q % 10 === 1 &&
        q % 100 !== 11 &&
        parts.length > 0 &&
        parts[parts.length - 1].endsWith("o")
      ) {
        parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1);
      }
      out.push(...parts, table.thousand);
    }
    rem %= 1_000;
  }
  if (rem >= 100) {
    const hundreds = Math.floor(rem / 100) * 100;
    rem %= 100;
    out.push(hundreds === 100 && rem > 0 ? table["100+"] : table[String(hundreds)]);
  }
  if (rem > 0 || out.length === 0) {
    out.push(table[String(rem)]);
  }
  return out;
}

const SPANISH_SOFT_CONSONANTS: Readonly<Record<string, string>> = {
  b: "β",
  d: "ð",
  ɡ: "ɣ",
};

export function softenSpanishInitial(phonemes: string, before: string): string {
  const chars = Array.from(phonemes);
  let i = 0;
  while (i < chars.length && (chars[i] === "ˈ" || chars[i] === "ˌ")) {
    i++;
  }
  const c = chars[i];
  if (
    c &&
    Object.prototype.hasOwnProperty.call(SPANISH_SOFT_CONSONANTS, c) &&
    !"#nmɲŋ".includes(before) &&
    !(c === "d" && before === "l")
  ) {
    chars[i] = SPANISH_SOFT_CONSONANTS[c];
    return chars.join("");
  }
  return phonemes;
}

interface RawG2PJson {
  vocab: {
    in: string[];
    out: string[];
  };
  numbers: Record<ParadeeMultilingualCode, Record<string, string>>;
  lexicon: Record<
    string,
    {
      w: Record<string, string>;
      c: Record<string, string>;
    }
  >;
}

interface CompiledLexicon {
  words: Record<string, string>;
  contextual: Record<string, string>;
}

function translateDevanagariDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => DEVANAGARI_DIGIT_MAP[d] ?? d);
}

/**
 * Neural + lexicon multilingual G2P for `sahilmahendrakar/Paradee-8M-v1.3`
 * supporting Hindi (`hi`), French (`fr`), and Spanish (`es`), faithfully ported
 * from `paradee/g2p.py` (Apache-2.0) while preserving exact per-source-word
 * phoneme attribution for zero-error neural word highlighting.
 */
export class ParadeeMultilingualG2P {
  private static singletonPromise: Promise<ParadeeMultilingualG2P> | null = null;

  private readonly charIndex: Map<string, number>;
  private readonly outVocab: readonly string[];
  private readonly numbers: Record<ParadeeMultilingualCode, Record<string, string>>;
  private readonly lexicon: Map<string, CompiledLexicon>;
  private readonly session: ort.InferenceSession;

  private constructor(data: RawG2PJson, session: ort.InferenceSession) {
    this.charIndex = new Map(data.vocab.in.map((ch, idx) => [ch, idx]));
    this.outVocab = data.vocab.out;
    this.numbers = data.numbers;
    this.lexicon = new Map();
    for (const [lang, entry] of Object.entries(data.lexicon)) {
      this.lexicon.set(lang, {
        words: entry.w,
        contextual: entry.c,
      });
    }
    this.session = session;
  }

  static async getShared(
    progressCallback?: (info: ModelLoadProgressPayload) => void,
  ): Promise<ParadeeMultilingualG2P> {
    if (!this.singletonPromise) {
      this.singletonPromise = (async () => {
        const [gzBytes, onnxBytes] = await Promise.all([
          fetchCachedBytes(PARADEE_G2P_DATA_URL, {
            fileLabel: "g2p.json.gz",
            progressCallback,
          }),
          fetchCachedBytes(PARADEE_G2P_MODEL_URL, {
            fileLabel: "g2p.onnx",
            progressCallback,
          }),
        ]);
        const data = await gunzipJson<RawG2PJson>(gzBytes);
        const isNode =
          typeof process !== "undefined" && Boolean(process.versions?.node);
        const sessionOptions: ort.InferenceSession.SessionOptions = isNode
          ? {}
          : { executionProviders: ["wasm"] };
        const session = await createSerializedOrtSession(onnxBytes, sessionOptions);
        return new ParadeeMultilingualG2P(data, session);
      })().catch((err) => {
        this.singletonPromise = null;
        throw err;
      });
    }
    return this.singletonPromise;
  }

  private verbalizeNumber(
    n: number,
    lang: ParadeeMultilingualCode,
    before = "#",
  ): string {
    const table = this.numbers[lang];
    let parts =
      lang === "hi"
        ? verbalizeHindiNumber(n, table)
        : lang === "fr"
          ? verbalizeFrenchNumber(n, table)
          : verbalizeSpanishNumber(n, table);

    if (lang === "es") {
      const softened: string[] = [];
      for (let k = 0; k < parts.length; k++) {
        const prevSound =
          k === 0
            ? before
            : Array.from(softened[softened.length - 1]).at(-1) ?? "#";
        softened.push(softenSpanishInitial(parts[k], prevSound));
      }
      parts = softened;
    }

    return parts.join(" ");
  }

  private async runModelBatch(
    items: ReadonlyArray<readonly [ParadeeMultilingualCode, string, string, string]>,
  ): Promise<string[]> {
    if (items.length === 0) return [];

    const unk = this.charIndex.get("<unk>") ?? 0;
    const s1 = this.charIndex.get("<s1>") ?? unk;
    const s2 = this.charIndex.get("<s2>") ?? unk;

    const rows: number[][] = items.map(([lang, before, word, after]) => {
      const langId = this.charIndex.get(`<${lang}>`) ?? unk;
      const beforeId = this.charIndex.get(before) ?? unk;
      const afterId = this.charIndex.get(after) ?? unk;
      const wordChars = Array.from(word.toLowerCase()).slice(0, MAX_G2P_WORD_CHARS);
      return [
        langId,
        beforeId,
        s1,
        ...wordChars.map((ch) => this.charIndex.get(ch) ?? unk),
        s2,
        afterId,
      ];
    });

    const batchSize = rows.length;
    const maxLen = rows.reduce((acc, row) => Math.max(acc, row.length), 0);
    const charsData = new BigInt64Array(batchSize * maxLen);
    const padData = new Uint8Array(batchSize * maxLen);
    padData.fill(1);

    for (let i = 0; i < batchSize; i++) {
      const row = rows[i];
      const base = i * maxLen;
      for (let j = 0; j < row.length; j++) {
        charsData[base + j] = BigInt(row[j]);
        padData[base + j] = 0;
      }
    }

    const charsTensor = new ort.Tensor("int64", charsData, [batchSize, maxLen]);
    const padTensor = new ort.Tensor("bool", padData, [batchSize, maxLen]);
    const outputs = await runSerializedOrtSession(this.session, {
      chars: charsTensor,
      pad: padTensor,
    });
    const bestTensor = outputs.best ?? Object.values(outputs)[0];
    const bestData = bestTensor.data as ArrayLike<number | bigint>;
    const stride = Number(bestTensor.dims[1] ?? maxLen * 3);

    const decoded: string[] = [];
    for (let i = 0; i < batchSize; i++) {
      const rowLen = rows[i].length;
      const steps = Math.min(stride, 3 * rowLen);
      const base = i * stride;
      const outChars: string[] = [];
      let prev = 0;
      for (let s = 0; s < steps; s++) {
        const k = Number(bestData[base + s]);
        if (k !== prev && k !== 0) {
          outChars.push(this.outVocab[k] ?? "");
        }
        prev = k;
      }
      decoded.push(outChars.join(""));
    }

    return decoded;
  }

  private async lookupOrPredictWords(
    lang: ParadeeMultilingualCode,
    items: ReadonlyArray<readonly [string, string, string]>,
  ): Promise<string[]> {
    if (items.length === 0) return [];
    const lex = this.lexicon.get(lang);
    const results: Array<string | null> = items.map(([word, before, after]) => {
      if (!lex) return null;
      const ctxKey = `${word}\t${before}\t${after}`;
      if (Object.prototype.hasOwnProperty.call(lex.contextual, ctxKey)) {
        return lex.contextual[ctxKey];
      }
      if (Object.prototype.hasOwnProperty.call(lex.words, word)) {
        return lex.words[word];
      }
      return null;
    });

    const missingIndices: number[] = [];
    const modelInputs: Array<readonly [ParadeeMultilingualCode, string, string, string]> = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i] === null) {
        missingIndices.push(i);
        const [word, before, after] = items[i];
        modelInputs.push([lang, before, word, after]);
      }
    }

    if (modelInputs.length > 0) {
      const predicted = await this.runModelBatch(modelInputs);
      for (let k = 0; k < missingIndices.length; k++) {
        results[missingIndices[k]] = predicted[k];
      }
    }

    return results.map((r) => r ?? "");
  }

  /**
   * Phonemizes `text` in `lang` (`"hi" | "fr" | "es"`) while tracking the exact
   * phoneme output produced for each whitespace-delimited source word in
   * `segmentTextIntoWords(text)`.
   */
  async phonemizeWords(
    text: string,
    lang: ParadeeMultilingualCode,
  ): Promise<{ phonemes: string; wordPhonemes: string[] }> {
    const { segments } = segmentTextIntoWords(text);
    const wordSegs = segments.filter((s) => s.type === "word");
    if (wordSegs.length === 0) {
      return { phonemes: "", wordPhonemes: [] };
    }

    interface ExpandedToken {
      raw: string;
      sourceIndices: number[];
    }

    // Build G2P tokens while keeping exact mapping back to `wordSegs` indices (0..W-1)
    const expandedTokens: ExpandedToken[] = [];
    let w = 0;
    while (w < wordSegs.length) {
      let cleaned = translateDevanagariDigits(wordSegs[w].text)
        .replace(/«/g, "“")
        .replace(/»/g, "”")
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

      // French space-grouped numbers: e.g. "12" + "000" -> "12000"
      if (lang === "fr" && /^\d{1,3}$/.test(cleaned)) {
        const mergedIndices = [w];
        let digits = cleaned;
        let trailing = "";
        let next = w + 1;
        while (next < wordSegs.length) {
          const nextClean = translateDevanagariDigits(wordSegs[next].text)
            .replace(/«/g, "“")
            .replace(/»/g, "”")
            .replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
          const match = /^(\d{3})([^\p{L}\p{N}]*)$/u.exec(nextClean);
          if (!match) break;
          digits += match[1];
          trailing = match[2];
          mergedIndices.push(next);
          next++;
          if (trailing) break;
        }
        if (mergedIndices.length > 1) {
          w = next;
          // Check if trailing or next standalone token is "%"
          if (trailing.startsWith("%")) {
            expandedTokens.push({ raw: digits, sourceIndices: mergedIndices });
            for (const pctPart of PERCENT_WORDS[lang].split(" ")) {
              expandedTokens.push({
                raw: pctPart,
                sourceIndices: [mergedIndices[mergedIndices.length - 1]],
              });
            }
            if (trailing.length > 1) {
              expandedTokens[expandedTokens.length - 1].raw += trailing.slice(1);
            }
          } else {
            expandedTokens.push({
              raw: digits + trailing,
              sourceIndices: mergedIndices,
            });
          }
          continue;
        }
      }

      // Standalone "%" right after a number word: e.g. "98 %" -> word w+1 speaks PERCENT_WORDS[lang]
      if (
        cleaned.startsWith("%") &&
        w > 0 &&
        /\d$/.test(translateDevanagariDigits(wordSegs[w - 1].text))
      ) {
        const rest = cleaned.slice(1);
        const pctWords = PERCENT_WORDS[lang].split(" ");
        pctWords.forEach((pw, idx) => {
          expandedTokens.push({
            raw: idx === pctWords.length - 1 ? pw + rest : pw,
            sourceIndices: [w],
          });
        });
        w++;
        continue;
      }

      // Attached "12%" or Hindi danda without space ("नमस्ते।आज")
      cleaned = cleaned
        .replace(/([।॥])(?=\S)/g, "$1 ")
        .replace(/(\d)\s?%/g, `$1 ${PERCENT_WORDS[lang]}`);

      const subRaws = cleaned.split(/\s+/).filter((s) => s.length > 0);
      if (subRaws.length === 0) {
        expandedTokens.push({ raw: "", sourceIndices: [w] });
      } else {
        for (const sub of subRaws) {
          expandedTokens.push({ raw: sub, sourceIndices: [w] });
        }
      }
      w++;
    }

    const strippedEntries = expandedTokens.map((tok) => {
      if (!tok.raw) {
        return { lead: "", core: "", trail: "", hasLead: true, hasTrail: true };
      }
      const { lead, core, trail } = stripWordEdges(tok.raw);
      if (!core) {
        return { lead: tok.raw, core: "", trail: "", hasLead: true, hasTrail: true };
      }
      return {
        lead,
        core,
        trail,
        hasLead: lead.length > 0,
        hasTrail: trail.length > 0,
      };
    });

    const contexts: Array<readonly [string, string] | null> = strippedEntries.map(
      (entry, i) => {
        if (!entry.core) return null;
        const prev = i > 0 ? strippedEntries[i - 1] : null;
        const next =
          i < strippedEntries.length - 1 ? strippedEntries[i + 1] : null;
        const before =
          i === 0 || entry.hasLead || !prev || !prev.core || prev.hasTrail
            ? "#"
            : (Array.from(prev.core).at(-1) ?? "#").toLowerCase();
        const after =
          i === strippedEntries.length - 1 ||
          entry.hasTrail ||
          !next ||
          !next.core ||
          next.hasLead
            ? "#"
            : (Array.from(next.core)[0] ?? "#").toLowerCase();
        return [before, after] as const;
      },
    );

    const jobs: Array<readonly [string, string, string]> = [];
    type PlanPiece =
      | { kind: "text"; value: string }
      | { kind: "job"; index: number };
    const plans: Array<{
      lead: string;
      pieces: PlanPiece[] | null;
      trail: string;
    }> = [];

    for (let i = 0; i < strippedEntries.length; i++) {
      const entry = strippedEntries[i];
      const ctx = contexts[i];
      if (!entry.core || !ctx) {
        plans.push({ lead: entry.lead, pieces: null, trail: "" });
        continue;
      }

      const rawMatches = entry.core.match(/\d+|[^\d]+/g) ?? [];
      const coreParts: Array<{ kind: "number" | "word"; piece: string }> = [];
      for (const m of rawMatches) {
        if (/^\d+$/.test(m)) {
          coreParts.push({ kind: "number", piece: m });
        } else {
          const trimmed = m.replace(/^[-.,/:]+|[-.,/:]+$/g, "");
          if (trimmed && ALNUM_CHAR_RE.test(trimmed)) {
            coreParts.push({ kind: "word", piece: trimmed });
          }
        }
      }

      const planPieces: PlanPiece[] = [];
      for (let p = 0; p < coreParts.length; p++) {
        const { kind, piece } = coreParts[p];
        const isFirst = p === 0;
        const isLast = p === coreParts.length - 1;
        if (kind === "number") {
          if (piece.length < 10) {
            planPieces.push({
              kind: "text",
              value: this.verbalizeNumber(
                parseInt(piece, 10),
                lang,
                isFirst ? ctx[0] : "#",
              ),
            });
          } else {
            const digitsSpoken = Array.from(piece)
              .map((d) => this.verbalizeNumber(parseInt(d, 10), lang, "#"))
              .join(" ");
            planPieces.push({ kind: "text", value: digitsSpoken });
          }
        } else {
          const jobIdx = jobs.length;
          jobs.push([piece, isFirst ? ctx[0] : "#", isLast ? ctx[1] : "#"]);
          planPieces.push({ kind: "job", index: jobIdx });
        }
      }

      plans.push({
        lead: entry.lead,
        pieces: planPieces,
        trail: entry.trail,
      });
    }

    const resolvedJobs = await this.lookupOrPredictWords(lang, jobs);
    const tokenPhonemes = plans.map((plan) => {
      if (plan.pieces === null) {
        return plan.lead.replace(/-/g, "");
      }
      const middle = plan.pieces
        .map((p) => (p.kind === "text" ? p.value : resolvedJobs[p.index]))
        .join(" ");
      return `${plan.lead}${middle}${plan.trail}`.replace(/-/g, "");
    });

    const perWordBuckets: string[][] = Array.from(
      { length: wordSegs.length },
      () => [],
    );

    for (let i = 0; i < expandedTokens.length; i++) {
      const ph = tokenPhonemes[i];
      const indices = expandedTokens[i].sourceIndices;
      if (indices.length === 1) {
        if (ph) perWordBuckets[indices[0]].push(ph);
      } else if (ph) {
        // Distribute multi-word merged French numbers (e.g. "12" + "000" -> "duz mˈil")
        const parts = ph.split(" ").filter(Boolean);
        if (parts.length >= indices.length) {
          for (let k = 0; k < parts.length; k++) {
            const bucketIdx =
              indices[Math.min(indices.length - 1, Math.floor((k * indices.length) / parts.length))];
            perWordBuckets[bucketIdx].push(parts[k]);
          }
        } else {
          // e.g. "1 000" -> "mˈil" (1 spoken word across 2 digit tokens): split characters cleanly
          const chars = Array.from(ph);
          for (let k = 0; k < indices.length; k++) {
            const start = Math.floor((k * chars.length) / indices.length);
            const end = Math.floor(((k + 1) * chars.length) / indices.length);
            const slice = chars.slice(start, end).join("");
            if (slice) perWordBuckets[indices[k]].push(slice);
          }
        }
      }
    }

    const wordPhonemes = perWordBuckets.map((bucket) => bucket.join(" "));
    const phonemes = tokenPhonemes.filter((s) => s.length > 0).join(" ");
    return { phonemes, wordPhonemes };
  }

  async phonemize(text: string, lang: ParadeeMultilingualCode): Promise<string> {
    const { phonemes } = await this.phonemizeWords(text, lang);
    return phonemes;
  }
}
