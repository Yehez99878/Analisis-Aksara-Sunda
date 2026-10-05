import { GoogleGenerativeAI } from "npm:@google/generative-ai";

export type RecognitionResult = {
  aksaraTerdeteksi: { aksara: string; latin: string; confidence: number }[];
  transkripsi: string;
  catatan?: string;
};

export async function recognize(
  image: { base64: string; mediaType: string }
): Promise<RecognitionResult> {
  // ============================================================
  // SLOT MODEL - GUNAKAN GEMINI API
  // ============================================================
  // API Key dibaca dari Supabase Secrets (AMAN - tidak terekspos ke browser)
  // Untuk mengatur: supabase secrets set GEMINI_API_KEY="kunci-anda"
  // ============================================================

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  
  if (!apiKey) {
    // Jika tidak ada API key, gunakan mock sebagai fallback
    console.warn("GEMINI_API_KEY tidak ditemukan. Menggunakan mock data.");
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {
      aksaraTerdeteksi: [
        { aksara: "ᮞ", latin: "sa", confidence: 0.98 },
        { aksara: "ᮊ", latin: "ka", confidence: 0.95 },
        { aksara: "ᮜ", latin: "la", confidence: 0.89 }
      ],
      transkripsi: "Sakala (MOCK - GEMINI_API_KEY belum diset)",
      catatan: "Set GEMINI_API_KEY via: supabase secrets set GEMINI_API_KEY=\"kunci-anda\""
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Kamu adalah ahli Aksara Sunda. Analisis gambar ini secara teliti.

Tugas kamu:
1. Identifikasi setiap aksara/karakter Sunda yang terlihat beserta padanan Latinnya
2. Transkripsi keseluruhan teks ke dalam huruf Latin
3. Berikan catatan jika ada hal khusus

Berikan jawaban dalam format JSON yang valid seperti ini (tanpa kalimat lain, tanpa markdown code block):
{
  "aksaraTerdeteksi": [
    {"aksara": "ᮞ", "latin": "sa", "confidence": 0.95}
  ],
  "transkripsi": "teks latin lengkap di sini",
  "catatan": "catatan opsional di sini"
}

Jika gambar bukan aksara Sunda atau tidak dapat dikenali, tetap kembalikan JSON dengan transkripsi berisi keterangan tersebut.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: image.base64,
          mimeType: image.mediaType
        }
      }
    ]);

    const rawText = result.response.text().trim();
    
    // Parse JSON dari respons Gemini
    try {
      // Hapus markdown code block jika ada
      const jsonText = rawText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
      const parsed = JSON.parse(jsonText);
      
      return {
        aksaraTerdeteksi: parsed.aksaraTerdeteksi || [],
        transkripsi: parsed.transkripsi || rawText,
        catatan: parsed.catatan
      };
    } catch {
      // Jika respons bukan JSON valid, kembalikan sebagai transkripsi teks biasa
      return {
        aksaraTerdeteksi: [],
        transkripsi: rawText,
        catatan: "Respons dikembalikan sebagai teks (bukan JSON terstruktur)"
      };
    }

  } catch (error: any) {
    console.error("Error memanggil Gemini API:", error);
    throw new Error(`Gemini API error: ${error.message || "Unknown error"}`);
  }
}
