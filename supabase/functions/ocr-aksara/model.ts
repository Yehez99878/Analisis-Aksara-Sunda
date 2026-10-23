export type RecognitionResult = {
  aksaraTerdeteksi: { aksara: string; latin: string; confidence: number }[];
  transkripsi: string;
  catatan?: string;
};

// Error terstruktur yang membedakan jenis kegagalan agar Edge Function bisa mengembalikan HTTP status dan pesan yang tepat
export class GeminiRecognitionError extends Error {
  statusCode: number; // 429, 502, 400, dll
  userMessage: string;

  constructor(statusCode: number, userMessage: string, technicalDetails: string) {
    super(technicalDetails);
    this.name = "GeminiRecognitionError";
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}

// Model utama dan cadangan (bisa dioverride via Supabase secrets: GEMINI_MODEL dan GEMINI_FALLBACK_MODEL)
// Catatan: Model diuji langsung pada endpoint generativelanguage.googleapis.com
export const DEFAULT_PRIMARY_MODEL = "gemini-3.5-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";

const PROMPT_OCR = `Kamu adalah sistem OCR AI (Optical Character Recognition) spesialis Aksara Sunda baku. Analisis gambar ini secara teliti.

Gambar ini mungkin merupakan tulisan tangan. Harap berhati-hati dengan goresan yang mirip angka Latin.
PENTING: Seringkali tulisan tangan aksara "ka" (ᮊ) bentuknya menyerupai dua garis vertikal yang sekilas mirip angka "77" atau dua angka "1" (᮱᮱). Prioritaskan membacanya sebagai aksara silabis ("ka") daripada angka, terutama jika karakternya berdiri sendiri atau goresannya bersambung.

Tugas kamu:
1. Identifikasi setiap aksara/karakter Sunda yang terlihat beserta padanan Latinnya
2. Transkripsi keseluruhan teks ke dalam huruf Latin
3. Berikan catatan jika ada ambiguitas (misal: "Goresan mirip angka 77, tetapi dalam konteks ini dibaca sebagai 'ka' (ᮊ)")

Berikan jawaban dalam format JSON yang valid seperti ini (tanpa kalimat lain, tanpa markdown code block):
{
  "aksaraTerdeteksi": [
    {"aksara": "ᮞ", "latin": "sa", "confidence": 0.95}
  ],
  "transkripsi": "teks latin lengkap di sini",
  "catatan": "catatan opsional di sini"
}

Jika gambar bukan aksara Sunda atau tidak dapat dikenali, tetap kembalikan JSON dengan transkripsi berisi keterangan tersebut.`;

// Fungsi helper untuk menghitung backoff exponential dengan jitter (mulai ~1000ms)
function getBackoffWithJitter(attempt: number): number {
  // attempt 1: 1000ms base + [0, 400] jitter = 1000 - 1400ms
  // attempt 2: 2000ms base + [0, 600] jitter = 2000 - 2600ms
  // attempt 3: 4000ms base + [0, 800] jitter = 4000 - 4800ms
  const base = 1000 * Math.pow(2, attempt - 1);
  const jitter = Math.random() * (400 + attempt * 200);
  return Math.floor(base + jitter);
}

// Fungsi helper pemanggilan REST langsung dengan timeout per percobaan
async function callGeminiRest(
  modelName: string,
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  timeoutMs: number
): Promise<{ status: number; bodyText: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: PROMPT_OCR },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    return { status: res.status, bodyText };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Timeout ${timeoutMs}ms terlampaui saat memanggil model ${modelName}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function recognize(
  image: { base64: string; mediaType: string }
): Promise<RecognitionResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");

