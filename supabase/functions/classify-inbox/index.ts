import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth check ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims || claimsData.claims.role !== "authenticated") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Input validation ---
    const { content, projects, areas } = await req.json();

    if (!content || typeof content !== "string" || content.length > 5000) {
      return new Response(JSON.stringify({ error: "Invalid content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(projects) || projects.length > 200) {
      return new Response(JSON.stringify({ error: "Invalid projects" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(areas) || areas.length > 200) {
      return new Response(JSON.stringify({ error: "Invalid areas" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Sanitize project/area data to only include needed fields
    const safeProjects = projects.slice(0, 100).map((p: any) => ({
      id: String(p.id ?? "").slice(0, 100),
      name: String(p.name ?? "").slice(0, 200),
      areaId: String(p.areaId ?? "").slice(0, 100),
      description: String(p.description ?? "").slice(0, 500),
    }));

    const safeAreas = areas.slice(0, 50).map((a: any) => ({
      id: String(a.id ?? "").slice(0, 100),
      name: String(a.name ?? "").slice(0, 200),
    }));

    const projectContext = safeProjects
      .map((p: any) => {
        const area = safeAreas.find((a: any) => a.id === p.areaId);
        return `- Proyecto "${p.name}" (ID: ${p.id}, Área: ${area?.name ?? "?"}, Descripción: ${p.description || "sin descripción"})`;
      })
      .join("\n");

    const safeContent = content.slice(0, 2000);

    const systemPrompt = `Eres un asistente de productividad. El usuario tiene estos proyectos:

${projectContext || "No hay proyectos creados aún."}

Dada una nota/idea del usuario, clasifícala sugiriendo:
1. El proyecto más apropiado (devuelve el ID exacto del proyecto)
2. El nivel de importancia: "critical", "important", "normal", "low", "none"
3. Un nombre corto y claro para la tarea (máximo 60 caracteres, accionable, tipo "Revisar presupuesto Q2")
4. Una descripción útil que amplíe el contexto de la nota original (1-2 frases)

IMPORTANTE: Si el contenido incluye un resumen scrapeado (marcado con 📋 o 🔗), úsalo para entender mejor el contexto y clasificar con mayor precisión. El resumen ya contiene información procesada de la URL original.

Si ningún proyecto encaja bien, devuelve projectId vacío.
Responde SOLO con la herramienta proporcionada.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Clasifica esta entrada del inbox: <user_input>${safeContent}</user_input>` },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "classify_inbox_item",
                description:
                  "Clasifica un elemento del inbox sugiriendo proyecto e importancia",
                parameters: {
                  type: "object",
                  properties: {
                    projectId: {
                      type: "string",
                      description:
                        "ID del proyecto sugerido. Vacío si ninguno encaja.",
                    },
                    importance: {
                      type: "string",
                      enum: ["critical", "important", "normal", "low", "none"],
                      description: "Nivel de importancia sugerido",
                    },
                    suggestedName: {
                      type: "string",
                      description:
                        "Nombre corto y accionable para la tarea (máx 60 chars)",
                    },
                    suggestedDescription: {
                      type: "string",
                      description:
                        "Descripción útil que amplía el contexto (1-2 frases)",
                    },
                    reasoning: {
                      type: "string",
                      description:
                        "Breve explicación de por qué se eligió este proyecto e importancia",
                    },
                  },
                  required: ["projectId", "importance", "suggestedName", "suggestedDescription", "reasoning"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "classify_inbox_item" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ projectId: "", importance: "normal", reasoning: "" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("classify-inbox error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
