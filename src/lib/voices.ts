import type { TTSModelId, VoiceMetadata } from "@/types/tts";

export const KOKORO_VOICES: Readonly<Record<string, VoiceMetadata>> =
  Object.freeze({
    af_heart: {
      name: "Heart",
      language: "en-us",
      gender: "Female",
      traits: "❤️",
      targetQuality: "A",
      overallGrade: "A",
    },
    af_alloy: {
      name: "Alloy",
      language: "en-us",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "C",
    },
    af_aoede: {
      name: "Aoede",
      language: "en-us",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "C+",
    },
    af_bella: {
      name: "Bella",
      language: "en-us",
      gender: "Female",
      traits: "🔥",
      targetQuality: "A",
      overallGrade: "A-",
    },
    af_jessica: {
      name: "Jessica",
      language: "en-us",
      gender: "Female",
      targetQuality: "C",
      overallGrade: "D",
    },
    af_kore: {
      name: "Kore",
      language: "en-us",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "C+",
    },
    af_nicole: {
      name: "Nicole",
      language: "en-us",
      gender: "Female",
      traits: "🎧",
      targetQuality: "B",
      overallGrade: "B-",
    },
    af_nova: {
      name: "Nova",
      language: "en-us",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "C",
    },
    af_river: {
      name: "River",
      language: "en-us",
      gender: "Female",
      targetQuality: "C",
      overallGrade: "D",
    },
    af_sarah: {
      name: "Sarah",
      language: "en-us",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "C+",
    },
    af_sky: {
      name: "Sky",
      language: "en-us",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "C-",
    },
    am_adam: {
      name: "Adam",
      language: "en-us",
      gender: "Male",
      targetQuality: "D",
      overallGrade: "F+",
    },
    am_echo: {
      name: "Echo",
      language: "en-us",
      gender: "Male",
      targetQuality: "C",
      overallGrade: "D",
    },
    am_eric: {
      name: "Eric",
      language: "en-us",
      gender: "Male",
      targetQuality: "C",
      overallGrade: "D",
    },
    am_fenrir: {
      name: "Fenrir",
      language: "en-us",
      gender: "Male",
      targetQuality: "B",
      overallGrade: "C+",
    },
    am_liam: {
      name: "Liam",
      language: "en-us",
      gender: "Male",
      targetQuality: "C",
      overallGrade: "D",
    },
    am_michael: {
      name: "Michael",
      language: "en-us",
      gender: "Male",
      targetQuality: "B",
      overallGrade: "C+",
    },
    am_onyx: {
      name: "Onyx",
      language: "en-us",
      gender: "Male",
      targetQuality: "C",
      overallGrade: "D",
    },
    am_puck: {
      name: "Puck",
      language: "en-us",
      gender: "Male",
      targetQuality: "B",
      overallGrade: "C+",
    },
    am_santa: {
      name: "Santa",
      language: "en-us",
      gender: "Male",
      targetQuality: "C",
      overallGrade: "D-",
    },
    bf_emma: {
      name: "Emma",
      language: "en-gb",
      gender: "Female",
      traits: "🚺",
      targetQuality: "B",
      overallGrade: "B-",
    },
    bf_isabella: {
      name: "Isabella",
      language: "en-gb",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "C",
    },
    bm_george: {
      name: "George",
      language: "en-gb",
      gender: "Male",
      targetQuality: "B",
      overallGrade: "C",
    },
    bm_lewis: {
      name: "Lewis",
      language: "en-gb",
      gender: "Male",
      targetQuality: "C",
      overallGrade: "D+",
    },
    bf_alice: {
      name: "Alice",
      language: "en-gb",
      gender: "Female",
      traits: "🚺",
      targetQuality: "C",
      overallGrade: "D",
    },
    bf_lily: {
      name: "Lily",
      language: "en-gb",
      gender: "Female",
      traits: "🚺",
      targetQuality: "C",
      overallGrade: "D",
    },
    bm_daniel: {
      name: "Daniel",
      language: "en-gb",
      gender: "Male",
      traits: "🚹",
      targetQuality: "C",
      overallGrade: "D",
    },
    bm_fable: {
      name: "Fable",
      language: "en-gb",
      gender: "Male",
      traits: "🚹",
      targetQuality: "B",
      overallGrade: "C",
    },
  });

