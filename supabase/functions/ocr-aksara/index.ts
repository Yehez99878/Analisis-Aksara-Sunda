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
    // ── 1. Parse & validasi payload ──────────────────────────
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Body harus berupa JSON yang valid." }, 400);
    }

    const { image } = body;
    if (!image || !image.base64 || !image.mediaType) {
      return jsonResponse(
        { error: "Format payload salah. Harus mengirim: { image: { base64, mediaType } }" },
        400,
      );
    }

    if (image.base64.length > 7_000_000) {
      return jsonResponse({ error: "Gambar terlalu besar (maksimal ~5 MB)." }, 413);
    }

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(image.mediaType.toLowerCase())) {
      return jsonResponse(
        { error: "Format tidak didukung. Gunakan JPG, PNG, atau WebP." },
        415,
      );
    }

    // ── 2. Rate limiting (non-blocking, timeout 3 detik) ──────
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
          const today = new Date().toISOString().split("T")[0];

          // ── FIX: .maybeSingle() — tidak melempar 406 jika 0 baris ──
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

          if (currentCount >= 50) {
            return jsonResponse(
              { error: "Batas harian tercapai (50 permintaan/hari). Coba lagi besok." },
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

    // ── 3. Panggil model OCR (timeout 30 detik) ───────────────
    console.log("Memulai pengenalan aksara...");
    const result = await withTimeout(
      recognize(image),
      30_000,
      "recognize() model",
    );
    console.log("Pengenalan selesai.");

    return jsonResponse(result, 200);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Terjadi kesalahan internal.";
    console.error("Edge Function fatal error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
