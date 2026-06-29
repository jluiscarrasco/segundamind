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

    const { draft, entityName, entityType } = await req.json();
    if (!draft || typeof draft !== "string") {
      return new Response(JSON.stringify({ error: "draft is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Eres un experto en documentación técnica y gestión del conocimiento. Transformas borradores en páginas wiki de alta calidad en Markdown.

El contenido pertenece a un ${entityType === 'area' ? 'área' : 'proyecto'} llamado "${entityName}".

ESTRUCTURA OBLIGATORIA de la página:

1. ENCABEZADO: Empieza con el título como ## (H2), seguido de un blockquote (>) con una descripción corta de una línea.

2. INTRODUCCIÓN: Un párrafo de contexto general (2-4 frases).

3. SECCIONES: Usa ### (H3) para cada sección temática. Incluye al menos 3 secciones relevantes según el contenido.

4. CONTENIDO RICO dentro de las secciones — usa TODOS estos elementos donde aplique:
   - **Negrita** para términos clave y conceptos importantes
   - Listas con viñetas (- ) para enumerar elementos
   - Listas numeradas (1. ) para pasos o procesos secuenciales
   - > Blockquotes para destacar ideas clave, citas o advertencias
   - \`código inline\` para términos técnicos, comandos o valores
   - Tablas Markdown con | para datos comparativos, precios, specs (SIEMPRE que haya datos tabulares)
   - Líneas horizontales (---) para separar secciones importantes
   - - [ ] Checkboxes para tareas o pasos pendientes
   - [enlaces](url) cuando se mencionen URLs

5. SECCIÓN FINAL: Si hay URLs, añade "## 🔗 Referencias" con enlaces formateados.

REGLAS:
- Responde SOLO con Markdown, sin explicaciones fuera del contenido.
- Mantén un tono profesional pero cercano, en español.
- No inventes datos que no estén en el borrador, pero SÍ estructura y enriquece el formato.
- Las tablas son OBLIGATORIAS cuando el borrador contenga datos comparativos, precios, características, etc.
- Usa emojis temáticos en los títulos de sección (ej: "### 🚀 Casos de uso", "### 💰 Precios").

EJEMPLO de tabla bien formateada:
| Recurso | Incluido |
|---------|----------|
| Proyectos | 100 |
| Almacenamiento | 0,5 GB |`;


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
          { role: "user", content: draft },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_wiki_page",
              description: "Create a wiki page with a title and markdown content",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short descriptive title for the page (max 60 chars)" },
                  content: { type: "string", description: "Full markdown content of the page" },
                },
                required: ["title", "content"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "create_wiki_page" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
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
    console.error("wiki-generate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