  if (!apiKey) {
    console.warn("GEMINI_API_KEY tidak ditemukan. Menggunakan mock data.");
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      aksaraTerdeteksi: [
        { aksara: "ᮞ", latin: "sa", confidence: 0.98 },
        { aksara: "ᮊ", latin: "ka", confidence: 0.95 },
        { aksara: "ᮜ", latin: "la", confidence: 0.89 },
      ],
      transkripsi: "Sakala (MOCK - GEMINI_API_KEY belum diset)",
      catatan: "Set GEMINI_API_KEY via: supabase secrets set GEMINI_API_KEY=\"kunci-anda\"",
    };
  }

  // Model utama dan cadangan dari secrets atau konstanta default
  const primaryModel = Deno.env.get("GEMINI_MODEL") || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = Deno.env.get("GEMINI_FALLBACK_MODEL") || DEFAULT_FALLBACK_MODEL;
  const candidateModels = primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel];

  const RETRYABLE_STATUS_CODES = [429, 500, 503, 504];
  const MAX_ATTEMPTS = 3;
  const TIMEOUT_PER_ATTEMPT_MS = 12000; // 12s per call agar total 2-3 percobaan tetap aman di batas Edge Function

  let lastStatus = 0;
  let lastBodyText = "";
  let lastModelName = "";

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const currentModel = candidateModels[mIdx];
    lastModelName = currentModel;
    const isPrimary = mIdx === 0;

    console.log(`[OCR] Memulai pemrosesan dengan model ${isPrimary ? "utama" : "cadangan"}: ${currentModel}`);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`[OCR] Request ke ${currentModel} (percobaan ${attempt}/${MAX_ATTEMPTS})...`);
        const { status, bodyText } = await callGeminiRest(
          currentModel,
          apiKey,
          image.base64,
          image.mediaType,
          TIMEOUT_PER_ATTEMPT_MS
        );

        lastStatus = status;
        lastBodyText = bodyText;

        if (status === 200) {
          console.log(`[OCR] Sukses menerima respons 200 dari ${currentModel}`);

          let jsonParsed: any;
          try {
            jsonParsed = JSON.parse(bodyText);
          } catch (pe) {
            console.error("[OCR] Gagal parse response envelope JSON:", pe);
            throw new GeminiRecognitionError(
              502,
              "Format respons dari model AI tidak dapat diproses.",
              `Gagal parse JSON dari ${currentModel}: ${bodyText.slice(0, 200)}`
            );
          }

          const rawCandidateText = jsonParsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          if (!rawCandidateText) {
            console.warn(`[OCR] Kandidat teks kosong dari ${currentModel}. Safety ratings / finish reason:`, jsonParsed.candidates?.[0]?.finishReason);
            return {
              aksaraTerdeteksi: [],
              transkripsi: "Tidak ada teks yang dapat dikenali.",
              catatan: "Model tidak mengembalikan karakter aksara.",
            };
          }

          // Parse JSON payload hasil OCR Aksara Sunda dari model
          try {
            const cleanedText = rawCandidateText
              .replace(/^```json\s*/i, "")
              .replace(/^```\s*/i, "")
              .replace(/\s*```$/i, "")
              .trim();
            const resultData = JSON.parse(cleanedText);

            return {
              aksaraTerdeteksi: Array.isArray(resultData.aksaraTerdeteksi) ? resultData.aksaraTerdeteksi : [],
              transkripsi: resultData.transkripsi || rawCandidateText,
              catatan: resultData.catatan,
            };
          } catch {
            return {
              aksaraTerdeteksi: [],
              transkripsi: rawCandidateText,
              catatan: "Respons berupa teks langsung.",
            };
          }
        }

        // Catat status HTTP dan isi error asli dari Gemini TANPA menulis API key
        console.error(`[OCR] Gemini API error response [${currentModel}] - Status: ${status} | Body: ${bodyText.slice(0, 500)}`);

        // Evaluasi apakah error dapat di-retry
        if (RETRYABLE_STATUS_CODES.includes(status)) {
          if (attempt < MAX_ATTEMPTS) {
            const delay = getBackoffWithJitter(attempt);
            console.log(`[OCR] Retryable error (${status}) dari ${currentModel}. Menunggu ${delay}ms sebelum retry ke-${attempt + 1}...`);
            await new Promise((r) => setTimeout(r, delay));
            continue; // Lakukan retry percobaan berikutnya
          } else {
            console.warn(`[OCR] Model ${currentModel} telah mencapai batas retry (${MAX_ATTEMPTS}x). Beralih ke model cadangan jika tersedia.`);
            break; // Keluar dari loop retry attempt, coba model berikutnya
          }
        }

        // Untuk status 400, 401, 403, 404: JANGAN RETRY
        console.warn(`[OCR] Non-retryable status (${status}) dari ${currentModel}. Tidak akan melakukan retry.`);
        break; // Langsung keluar loop retry
      } catch (callErr: unknown) {
        const errMsg = callErr instanceof Error ? callErr.message : String(callErr);
        console.error(`[OCR] Exception saat request ke ${currentModel} (attempt ${attempt}): ${errMsg}`);

        if (attempt < MAX_ATTEMPTS) {
          const delay = getBackoffWithJitter(attempt);
          console.log(`[OCR] Menunggu ${delay}ms sebelum retry setelah exception...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }
  }

  // ── 5. Klasifikasi pesan ke pengguna berdasarkan status akhir ──
  if (lastStatus === 429) {
    throw new GeminiRecognitionError(
      429,
      "Batas kuota layanan AI sedang habis. Mohon tunggu beberapa saat sebelum mencoba kembali.",
      `Model ${lastModelName} mengembalikan 429: ${lastBodyText.slice(0, 200)}`
    );
  }

  if (lastStatus >= 500 && lastStatus < 600) {
    throw new GeminiRecognitionError(
      502,
      "Layanan model AI sedang mengalami gangguan sementara. Silakan coba kembali beberapa saat lagi.",
      `Model ${lastModelName} mengembalikan ${lastStatus}: ${lastBodyText.slice(0, 200)}`
    );
  }

  if (lastStatus === 404 || lastStatus === 400) {
    throw new GeminiRecognitionError(
      502,
      "Terjadi kendala konfigurasi saat memproses gambar. Silakan hubungi admin.",
      `Model ${lastModelName} mengembalikan ${lastStatus}: ${lastBodyText.slice(0, 200)}`
    );
  }

  if (lastStatus === 401 || lastStatus === 403) {
    throw new GeminiRecognitionError(
      502,
      "Terjadi kendala autentikasi layanan AI. Silakan hubungi admin.",
      `Model ${lastModelName} mengembalikan ${lastStatus} (Auth issue)`
    );
  }

  throw new GeminiRecognitionError(
    502,
    "Layanan model AI sedang tidak dapat diakses. Silakan coba beberapa saat lagi.",
    `Semua model gagal. Model terakhir: ${lastModelName}, status: ${lastStatus}`
  );
}
