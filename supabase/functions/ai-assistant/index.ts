// AI assistant para "Mi Segundo Cerebro" — chat con tool-calling estilo MCP
// Usa el JWT del usuario para autenticar y service role para operar sobre sus datos.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const VALID_IMPORTANCE = ["none", "low", "normal", "important", "critical"];
const normalizeImportance = (v?: string) => {
  if (!v) return v;
  if (v === "high") return "important";
  if (v === "medium") return "normal";
  return VALID_IMPORTANCE.includes(v) ? v : "normal";
};

// ---------- Tool definitions (OpenAI-compatible) ----------
const tools = [
  { type: "function", function: { name: "list_areas", description: "Lista todas las áreas (dominios) del usuario.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_projects", description: "Lista proyectos. Filtra por area_id o status.", parameters: { type: "object", properties: { area_id: { type: "string" }, status: { type: "string" } } } } },
  { type: "function", function: { name: "list_tasks", description: "Lista tareas. Filtra por project_id, status o review_date (YYYY-MM-DD).", parameters: { type: "object", properties: { project_id: { type: "string" }, status: { type: "string" }, review_date: { type: "string" } } } } },
  { type: "function", function: { name: "list_inbox", description: "Lista items del Inbox.", parameters: { type: "object", properties: { limit: { type: "number" } } } } },
  { type: "function", function: { name: "list_wiki_pages", description: "Lista páginas wiki, filtradas por entity_type/entity_id.", parameters: { type: "object", properties: { entity_type: { type: "string", enum: ["area", "project"] }, entity_id: { type: "string" } } } } },
  { type: "function", function: { name: "get_wiki_page", description: "Obtiene contenido completo de una página wiki por id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "search", description: "Busca texto en áreas, proyectos, tareas, inbox y wiki.", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } },
  { type: "function", function: { name: "create_inbox_item", description: "Añade nota al Inbox.", parameters: { type: "object", properties: { content: { type: "string" }, type: { type: "string" } }, required: ["content"] } } },
  { type: "function", function: { name: "create_area", description: "Crea un área.", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, importance: { type: "string", enum: VALID_IMPORTANCE } }, required: ["name"] } } },
  { type: "function", function: { name: "create_project", description: "Crea proyecto en un área.", parameters: { type: "object", properties: { name: { type: "string" }, area_id: { type: "string" }, description: { type: "string" }, importance: { type: "string", enum: VALID_IMPORTANCE } }, required: ["name", "area_id"] } } },
  { type: "function", function: { name: "create_task", description: "Crea tarea, opcionalmente dentro de un proyecto.", parameters: { type: "object", properties: { name: { type: "string" }, project_id: { type: "string" }, description: { type: "string" }, importance: { type: "string", enum: VALID_IMPORTANCE }, effort: { type: "number" }, review_date: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "update_task", description: "Actualiza una tarea.", parameters: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string" }, importance: { type: "string" }, effort: { type: "number" }, review_date: { type: "string" }, project_id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "update_project", description: "Actualiza un proyecto.", parameters: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string" }, importance: { type: "string" }, review_date: { type: "string" }, area_id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "update_area", description: "Actualiza un área.", parameters: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string" }, importance: { type: "string" }, review_date: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "delete_inbox_item", description: "Borra item del inbox.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "upsert_wiki_page", description: "Crea o actualiza una página wiki. Si pasas id, actualiza; si no, crea.", parameters: { type: "object", properties: { id: { type: "string" }, entity_type: { type: "string", enum: ["area", "project"] }, entity_id: { type: "string" }, title: { type: "string" }, content: { type: "string" }, parent_id: { type: "string" }, position: { type: "number" } } } } },
];

// ---------- Tool executors ----------
async function execTool(name: string, args: any, userId: string, db: any): Promise<any> {
  args = args || {};
  switch (name) {
    case "list_areas": {
      const { data, error } = await db.from("areas").select("*").eq("user_id", userId).order("created_at");
      if (error) throw new Error(error.message);
      return data;
    }
    case "list_projects": {
      let q = db.from("projects").select("*").eq("user_id", userId);
      if (args.area_id) q = q.eq("area_id", args.area_id);
      if (args.status) q = q.eq("status", args.status);
      const { data, error } = await q.order("created_at");
      if (error) throw new Error(error.message);
      return data;
    }
    case "list_tasks": {
      let q = db.from("tasks").select("*").eq("user_id", userId);
      if (args.project_id) q = q.eq("project_id", args.project_id);
      if (args.status) q = q.eq("status", args.status);
      if (args.review_date) q = q.eq("review_date", args.review_date);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return data;
    }
    case "list_inbox": {
      const { data, error } = await db.from("inbox_items").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(args.limit ?? 100);
      if (error) throw new Error(error.message);
      return data;
    }
    case "list_wiki_pages": {
      let q = db.from("wiki_pages").select("*").eq("user_id", userId);
      if (args.entity_type) q = q.eq("entity_type", args.entity_type);
      if (args.entity_id) q = q.eq("entity_id", args.entity_id);
      const { data, error } = await q.order("position");
      if (error) throw new Error(error.message);
      return data;
    }
    case "get_wiki_page": {
      const { data, error } = await db.from("wiki_pages").select("*").eq("user_id", userId).eq("id", args.id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }
    case "search": {
      const term = `%${args.q}%`;
      const [areas, projects, tasks, inbox, wiki] = await Promise.all([
        db.from("areas").select("id,name,description").eq("user_id", userId).or(`name.ilike.${term},description.ilike.${term}`).limit(20),
        db.from("projects").select("id,name,description,area_id").eq("user_id", userId).or(`name.ilike.${term},description.ilike.${term}`).limit(20),
        db.from("tasks").select("id,name,description,project_id,status").eq("user_id", userId).or(`name.ilike.${term},description.ilike.${term}`).limit(50),
        db.from("inbox_items").select("id,content,type").eq("user_id", userId).ilike("content", term).limit(50),
        db.from("wiki_pages").select("id,title,entity_type,entity_id").eq("user_id", userId).or(`title.ilike.${term},content.ilike.${term}`).limit(20),
      ]);
      return { areas: areas.data ?? [], projects: projects.data ?? [], tasks: tasks.data ?? [], inbox: inbox.data ?? [], wiki: wiki.data ?? [] };
    }
    case "create_inbox_item": {
      const { data, error } = await db.from("inbox_items").insert({ user_id: userId, content: args.content, type: args.type ?? "note" }).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "create_area": {
      const { data, error } = await db.from("areas").insert({ user_id: userId, name: args.name, description: args.description, importance: normalizeImportance(args.importance) }).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "create_project": {
      const { data, error } = await db.from("projects").insert({ user_id: userId, name: args.name, area_id: args.area_id, description: args.description, importance: normalizeImportance(args.importance) }).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "create_task": {
      let task_number = 0;
      if (args.project_id) {
        const { data: proj, error: pErr } = await db.from("projects").select("task_counter").eq("user_id", userId).eq("id", args.project_id).single();
        if (pErr) throw new Error(pErr.message);
        task_number = (proj?.task_counter ?? 0) + 1;
        const { error: uErr } = await db.from("projects").update({ task_counter: task_number }).eq("user_id", userId).eq("id", args.project_id);
        if (uErr) throw new Error(uErr.message);
      }
      const { data, error } = await db.from("tasks").insert({ user_id: userId, name: args.name, project_id: args.project_id, description: args.description, importance: normalizeImportance(args.importance), effort: args.effort, review_date: args.review_date, task_number }).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "update_task": {
      const { id, name, description, status, importance, effort, review_date, project_id } = args;
      const patch: any = { name, description, status, effort, review_date, project_id };
      if (importance !== undefined) patch.importance = normalizeImportance(importance);
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
      const { data, error } = await db.from("tasks").update(patch).eq("user_id", userId).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "update_project": {
      const { id, name, description, status, importance, review_date, area_id } = args;
      const patch: any = { name, description, status, review_date, area_id };
      if (importance !== undefined) patch.importance = normalizeImportance(importance);
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
      const { data, error } = await db.from("projects").update(patch).eq("user_id", userId).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "update_area": {
      const { id, name, description, status, importance, review_date } = args;
      const patch: any = { name, description, status, review_date };
      if (importance !== undefined) patch.importance = normalizeImportance(importance);
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
      const { data, error } = await db.from("areas").update(patch).eq("user_id", userId).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    case "delete_inbox_item": {
      const { error } = await db.from("inbox_items").delete().eq("user_id", userId).eq("id", args.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    case "upsert_wiki_page": {
      const { id, entity_type, entity_id, title, content, parent_id, position } = args;
      if (id) {
        const update: Record<string, unknown> = {};
        if (title !== undefined) update.title = title;
        if (content !== undefined) update.content = content;
        if (parent_id !== undefined) update.parent_id = parent_id;
        if (position !== undefined) update.position = position;
        const { data, error } = await db.from("wiki_pages").update(update).eq("user_id", userId).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        return data;
      }
      if (!entity_type || !entity_id || !title) throw new Error("entity_type, entity_id y title son obligatorios para crear");
      const { data, error } = await db.from("wiki_pages").insert({ user_id: userId, entity_type, entity_id, title, content: content ?? "", parent_id, position: position ?? 0 }).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    default:
      throw new Error(`Tool desconocida: ${name}`);
  }
}

const SYSTEM_PROMPT = `Eres el asistente personal del segundo cerebro del usuario (MyBrain).
Tienes acceso a sus áreas (dominios), proyectos, tareas, inbox y páginas wiki mediante tools.

Reglas:
- Responde siempre en español salvo que el usuario use otro idioma.
- Usa las tools sin pedir permiso para LECTURA. Para creación/modificación/borrado, hazlo directamente si la intención es clara; si hay ambigüedad importante, pregunta primero.
- Cuando el usuario mencione una tarea/proyecto/área por nombre, usa search o list_* para resolver el id antes de modificar.
- Status válidos: funnel, ready, blocked, active, finished. Importance: none, low, normal, important, critical.
- Las fechas son YYYY-MM-DD en zona Europe/Madrid.
- Sé conciso. Usa Markdown (listas, negritas) para presentar resultados. Evita volcar JSON crudo: resume.
- Tras ejecutar acciones, confirma brevemente lo hecho.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.slice(7);
    const { data: claimsData, error: authError } = await userClient.auth.getClaims(token);
    if (authError || !claimsData?.claims || claimsData.claims.role !== "authenticated") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.claims.sub as string;

    const { messages } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages requerido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const convo: any[] = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
    const toolEvents: any[] = [];

    for (let iter = 0; iter < 8; iter++) {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: convo, tools, tool_choice: "auto" }),
      });

      if (!resp.ok) {
        if (resp.status === 429) return new Response(JSON.stringify({ error: "Límite de peticiones excedido. Espera unos segundos." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (resp.status === 402) return new Response(JSON.stringify({ error: "Créditos de IA agotados. Añade fondos en Settings > Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const t = await resp.text();
        console.error("AI gateway error", resp.status, t);
        return new Response(JSON.stringify({ error: "Error del servicio de IA" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("Sin respuesta del modelo");

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0) {
        return new Response(JSON.stringify({ message: msg.content ?? "", toolEvents }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Push assistant message with tool_calls
      convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const fnName = tc.function?.name;
        let fnArgs: any = {};
        try { fnArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
        let result: any;
        let ok = true;
        try {
          result = await execTool(fnName, fnArgs, userId, db);
        } catch (e) {
          ok = false;
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        toolEvents.push({ name: fnName, args: fnArgs, ok });
        convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 30000) });
      }
    }

    return new Response(JSON.stringify({ message: "Se alcanzó el límite de iteraciones de tools.", toolEvents }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-assistant error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
