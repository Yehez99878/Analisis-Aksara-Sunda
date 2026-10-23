import { GoogleGenerativeAI } from "npm:@google/generative-ai";

export type RecognitionResult = {
  aksaraTerdeteksi: { aksara: string; latin: string; confidence: number }[];
  transkripsi: string;
  catatan?: string;
};

// Daftar model untuk dicoba berurutan jika ada yang overload (503)
const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
];

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

export async function recognize(
  image: { base64: string; mediaType: string }
): Promise<RecognitionResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");

  if (!apiKey) {
    console.warn("GEMINI_API_KEY tidak ditemukan. Menggunakan mock data.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: Error | null = null;

  // Coba candidate models berurutan jika terjadi 503 / 429
  for (const modelName of CANDIDATE_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Mencoba model ${modelName} (attempt ${attempt})...`);
        const model = genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent([
          PROMPT_OCR,
          {
            inlineData: {
              data: image.base64,
              mimeType: image.mediaType,
            },
          },
        ]);

        const rawText = result.response.text().trim();

        // Parse JSON dari respons Gemini
        try {
          const jsonText = rawText
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
          const parsed = JSON.parse(jsonText);

          return {
            aksaraTerdeteksi: parsed.aksaraTerdeteksi || [],
            transkripsi: parsed.transkripsi || rawText,
            catatan: parsed.catatan,
          };
        } catch {
          return {
            aksaraTerdeteksi: [],
            transkripsi: rawText,
            catatan: "Respons dikembalikan sebagai teks biasa.",
          };
        }
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || String(err);
        console.warn(`Model ${modelName} attempt ${attempt} gagal: ${msg}`);

        // Jika 503 (overload) atau 429 (rate limit), tunggu sejenak lalu retry/fallback
        if (msg.includes("503") || msg.includes("429") || msg.includes("high demand")) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue; // coba attempt berikutnya atau model berikutnya
        }

        // Jika error lain (misal 404 model not found), langsung coba model berikutnya
        break;
      }
    }
  }

  throw new Error(
    `Semua model Gemini sedang sibuk / tidak merespons: ${lastError?.message || "Unknown error"}`
  );
}
