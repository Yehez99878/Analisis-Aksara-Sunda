import { recognize } from "./model.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Helper: jalankan promise dengan batas waktu agar tidak pernah hang
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms) saat: ${label}`)), ms),
    ),
  ]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Parse & validasi payload (Status 400 jika tidak valid) ──
    let body;
    try {
      body = await req.json();
    } catch (parseErr) {
      console.error("Payload JSON parse error:", parseErr);
      return jsonResponse({ error: "Format request tidak valid (harus berupa JSON)." }, 400);
    }

    const { image } = body || {};
    if (!image || typeof image.base64 !== "string" || typeof image.mediaType !== "string") {
      console.error("Format payload tidak sesuai:", { hasImage: !!image });
      return jsonResponse(
        { error: "Format gambar tidak valid. Pastikan gambar terlampir dengan format yang benar." },
        400,
      );
    }

    if (image.base64.length > 7_000_000) {
      console.error("Ukuran base64 melebihi batas:", image.base64.length);
      return jsonResponse(
        { error: "Ukuran gambar terlalu besar. Maksimal ukuran gambar adalah 5 MB." },
        400,
      );
    }

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(image.mediaType.toLowerCase())) {
      console.error("Tipe media tidak didukung:", image.mediaType);
      return jsonResponse(
        { error: "Format file tidak didukung. Harap gunakan gambar berformat JPG, PNG, atau WebP." },
        400,
      );
    }

    // ── 2. Rate limiting (Status 429 jika batas habis) ────────
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
      const authHeader = req.headers.get("Authorization");

      // Hanya proses jika ada user token (bukan anon key)
      const token = authHeader?.replace(/^Bearer\s+/i, "");
      const isAnonKey = token === supabaseAnonKey;

      if (supabaseUrl && supabaseAnonKey && token && !isAnonKey) {
        const client = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        });

        // Timeout 3s untuk auth check
        const userRes = await withTimeout(
          client.auth.getUser(),
          3000,
          "auth.getUser",
        ).catch((e) => {
          console.warn("getUser timeout/error:", e.message);
          return null;
        });

        const user = userRes?.data?.user;

        if (user) {
          const now = new Date();
          const today = now.toISOString().split("T")[0];

          // Hitung waktu reset (tengah malam UTC berikutnya)
          const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
          const resetTimeStr = tomorrow.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }) + " WIB";

          // .maybeSingle() — tidak melempar 406 jika 0 baris
          const { data: row, error: selErr } = await withTimeout(
            client
              .from("rate_limits")
              .select("count")
              .eq("user_id", user.id)
              .eq("date", today)
              .maybeSingle(),
            3000,
            "rate_limits select",
          ).catch(() => ({ data: null, error: null }));

          if (selErr) {
            console.error("rate_limits SELECT error:", selErr.message);
          }

          const currentCount = row?.count ?? 0;
          const MAX_REQUESTS_PER_DAY = 50;

          if (currentCount >= MAX_REQUESTS_PER_DAY) {
            console.warn(`User ${user.id} mencapai rate limit (${currentCount}/${MAX_REQUESTS_PER_DAY})`);
            return jsonResponse(
              {
                error: `Batas harian pengenalan aksara telah tercapai (${MAX_REQUESTS_PER_DAY}x per hari). Kuota harian Anda akan direset pada pukul ${resetTimeStr}.`,
              },
              429,
            );
          }

          // Upsert counter (non-blocking)
          client
            .from("rate_limits")
            .upsert(
              { user_id: user.id, date: today, count: currentCount + 1 },
              { onConflict: "user_id,date" },
            )
            .then(({ error: upErr }) => {
              if (upErr) console.error("rate_limits UPSERT error:", upErr.message);
            })
            .catch((e) => console.error("rate_limits UPSERT exception:", e));
        }
      }
    } catch (e) {
      console.error("Rate-limit block exception:", e);
    }

    // ── 3. Panggil model OCR (Status 502 jika model gagal/overload/kuota) ──
    try {
      console.log("Memulai pengenalan aksara oleh model...");
      const result = await withTimeout(
        recognize(image),
        30_000,
        "recognize() model",
      );
      console.log("Pengenalan model berhasil selesai.");

      return jsonResponse(result, 200);
    } catch (modelError: unknown) {
      const technicalMsg = modelError instanceof Error ? modelError.message : String(modelError);
      // Tulis detail teknis di log server tanpa ekspos rahasia
      console.error("Model recognition technical failure:", technicalMsg);

      // Kembalikan status 502 dengan pesan yang ramah pengguna
      return jsonResponse(
        {
          error: "Layanan model AI sedang mengalami gangguan atau antrean padat. Silakan coba kembali dalam beberapa saat.",
        },
        502,
      );
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Edge Function internal unhandled failure:", message);
    return jsonResponse(
      { error: "Terjadi kendala pada server saat memproses gambar. Silakan coba lagi." },
      500,
    );
  }
});
