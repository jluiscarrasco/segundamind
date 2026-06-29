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
    const { fileUrl, mimeType, entityType, currentName, currentDescription } = await req.json();

    // Validate fileUrl origin matches this Supabase project (avoid SSRF via prefix bypass)
    if (!fileUrl || typeof fileUrl !== "string") {
      return new Response(JSON.stringify({ error: "Invalid file URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const parsed = new URL(fileUrl);
      const expected = new URL(Deno.env.get("SUPABASE_URL")!);
      if (parsed.origin !== expected.origin) {
        return new Response(JSON.stringify({ error: "Invalid file URL" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: "Invalid file URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize string inputs
    const safeMimeType = String(mimeType ?? "").slice(0, 100);
    const safeEntityType = String(entityType ?? "").slice(0, 50);
    const safeName = String(currentName ?? "").slice(0, 200);
    const safeDescription = String(currentDescription ?? "").slice(0, 2000);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const isImage = safeMimeType.startsWith("image/");

    const systemPrompt = `Eres un asistente de productividad. El usuario ha adjuntado un archivo (${isImage ? "imagen" : "documento"}) a una entidad de tipo "${safeEntityType}".

Contexto actual de la entidad:
- Nombre: "<user_input>${safeName}</user_input>"
- Descripción: "<user_input>${safeDescription}</user_input>"

Analiza el contenido del archivo y extrae toda la información útil que puedas. Devuelve sugerencias para actualizar la entidad usando la herramienta proporcionada.

Reglas:
- Si encuentras URLs en el documento, inclúyelas en el array de urls
- Si encuentras fechas relevantes (deadlines, reuniones, etc.), sugiere una fecha de revisión
- El nombre sugerido debe ser accionable y corto (máx 60 chars)
- La descripción debe resumir la información clave del documento
- Las notas adicionales deben contener detalles importantes que no caben en la descripción
- Si el archivo no contiene información útil, devuelve los campos vacíos`;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    if (isImage) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: "Analiza esta imagen y extrae la información relevante:" },
          { type: "image_url", image_url: { url: fileUrl } },
        ],
      });
    } else {
      try {
        const fileResp = await fetch(fileUrl);
        const text = await fileResp.text();
        messages.push({
          role: "user",
          content: `Analiza este documento y extrae la información relevante:\n\n<document>${text.slice(0, 10000)}</document>`,
        });
      } catch {
        messages.push({
          role: "user",
          content: `No pude leer el contenido del archivo. Intenta extraer info del contexto proporcionado.`,
        });
      }
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: [
            {
              type: "function",
              function: {
                name: "extract_info",
                description: "Extrae información del archivo adjunto para actualizar la entidad",
                parameters: {
                  type: "object",
                  properties: {
                    suggestedName: {
                      type: "string",
                      description: "Nombre sugerido para la entidad (máx 60 chars, accionable)",
                    },
                    suggestedDescription: {
                      type: "string",
                      description: "Descripción sugerida con la información clave extraída",
                    },
                    suggestedReviewDate: {
                      type: "string",
                      description: "Fecha de revisión sugerida en formato YYYY-MM-DD, o vacío si no aplica",
                    },
                    suggestedImportance: {
                      type: "string",
                      enum: ["critical", "important", "normal", "low", "none", ""],
                      description: "Importancia sugerida basada en el contenido",
                    },
                    urls: {
                      type: "array",
                      items: { type: "string" },
                      description: "URLs encontradas en el documento",
                    },
                    additionalNotes: {
                      type: "string",
                      description: "Notas adicionales con detalles importantes del documento",
                    },
                    summary: {
                      type: "string",
                      description: "Resumen breve de lo que se encontró en el archivo",
                    },
                  },
                  required: ["suggestedName", "suggestedDescription", "urls", "summary"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_info" } },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Límite de peticiones excedido. Intenta de nuevo más tarde." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Se requiere pago. Añade créditos a tu workspace." }),
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
      JSON.stringify({ suggestedName: "", suggestedDescription: "", urls: [], summary: "No se pudo extraer información." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("analyze-attachment error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
