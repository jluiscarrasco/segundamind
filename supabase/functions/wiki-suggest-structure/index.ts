import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PageInput {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  contentPreview: string;
}

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

    const { pages, entityName, entityType } = await req.json() as {
      pages: PageInput[];
      entityName: string;
      entityType: string;
    };

    if (!pages || pages.length < 2) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Build tree description for the AI
    const treeDesc = pages.map(p => {
      const parent = p.parentId ? pages.find(x => x.id === p.parentId)?.title || "?" : "raíz";
      return `- ID: ${p.id} | Título: "${p.title}" | Padre: ${parent} | Pos: ${p.position} | Contenido: ${p.contentPreview}`;
    }).join("\n");

    const systemPrompt = `Eres un experto en arquitectura de información y gestión del conocimiento.

Analizas la estructura de páginas wiki de un ${entityType === 'area' ? 'área' : 'proyecto'} llamado "${entityName}" y sugieres mejoras en la jerarquía y organización.

ESTRUCTURA ACTUAL:
${treeDesc}

Analiza las páginas y genera sugerencias de reorganización. Tipos de sugerencia:
1. "move" — mover una página como hija de otra (cuando temáticamente es un subtema)
2. "reorder" — reordenar páginas dentro del mismo nivel padre (orden lógico)
3. "group" — sugerir crear una nueva página agrupadora para varias páginas relacionadas

REGLAS:
- Solo sugiere cambios que tengan sentido semántico
- Máximo 5 sugerencias
- Cada sugerencia debe tener una razón clara y breve en español
- Si la estructura actual ya es buena, devuelve lista vacía
- No sugieras eliminar ni fusionar contenido`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Analiza la estructura y sugiere mejoras de organización." },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_structure",
              description: "Return wiki structure suggestions",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["move", "reorder", "group"] },
                        pageId: { type: "string", description: "Page ID to move (for 'move' type)" },
                        newParentId: { type: "string", description: "New parent page ID or 'root' (for 'move' type)" },
                        parentId: { type: "string", description: "Parent ID whose children to reorder, or 'root' (for 'reorder' type)" },
                        order: { type: "array", items: { type: "string" }, description: "Ordered page IDs (for 'reorder' type)" },
                        pageIds: { type: "array", items: { type: "string" }, description: "Page IDs to group (for 'group' type)" },
                        suggestedTitle: { type: "string", description: "Title for the new grouping page (for 'group' type)" },
                        reason: { type: "string", description: "Brief explanation in Spanish" },
                      },
                      required: ["type", "reason"],
                    },
                  },
                },
                required: ["suggestions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_structure" } },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const args = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ suggestions: args.suggestions || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("wiki-suggest-structure error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
