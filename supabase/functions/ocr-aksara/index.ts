import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { recognize } from "./model.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.11.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    
    // Allow anonymous users (Phase 2 constraint)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate Limiting Logic (10 requests per day per user)
    const today = new Date().toISOString().split('T')[0];
    const { data: limitData } = await supabaseClient
      .from('rate_limits')
      .select('count')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    const count = limitData ? limitData.count : 0;
    
    if (count >= 50) { // Defaulting to 50 for testing ease, adjustable later
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Coba lagi besok." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upsert rate limit
    await supabaseClient
      .from('rate_limits')
      .upsert({ user_id: user.id, date: today, count: count + 1 }, { onConflict: 'user_id,date' });

    // Parse payload
    const { image } = await req.json();
    if (!image || !image.base64 || !image.mediaType) {
      return new Response(
        JSON.stringify({ error: "Format payload salah. Harus mengirim image: { base64, mediaType }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate size (roughly 5MB base64 = ~6.6MB string length)
    if (image.base64.length > 7000000) {
      return new Response(
        JSON.stringify({ error: "Ukuran gambar terlalu besar (Maksimal ~5MB)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(image.mediaType.toLowerCase())) {
      return new Response(
        JSON.stringify({ error: "Format gambar tidak didukung (hanya JPG, PNG, WebP)" }),
        { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Recognize
    const result = await recognize(image);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Error Processing Request:", error);
    return new Response(
      JSON.stringify({ error: "Terjadi kesalahan internal pada server pengenalan." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
