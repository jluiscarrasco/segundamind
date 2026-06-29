import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.84.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const CONTACT_EMAIL = "notificaciones@segundamind.lovable.app";

// ============ Web Push Crypto ============

function base64UrlDecode(input: string): Uint8Array {
  const padding = "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(input: string): Uint8Array {
  const raw = atob(input);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

async function generateVapidJwt(audience: string): Promise<string> {
  const privateKeyBytes = base64UrlDecode(VAPID_PRIVATE_KEY);
  const pubBytes = base64UrlDecode(VAPID_PUBLIC_KEY);
  const header = { alg: "ES256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 60 * 60, sub: `mailto:${CONTACT_EMAIL}` };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const x = pubBytes.slice(1, 33);
  const y = pubBytes.slice(33, 65);

  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: base64UrlEncode(x), y: base64UrlEncode(y), d: base64UrlEncode(privateKeyBytes) };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsignedToken));

  return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function encryptPayload(p256dhKey: Uint8Array, authSecret: Uint8Array, payload: string): Promise<{ body: Uint8Array }> {
  const localKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const subscriberKey = await crypto.subtle.importKey("raw", p256dhKey.buffer as ArrayBuffer, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: subscriberKey }, localKeyPair.privateKey, 256));
  const localPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", localKeyPair.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const ikmKey = await crypto.subtle.importKey("raw", sharedSecret.buffer as ArrayBuffer, { name: "HKDF" }, false, ["deriveBits"]);
  const keyInfo = concatUint8Arrays(new TextEncoder().encode("WebPush: info\0"), p256dhKey, localPublicKey);
  const prkBits = await crypto.subtle.deriveBits({ name: "HKDF", salt: authSecret.buffer as ArrayBuffer, info: keyInfo.buffer as ArrayBuffer, hash: "SHA-256" }, ikmKey, 256);
  const prkKey = await crypto.subtle.importKey("raw", prkBits, { name: "HKDF" }, false, ["deriveBits"]);

  const cekBits = await crypto.subtle.deriveBits({ name: "HKDF", salt: salt.buffer as ArrayBuffer, info: new TextEncoder().encode("Content-Encoding: aes128gcm\0").buffer as ArrayBuffer, hash: "SHA-256" }, prkKey, 128);
  const nonceBits = await crypto.subtle.deriveBits({ name: "HKDF", salt: salt.buffer as ArrayBuffer, info: new TextEncoder().encode("Content-Encoding: nonce\0").buffer as ArrayBuffer, hash: "SHA-256" }, prkKey, 96);

  const cek = await crypto.subtle.importKey("raw", cekBits, { name: "AES-GCM" }, false, ["encrypt"]);
  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 0x02;

  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonceBits }, cek, paddedPayload.buffer as ArrayBuffer));
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(localPublicKey, 21);

  return { body: concatUint8Arrays(header, encrypted) };
}

async function sendWebPush(endpoint: string, p256dhKey: string, authKey: string, payload: object): Promise<{ success: boolean; status?: number; error?: string }> {
  try {
    const p256dhBytes = base64Decode(p256dhKey);
    const authBytes = base64Decode(authKey);
    const { body } = await encryptPayload(p256dhBytes, authBytes, JSON.stringify(payload));
    const url = new URL(endpoint);
    const jwt = await generateVapidJwt(`${url.protocol}//${url.host}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": "3600",
        "Urgency": "high",
        "Authorization": `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      },
      body: body.buffer as ArrayBuffer,
    });

    if (response.ok || response.status === 201) return { success: true, status: response.status };
    const text = await response.text();
    console.error(`[Push] HTTP ${response.status}: ${text}`);
    return { success: false, status: response.status, error: text };
  } catch (err: any) {
    console.error("[Push] Error:", err);
    return { success: false, error: err.message };
  }
}

async function sendPushToUser(supabaseAdmin: any, userId: string, payload: { title: string; body: string; type: string }): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log("[Push] VAPID keys not configured");
    return false;
  }

  const { data: subscriptions, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("user_id", userId);

  if (error || !subscriptions?.length) return false;

  let sent = 0;
  for (const sub of subscriptions) {
    const result = await sendWebPush(sub.endpoint, sub.p256dh_key, sub.auth_key, payload);
    if (result.success) {
      sent++;
    } else if (result.status === 404 || result.status === 410) {
      await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }
  return sent > 0;
}

// ============ Main Handler ============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: require CRON_SECRET shared secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.log("=== Task notifications check ===", new Date().toISOString());
    console.log("VAPID_PUBLIC_KEY length:", VAPID_PUBLIC_KEY.length, "starts:", VAPID_PUBLIC_KEY.substring(0, 10));
    console.log("VAPID_PRIVATE_KEY length:", VAPID_PRIVATE_KEY.length);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get today's date in CET (Europe/Madrid)
    const now = new Date();
    const cetFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayCET = cetFormatter.format(now);

    console.log("Today (CET):", todayCET);

    // Find tasks with review_date = today that are not finished
    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from("tasks")
      .select("id, name, review_date, user_id, status, project_id")
      .eq("review_date", todayCET)
      .neq("status", "finished");

    if (tasksError) {
      console.error("Error fetching tasks:", tasksError);
      throw tasksError;
    }

    console.log(`Found ${tasks?.length || 0} tasks with review_date = today`);

    let pushCount = 0;

    // Group tasks by user
    const userTasks = new Map<string, typeof tasks>();
    for (const task of tasks || []) {
      const existing = userTasks.get(task.user_id) || [];
      existing.push(task);
      userTasks.set(task.user_id, existing);
    }

    // Send notification per user
    for (const [userId, userTaskList] of userTasks) {
      // Check user has push subscriptions
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .limit(1);

      if (!subs?.length) continue;

      if (userTaskList.length === 1) {
        const task = userTaskList[0];
        const success = await sendPushToUser(supabaseAdmin, userId, {
          title: "📋 Tarea para hoy",
          body: task.name,
          type: "task_review",
        });
        if (success) pushCount++;
      } else {
        const success = await sendPushToUser(supabaseAdmin, userId, {
          title: `📋 ${userTaskList.length} tareas para hoy`,
          body: userTaskList.map(t => t.name).slice(0, 3).join(", ") + (userTaskList.length > 3 ? "..." : ""),
          type: "task_review",
        });
        if (success) pushCount++;
      }
    }

    console.log(`Push notifications sent: ${pushCount}`);

    return new Response(
      JSON.stringify({ success: true, tasksFound: tasks?.length || 0, pushSent: pushCount }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