/**
 * Voices supported by `sahilmahendrakar/Paradee-8M-v1.3` in exact `config.json["voices"]` index order (0..7).
 */
export const PARADEE_V1_3_VOICES: Readonly<Record<string, VoiceMetadata>> =
  Object.freeze({
    af_heart: {
      name: "Heart",
      language: "en-us",
      gender: "Female",
      traits: "❤️",
      targetQuality: "A",
      overallGrade: "A",
    },
    bf_isabella: {
      name: "Isabella",
      language: "en-gb",
      gender: "Female",
      targetQuality: "B",
      overallGrade: "B",
    },
    am_puck: {
      name: "Puck",
      language: "en-us",
      gender: "Male",
      targetQuality: "B",
      overallGrade: "B+",
    },
    bm_fable: {
      name: "Fable",
      language: "en-gb",
      gender: "Male",
      traits: "🚹",
      targetQuality: "B",
      overallGrade: "B",
    },
    hf_alpha: {
      name: "Alpha",
      language: "hi",
      gender: "Female",
      traits: "🇮🇳",
      targetQuality: "B",
      overallGrade: "B",
    },
    hm_omega: {
      name: "Omega",
      language: "hi",
      gender: "Male",
      traits: "🇮🇳",
      targetQuality: "B",
      overallGrade: "B",
    },
    ff_siwis: {
      name: "Siwis",
      language: "fr-fr",
      gender: "Female",
      traits: "🇫🇷",
      targetQuality: "B",
      overallGrade: "B+",
    },
    em_alex: {
      name: "Alex",
      language: "es",
      gender: "Male",
      traits: "🇪🇸",
      targetQuality: "B",
      overallGrade: "B+",
    },
  });

export const ALL_VOICES: Readonly<Record<string, VoiceMetadata>> =
  Object.freeze({
    ...KOKORO_VOICES,
    ...PARADEE_V1_3_VOICES,
  });

export function getVoicesForModel(
  modelId: TTSModelId,
): Record<string, VoiceMetadata> {
  if (modelId === "sahilmahendrakar/Paradee-8M-v1.3") {
    return { ...PARADEE_V1_3_VOICES };
  }
  return { ...KOKORO_VOICES };
}

async function getVoiceFile(
  modelId: TTSModelId,
  voiceId: string,
): Promise<ArrayBuffer> {
  const url = `https://huggingface.co/${modelId}/resolve/main/voices/${voiceId}.bin`;

  let cache: Cache | undefined;
  if (typeof caches !== "undefined") {
    try {
      cache = await caches.open("kokoro-voices");
      const cachedResponse = await cache.match(url);
      if (cachedResponse) {
        return await cachedResponse.arrayBuffer();
      }
    } catch (e) {
      console.warn("Unable to open voice cache", e);
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download voice "${voiceId}" (${response.status} ${response.statusText})`,
    );
  }
  const buffer = await response.arrayBuffer();

  if (cache) {
    try {
      await cache.put(
        url,
        new Response(buffer, {
          headers: response.headers,
        }),
      );
    } catch (e) {
      console.warn("Unable to cache voice file", e);
    }
  }

  return buffer;
}

const VOICE_CACHE = new Map<string, Float32Array>();

export async function getVoiceData(
  modelId: TTSModelId,
  voiceId: string,
): Promise<Float32Array> {
  const key = `${modelId}:${voiceId}`;
  const existing = VOICE_CACHE.get(key);
  if (existing) {
    return existing;
  }

  const buffer = new Float32Array(await getVoiceFile(modelId, voiceId));
  VOICE_CACHE.set(key, buffer);
  return buffer;
}
