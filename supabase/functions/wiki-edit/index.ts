import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claimsData?.claims || claimsData.claims.role !== "authenticated") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { currentContent, currentTitle, instruction, entityName, entityType } = await req.json();
    if (!instruction || typeof instruction !== "string") {
      return new Response(JSON.stringify({ error: "instruction is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Eres un editor experto de documentación wiki en Markdown. Tu trabajo es modificar el contenido existente de una página wiki según las instrucciones del usuario.

La página pertenece a un ${entityType === 'area' ? 'área' : 'proyecto'} llamado "${entityName}".
Título actual de la página: "${currentTitle}"

REGLAS:
- Aplica SOLO los cambios que el usuario pide. No reescribas todo el contenido innecesariamente.
- Mantén el formato Markdown existente y el estilo de la página.
- Si el usuario pide añadir contenido, intégralo de forma coherente en la estructura existente.
- Si el usuario pide eliminar o modificar una sección, hazlo sin afectar el resto.
- Usa el mismo tono y estilo que el contenido existente.
- Responde SOLO con el contenido Markdown completo actualizado, sin explicaciones.
- Si el usuario pide cambiar el título, devuélvelo actualizado.
- Mantén emojis en títulos de sección si ya existen.
- Las tablas, listas, blockquotes y demás formato deben mantenerse correctos.`;

    const userMessage = `CONTENIDO ACTUAL DE LA PÁGINA:
---
${currentContent || '(vacío)'}
---

INSTRUCCIÓN DEL USUARIO:
${instruction}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "update_wiki_page",
              description: "Update a wiki page with modified title and content",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Updated title (keep original if not changed)" },
                  content: { type: "string", description: "Full updated markdown content" },
                },
                required: ["title", "content"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "update_wiki_page" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const args = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ title: args.title, content: args.content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("wiki-edit error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
