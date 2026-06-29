// MCP server for "Mi Segundo Cerebro"
// - Auth method 1: personal Bearer tokens stored in api_tokens (SHA-256 hashed) — for Claude Desktop config
// - Auth method 2: OAuth 2.1 + PKCE + Dynamic Client Registration — for Claude.ai web "Add custom connector"
import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Public function URL (issuer / resource identifier)
const MCP_BASE = `${SUPABASE_URL}/functions/v1/mcp`;
// Where the user lands to give consent
const APP_BASE = Deno.env.get("APP_BASE_URL") ?? "https://mybrain.miclario.com";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Base64url (no padding) of raw bytes
function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

async function authenticate(req: Request): Promise<{ userId: string; admin: SupabaseClient } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  const admin = adminClient();
  const { data, error } = await admin
    .from("api_tokens")
    .select("user_id, id, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  admin.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return { userId: data.user_id, admin };
}

// ============ Server factory (one per request, scoped to user) ============
function buildServer(userId: string, db: SupabaseClient) {
  const server = new McpServer({ name: "mi-segundo-cerebro", version: "1.0.0" });

  // ---------- READ TOOLS ----------
  server.tool("list_areas", {
    description: "Lista todas las áreas (dominios) del usuario.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data, error } = await db.from("areas").select("*").eq("user_id", userId).order("created_at");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  server.tool("list_projects", {
    description: "Lista proyectos. Opcionalmente filtra por area_id o status.",
    inputSchema: {
      type: "object",
      properties: {
        area_id: { type: "string", description: "UUID del área (opcional)" },
        status: { type: "string", description: "active, paused, finished, etc." },
      },
    },
    handler: async (args: { area_id?: string; status?: string }) => {
      let q = db.from("projects").select("*").eq("user_id", userId);
      if (args.area_id) q = q.eq("area_id", args.area_id);
      if (args.status) q = q.eq("status", args.status);
      const { data, error } = await q.order("created_at");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  server.tool("list_tasks", {
    description: "Lista tareas. Filtra opcionalmente por project_id, status o review_date.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        status: { type: "string" },
        review_date: { type: "string", description: "YYYY-MM-DD" },
      },
    },
    handler: async (args: { project_id?: string; status?: string; review_date?: string }) => {
      let q = db.from("tasks").select("*").eq("user_id", userId);
      if (args.project_id) q = q.eq("project_id", args.project_id);
      if (args.status) q = q.eq("status", args.status);
      if (args.review_date) q = q.eq("review_date", args.review_date);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  server.tool("list_inbox", {
    description: "Lista los items del Inbox (notas/ideas sin procesar).",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    handler: async (args: { limit?: number }) => {
      const { data, error } = await db
        .from("inbox_items")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(args.limit ?? 100);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  server.tool("list_wiki_pages", {
    description: "Lista páginas wiki, opcionalmente filtradas por entity (area/project) y entity_id.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: { type: "string", enum: ["area", "project"] },
        entity_id: { type: "string" },
      },
    },
    handler: async (args: { entity_type?: string; entity_id?: string }) => {
      let q = db.from("wiki_pages").select("*").eq("user_id", userId);
      if (args.entity_type) q = q.eq("entity_type", args.entity_type);
      if (args.entity_id) q = q.eq("entity_id", args.entity_id);
      const { data, error } = await q.order("position");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  server.tool("get_wiki_page", {
    description: "Obtiene el contenido completo de una página wiki por id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: async (args: { id: string }) => {
      const { data, error } = await db.from("wiki_pages").select("*").eq("user_id", userId).eq("id", args.id).maybeSingle();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  server.tool("list_files", {
    description: "Lista archivos del usuario (metadatos, sin contenido binario).",
    inputSchema: { type: "object", properties: { folder_id: { type: "string" } } },
    handler: async (args: { folder_id?: string }) => {
      let q = db.from("user_files").select("id, name, mime_type, size, folder_id, created_at").eq("user_id", userId);
      if (args.folder_id) q = q.eq("folder_id", args.folder_id);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  server.tool("search", {
    description: "Busca texto en áreas, proyectos, tareas, inbox y wiki.",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    handler: async (args: { q: string }) => {
      const term = `%${args.q}%`;
      const [areas, projects, tasks, inbox, wiki] = await Promise.all([
        db.from("areas").select("id, name, description").eq("user_id", userId).or(`name.ilike.${term},description.ilike.${term}`).limit(20),
        db.from("projects").select("id, name, description, area_id").eq("user_id", userId).or(`name.ilike.${term},description.ilike.${term}`).limit(20),
        db.from("tasks").select("id, name, description, project_id, status").eq("user_id", userId).or(`name.ilike.${term},description.ilike.${term}`).limit(50),
        db.from("inbox_items").select("id, content, type").eq("user_id", userId).ilike("content", term).limit(50),
        db.from("wiki_pages").select("id, title, entity_type, entity_id").eq("user_id", userId).or(`title.ilike.${term},content.ilike.${term}`).limit(20),
      ]);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            areas: areas.data ?? [],
            projects: projects.data ?? [],
            tasks: tasks.data ?? [],
            inbox: inbox.data ?? [],
            wiki: wiki.data ?? [],
          }, null, 2),
        }],
      };
    },
  });

  // ---------- WRITE TOOLS ----------
  server.tool("create_inbox_item", {
    description: "Añade una nota o idea al Inbox para procesar luego.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        type: { type: "string", description: "note (default), idea, link, etc." },
      },
      required: ["content"],
    },
    handler: async (args: { content: string; type?: string }) => {
      const { data, error } = await db.from("inbox_items").insert({ user_id: userId, content: args.content, type: args.type ?? "note" }).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  const VALID_IMPORTANCE = ["none", "low", "normal", "important", "critical"];
  const normalizeImportance = (v?: string) => {
    if (!v) return v;
    if (v === "high") return "important";
    if (v === "medium") return "normal";
    return VALID_IMPORTANCE.includes(v) ? v : "normal";
  };

  server.tool("create_area", {
    description: "Crea una nueva área (dominio).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        importance: { type: "string", enum: ["none", "low", "normal", "important", "critical"] },
      },
      required: ["name"],
    },
    handler: async (args: { name: string; description?: string; importance?: string }) => {
      const { name, description } = args;
      const importance = normalizeImportance(args.importance);
      const { data, error } = await db.from("areas").insert({ user_id: userId, name, description, importance }).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  server.tool("create_project", {
    description: "Crea un proyecto dentro de un área.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        area_id: { type: "string" },
        description: { type: "string" },
        importance: { type: "string", enum: ["none", "low", "normal", "important", "critical"] },
      },
      required: ["name", "area_id"],
    },
    handler: async (args: { name: string; area_id: string; description?: string; importance?: string }) => {
      const { name, area_id, description } = args;
      const importance = normalizeImportance(args.importance);
      const { data, error } = await db.from("projects").insert({ user_id: userId, name, area_id, description, importance }).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  server.tool("create_task", {
    description: "Crea una tarea, opcionalmente dentro de un proyecto.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        project_id: { type: "string" },
        description: { type: "string" },
        importance: { type: "string", enum: ["none", "low", "normal", "important", "critical"] },
        effort: { type: "number" },
        review_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["name"],
    },
    handler: async (args: { name: string; project_id?: string; description?: string; importance?: string; effort?: number; review_date?: string }) => {
      const { name, project_id, description, effort, review_date } = args;
      const importance = normalizeImportance(args.importance);
      let task_number = 0;
      if (project_id) {
        const { data: proj, error: pErr } = await db.from("projects").select("task_counter").eq("user_id", userId).eq("id", project_id).single();
        if (pErr) throw new Error(pErr.message);
        task_number = (proj?.task_counter ?? 0) + 1;
        const { error: uErr } = await db.from("projects").update({ task_counter: task_number }).eq("user_id", userId).eq("id", project_id);
        if (uErr) throw new Error(uErr.message);
      }
      const { data, error } = await db.from("tasks").insert({ user_id: userId, name, project_id, description, importance, effort, review_date, task_number }).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  server.tool("update_task", {
    description: "Actualiza campos de una tarea (status, name, description, importance, effort, review_date, project_id).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        importance: { type: "string" },
        effort: { type: "number" },
        review_date: { type: "string" },
        project_id: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (args: any) => {
      const { id, name, description, status, importance, effort, review_date, project_id } = args;
      const patch: any = { name, description, status, effort, review_date, project_id };
      if (importance !== undefined) patch.importance = normalizeImportance(importance);
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
      const { data, error } = await db.from("tasks").update(patch).eq("user_id", userId).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  server.tool("update_project", {
    description: "Actualiza campos de un proyecto.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        importance: { type: "string" },
        review_date: { type: "string" },
        area_id: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (args: any) => {
      const { id, name, description, status, importance, review_date, area_id } = args;
      const patch: any = { name, description, status, review_date, area_id };
      if (importance !== undefined) patch.importance = normalizeImportance(importance);
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
      const { data, error } = await db.from("projects").update(patch).eq("user_id", userId).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  server.tool("update_area", {
    description: "Actualiza campos de un área.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        importance: { type: "string" },
        review_date: { type: "string" },
      },
      required: ["id"],
    },
    handler: async (args: any) => {
      const { id, name, description, status, importance, review_date } = args;
      const patch: any = { name, description, status, review_date };
      if (importance !== undefined) patch.importance = normalizeImportance(importance);
      Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
      const { data, error } = await db.from("areas").update(patch).eq("user_id", userId).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  server.tool("delete_inbox_item", {
    description: "Borra un item del inbox.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: async (args: { id: string }) => {
      const { error } = await db.from("inbox_items").delete().eq("user_id", userId).eq("id", args.id);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: "ok" }] };
    },
  });

  server.tool("upsert_wiki_page", {
    description: "Crea o actualiza una página wiki para una entidad (area/project). Si pasas id, actualiza. Si no, crea.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        entity_type: { type: "string", enum: ["area", "project"] },
        entity_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        parent_id: { type: "string" },
        position: { type: "number" },
      },
    },
    handler: async (args: { id?: string; entity_type?: string; entity_id?: string; title?: string; content?: string; parent_id?: string; position?: number }) => {
      const { id, entity_type, entity_id, title, content, parent_id, position } = args;
      if (id) {
        const update: Record<string, unknown> = {};
        if (title !== undefined) update.title = title;
        if (content !== undefined) update.content = content;
        if (parent_id !== undefined) update.parent_id = parent_id;
        if (position !== undefined) update.position = position;
        const { data, error } = await db.from("wiki_pages").update(update).eq("user_id", userId).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      }
      if (!entity_type || !entity_id) throw new Error("entity_type y entity_id son obligatorios para crear");
      const { data, error } = await db.from("wiki_pages").insert({ user_id: userId, entity_type, entity_id, title, content, parent_id, position }).select().single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  });

  return server;
}

// ============ HTTP ============
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Expose-Headers": "mcp-session-id, www-authenticate",
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });

const root = new Hono();
const app = root.basePath("/mcp");

app.use("*", async (c, next) => {
  console.log(`[mcp] ${c.req.method} ${new URL(c.req.url).pathname}`);
  await next();
});

app.options("/*", (_c) => new Response(null, { headers: corsHeaders }));

// ---------- OAuth discovery ----------
// RFC 9728 — Protected Resource Metadata
app.get("/.well-known/oauth-protected-resource", (_c) =>
  json({
    resource: MCP_BASE,
    authorization_servers: [MCP_BASE],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  }),
);

// RFC 8414 — Authorization Server Metadata
app.get("/.well-known/oauth-authorization-server", (_c) =>
  json({
    issuer: MCP_BASE,
    authorization_endpoint: `${MCP_BASE}/authorize`,
    token_endpoint: `${MCP_BASE}/token`,
    registration_endpoint: `${MCP_BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  }),
);

// Fallback: some clients append the resource path to the well-known URL
app.get("/.well-known/oauth-authorization-server/*", (_c) =>
  json({
    issuer: MCP_BASE,
    authorization_endpoint: `${MCP_BASE}/authorize`,
    token_endpoint: `${MCP_BASE}/token`,
    registration_endpoint: `${MCP_BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  }),
);
app.get("/.well-known/oauth-protected-resource/*", (_c) =>
  json({
    resource: MCP_BASE,
    authorization_servers: [MCP_BASE],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  }),
);

// Some OAuth clients (including Claude connector discovery in some flows) probe
// OIDC discovery first. Expose the same OAuth metadata there instead of 404.
app.get("/.well-known/openid-configuration", (_c) =>
  json({
    issuer: MCP_BASE,
    authorization_endpoint: `${MCP_BASE}/authorize`,
    token_endpoint: `${MCP_BASE}/token`,
    registration_endpoint: `${MCP_BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  }),
);

app.get("/.well-known/openid-configuration/*", (_c) =>
  json({
    issuer: MCP_BASE,
    authorization_endpoint: `${MCP_BASE}/authorize`,
    token_endpoint: `${MCP_BASE}/token`,
    registration_endpoint: `${MCP_BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  }),
);

// Catch-all for any other .well-known probe (e.g. openid-configuration).
// Return 404 (not 401) so clients don't think discovery itself requires auth.
app.get("/.well-known/*", (_c) =>
  new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }),
);

// ---------- Dynamic Client Registration (RFC 7591) ----------
// We accept any client; everyone gets the same opaque client_id.
app.post("/register", async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch { /* allow empty */ }
  return json({
    client_id: "mcp-public-client",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    redirect_uris: body.redirect_uris ?? [],
    client_name: body.client_name ?? "MCP Client",
  }, 201);
});

// ---------- /authorize: redirect user to consent page in the app ----------
app.get("/authorize", (c) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;
  const required = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method"];
  for (const p of required) {
    if (!params.get(p)) {
      return json({ error: "invalid_request", error_description: `Missing ${p}` }, 400);
    }
  }
  if (params.get("response_type") !== "code") {
    return json({ error: "unsupported_response_type" }, 400);
  }
  if (params.get("code_challenge_method") !== "S256") {
    return json({ error: "invalid_request", error_description: "Only S256 PKCE supported" }, 400);
  }

  // Forward all OAuth params to the consent page in the app
  const consentUrl = new URL("/oauth/authorize", APP_BASE);
  params.forEach((v, k) => consentUrl.searchParams.set(k, v));
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: consentUrl.toString() } });
});

// ---------- /oauth/approve: called by the consent page (with user JWT) ----------
app.post("/oauth/approve", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const userJwt = authHeader.slice(7).trim();

  // Validate Supabase user JWT
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
  const userId = userRes.user.id;

  let body: any;
  try { body = await c.req.json(); } catch { return json({ error: "invalid_request" }, 400); }
  const { client_id, redirect_uri, code_challenge, code_challenge_method, state, scope, resource } = body ?? {};
  if (!client_id || !redirect_uri || !code_challenge) return json({ error: "invalid_request" }, 400);
  if ((code_challenge_method ?? "S256") !== "S256") return json({ error: "invalid_request" }, 400);

  // Validate redirect_uri scheme (allow https + http://localhost)
  try {
    const u = new URL(redirect_uri);
    const ok = u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
    if (!ok) return json({ error: "invalid_request", error_description: "redirect_uri must be https or localhost" }, 400);
  } catch {
    return json({ error: "invalid_request", error_description: "invalid redirect_uri" }, 400);
  }

  // Generate authorization code
  const codeBytes = new Uint8Array(32);
  crypto.getRandomValues(codeBytes);
  const code = b64url(codeBytes);

  const admin = adminClient();
  const { error: insErr } = await admin.from("oauth_codes").insert({
    code, user_id: userId, client_id, redirect_uri,
    code_challenge, code_challenge_method: code_challenge_method ?? "S256",
    scope: scope ?? null, resource: resource ?? null,
  });
  if (insErr) return json({ error: "server_error", error_description: insErr.message }, 500);

  const back = new URL(redirect_uri);
  back.searchParams.set("code", code);
  if (state) back.searchParams.set("state", state);
  return json({ redirect_to: back.toString() });
});

// ---------- /token: exchange code for access token ----------
app.post("/token", async (c) => {
  let params: URLSearchParams;
  const ctype = c.req.header("content-type") ?? "";
  if (ctype.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await c.req.text());
  } else if (ctype.includes("application/json")) {
    const body = await c.req.json().catch(() => ({}));
    params = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
  } else {
    params = new URLSearchParams(await c.req.text());
  }

  const grant_type = params.get("grant_type");
  if (grant_type !== "authorization_code") {
    return json({ error: "unsupported_grant_type" }, 400);
  }
  const code = params.get("code");
  const redirect_uri = params.get("redirect_uri");
  const code_verifier = params.get("code_verifier");
  const client_id = params.get("client_id");
  if (!code || !redirect_uri || !code_verifier || !client_id) {
    return json({ error: "invalid_request" }, 400);
  }

  const admin = adminClient();
  const { data: row, error } = await admin.from("oauth_codes").select("*").eq("code", code).maybeSingle();
  if (error || !row) return json({ error: "invalid_grant" }, 400);
  if (row.used_at) return json({ error: "invalid_grant", error_description: "code already used" }, 400);
  if (new Date(row.expires_at) < new Date()) return json({ error: "invalid_grant", error_description: "code expired" }, 400);
  if (row.redirect_uri !== redirect_uri) return json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
  if (row.client_id !== client_id) return json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);

  // Verify PKCE: BASE64URL-ENCODE(SHA256(code_verifier)) == code_challenge
  const verifierHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code_verifier));
  const expected = b64url(new Uint8Array(verifierHash));
  if (expected !== row.code_challenge) return json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);

  // Mark code as used (single-use)
  await admin.from("oauth_codes").update({ used_at: new Date().toISOString() }).eq("code", code);

  // Mint access token
  const tokBytes = new Uint8Array(32);
  crypto.getRandomValues(tokBytes);
  const access_token = "mcp_" + Array.from(tokBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256Hex(access_token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const { error: tokErr } = await admin.from("api_tokens").insert({
    user_id: row.user_id,
    name: `OAuth (${client_id})`,
    token_hash: tokenHash,
    token_prefix: access_token.slice(0, 12),
    source: "oauth",
    expires_at: expiresAt.toISOString(),
  });
  if (tokErr) return json({ error: "server_error", error_description: tokErr.message }, 500);

  return json({
    access_token,
    token_type: "Bearer",
    expires_in: 30 * 24 * 60 * 60,
    scope: row.scope ?? "mcp",
  }, 200, { "Cache-Control": "no-store" });
});

// ---------- MCP catch-all ----------
app.all("/*", async (c) => {
  const auth = await authenticate(c.req.raw);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized: missing or invalid Bearer token" }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // RFC 9728 — point clients at the protected-resource metadata for discovery
        "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${MCP_BASE}/.well-known/oauth-protected-resource"`,
      },
    });
  }
  const server = buildServer(auth.userId, auth.admin);
  const transport = new StreamableHttpTransport();
  const response = await transport.bind(server)(c.req.raw);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
});

Deno.serve(root.fetch);
