import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No authorization header" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Validate JWT via getClaims
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: authError } = await supabaseAuth.auth.getClaims(token);
    if (authError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const userId = claimsData.claims.sub as string;
    const body = await req.json();
    const { action, subscription, endpoint } = body;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (action === "subscribe") {
      if (!subscription?.endpoint || !subscription?.p256dh_key || !subscription?.auth_key) {
        return new Response(JSON.stringify({ error: "Invalid subscription data" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      const { error } = await supabaseAdmin.from("push_subscriptions").upsert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh_key: subscription.p256dh_key,
        auth_key: subscription.auth_key,
        device_info: subscription.device_info || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,endpoint' });

      if (error) {
        console.error("Error saving subscription:", error);
        return new Response(JSON.stringify({ error: "Failed to save subscription" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });

    } else if (action === "unsubscribe") {
      if (!endpoint) {
        return new Response(JSON.stringify({ error: "Endpoint required" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      await supabaseAdmin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
