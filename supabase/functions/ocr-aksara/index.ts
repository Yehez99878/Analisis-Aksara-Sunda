import { recognize } from "./model.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse payload terlebih dahulu
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Request body harus berupa JSON yang valid." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { image } = body;
    if (!image || !image.base64 || !image.mediaType) {
      return new Response(
        JSON.stringify({ error: "Format payload salah. Harus mengirim image: { base64, mediaType }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validasi ukuran (~5MB base64 ≈ ~6.6MB string)
    if (image.base64.length > 7000000) {
      return new Response(
        JSON.stringify({ error: "Ukuran gambar terlalu besar (Maksimal ~5MB)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validasi tipe gambar
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(image.mediaType.toLowerCase())) {
      return new Response(
        JSON.stringify({ error: "Format gambar tidak didukung (hanya JPG, PNG, WebP)" }),
        { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Opsional: Auth & Rate Limiting (tidak memblokir jika gagal)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
      const authHeader = req.headers.get("Authorization");

      if (supabaseUrl && supabaseAnonKey && authHeader) {
        const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } }
        });

        const { data: { user } } = await supabaseClient.auth.getUser();

        if (user) {
          // Coba rate limiting (skip jika tabel belum ada)
          const today = new Date().toISOString().split('T')[0];
          const { data: limitData } = await supabaseClient
            .from('rate_limits')
            .select('count')
            .eq('user_id', user.id)
            .eq('date', today)
            .single();

          const count = limitData?.count ?? 0;

          if (count >= 50) {
            return new Response(
              JSON.stringify({ error: "Rate limit tercapai (50/hari). Coba lagi besok." }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Update rate limit counter (best effort)
          await supabaseClient
            .from('rate_limits')
            .upsert(
              { user_id: user.id, date: today, count: count + 1 },
              { onConflict: 'user_id,date' }
            ).catch(() => { /* ignore if table doesn't exist */ });
        }
      }
    } catch (e) {
      // Auth/rate-limit gagal bukan alasan untuk menolak request
      console.warn("Auth/rate-limit warning (non-blocking):", e);
    }

    // Jalankan pengenalan aksara
    const result = await recognize(image);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Edge Function Error:", message);
    return new Response(
      JSON.stringify({ error: "Terjadi kesalahan pada server: " + message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
