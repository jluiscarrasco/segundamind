# JL's Brain — Documentación Técnica del Proyecto

> Segundo cerebro personal para gestionar **áreas → proyectos → tareas**, con captura universal (texto, enlaces, audio, archivos), procesamiento con IA, calendario, base de conocimiento y gestión de archivos.

---

## 1. Resumen

**JL's Brain** (carpeta de código: `segundamind`, proyecto Firebase: `secondbrain-765b9`, dominio: *MiClario.com*) es una PWA de productividad personal tipo "second brain". Organiza el trabajo en una jerarquía de tres niveles y prioriza automáticamente mediante un motor de scoring.

- **Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui
- **Estado/datos:** Firebase (Auth + Firestore en tiempo real + Storage)
- **Backend dev:** servidor Express local (`server.ts`) para llamadas a IA
- **Backend prod:** Firebase Functions (`functions/`)
- **IA:** Groq (LLM Llama 3.3 / visión) — la clave se llama `GEMINI_API_KEY` por motivos históricos, pero apunta a Groq

---

## 2. URLs y recursos

| Recurso | URL |
|---|---|
| Consola Firebase | https://console.firebase.google.com/project/secondbrain-765b9/overview |
| Firebase Storage | https://console.firebase.google.com/project/secondbrain-765b9/storage |
| Firestore | https://console.firebase.google.com/project/secondbrain-765b9/firestore |
| Storage bucket | `secondbrain-765b9.firebasestorage.app` |
| Dev UI (Vite) | http://localhost:8080 |
| Dev API (Express) | http://localhost:8082 |
| Dominio público | MiClario.com |
| Groq API | https://api.groq.com/openai/v1/chat/completions |

---

## 3. Stack tecnológico

- **React 18.3** + **TypeScript 5.8**
- **Vite 5** (`@vitejs/plugin-react-swc`) + **vite-plugin-pwa**
- **Tailwind 3.4** + **shadcn/ui** (Radix UI) + **tailwindcss-animate** + `@tailwindcss/typography`
- **Framer Motion** (animaciones)
- **Firebase 12** (`firebase`) + **firebase-admin 14** (functions)
- **Express 4** + **tsx** (servidor dev)
- **Groq** vía `axios`
- **react-markdown** + **remark-gfm** (render de wikis)
- **pdfjs-dist** (previsualización PDF), **cheerio** (scraping de URLs)
- **sonner** (toasts), **cmdk** (command palette), **recharts** (gráficos)
- **Web Speech API** (transcripción de audio, nativa del navegador)

---

## 4. Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  NAVEGADOR (PWA)                                          │
│  React + Vite  ──────────────────►  Firebase SDK         │
│   localhost:8080                     · Auth (Google)      │
│        │                             · Firestore (RT)     │
│        │  /api/* (fetch)             · Storage            │
│        ▼                                                  │
│  Servidor Express dev (server.ts)                         │
│   localhost:8082  ──────────────►  Groq API (IA)          │
└─────────────────────────────────────────────────────────┘

En producción, /api/* lo sirven las Firebase Functions (functions/).
```

- `npm run dev` arranca **a la vez** Vite (UI) y Express (`tsx server.ts`) con `concurrently`.
- El cliente decide la base de la API con `VITE_APP_BASE_URL` (dev: `http://localhost:8082`).
- Firestore usa **listeners en tiempo real** (`onSnapshot`): la UI refleja cambios al instante.

---

## 5. Modelo de datos

Jerarquía: **Área → Proyecto → Tarea**. Toda entidad pertenece a un usuario (`userId`).

### Área
`id, userId, name, description, status, importance, reviewDate, createdAt`

### Proyecto
`id, userId, areaId, key (3 letras, ej. "SEC"), name, description, status, importance, reviewDate, createdAt, taskCounter`

### Tarea
`id, userId, projectId, taskNumber (secuencial por proyecto), name, description, status, importance, effort, reviewDate, createdAt`

> **ID legible de tarea:** `{key}-{taskNumber}` (ej. `SEC-12`). El `taskCounter` del proyecto auto-incrementa.

### Enumeraciones
- **Importance:** `critical | important | normal | low | none`
- **Status:** `funnel | ready | blocked | active | finished`
- **Effort (min):** `5, 10, 15, 25, 45, 60, 120, 180, 300, 480, null`

### Otras entidades
- **InboxItem** — captura universal (`type`: note | link | image, `content`)
- **WikiPage** — `entityType (area|project|task) + entityId`, `parentId`, `title`, `content` (markdown), `position`
- **Resource** — enlaces/recursos asociados a entidades
- **UserFolder / UserFile / UserFileLink** — gestor de archivos (Drive)

---

## 6. Motor de scoring (`src/lib/scoring.ts`)

Prioriza tareas automáticamente:

```
total = round( (base + urgencia + cascada) × multiplicador )
```

- **base** — según importancia
- **urgencia** — `Vencida +50`, `Hoy +35`, `Mañana +25`
- **cascada** — bonus si el proyecto/área padre es crítico
- **multiplicador de estado** — `funnel ×0.5`, `ready/active ×1`, `blocked ×0.1`, `finished → 0`

Funciones: `scoreTask`, `scoreTaskDetailed`, `scoreProject`, `scoreArea`, `computeAreaHealth`, `computeGlobalHealth`, `isGroomingCandidate`.

---

## 7. Funcionalidades clave

### Inbox Universal (`InboxPanel.tsx`)
Captura texto, enlaces, **audio** (transcripción en vivo) y **archivos** (análisis IA). Clasifica con IA y propone tarea/nota + proyecto + importancia.

### Transcripción de audio (`useAudioRecorder.ts`)
Usa **Web Speech API** del navegador (no API externa). Transcribe **en tiempo real mientras se graba** (es-ES); al parar, espera 300 ms y devuelve el texto acumulado al input. Disponible en desktop (Inbox) y móvil (`MobileNoteCaptureView`).

### Dashboard — Tu Agenda (`TuAgenda.tsx`)
Vista unificada en 3 columnas: **Vencidas | Para Hoy | Próximos 7d**. Acciones hover de posponer (+1d / +7d).

### Calendario (`CalendarView.tsx`)
Vistas semana (por defecto en dashboard) y mes. **Drag & drop** de tareas para reprogramar.

### Command Palette y atajos
`Cmd/Ctrl+K` paleta de comandos, `Cmd+Shift+K` panel de contexto, `Cmd+N` nueva tarea, `?` ayuda, `Esc` cerrar. Registro central en `src/lib/shortcuts.ts`.

### Base de Conocimiento (`KnowledgeBaseView.tsx`)
Árbol de wikis (Área › Proyecto), lectura en markdown y **chat IA** sobre todo el conocimiento. Las páginas se **crean/editan** desde el panel de detalle de cada área/proyecto, pestaña **Wiki** (`WikiPageEditor.tsx`).

### Archivos / Drive (`FilesView.tsx` + `useDrive.ts`)
Carpetas, subida a Firebase Storage, mover, renombrar, etiquetas, enlaces a entidades, previsualización (PDF/imagen).

### PWA + Push
Instalable, con notificaciones push (`usePushNotifications.ts`, `sw-push.js`).

---

## 8. Endpoints del servidor (`server.ts`)

| Endpoint | Función |
|---|---|
| `POST /api/classify-inbox` | Clasifica una captura → tarea/nota + proyecto + importancia |
| `POST /api/analyze-attachment` | Analiza imagen/documento con IA (visión) |
| `POST /api/transcribe-audio` | (Legacy) transcripción server-side vía Groq Whisper |
| `POST /api/enrich-url` | Enriquece un enlace (scraping + resumen) |
| `POST /api/scrape-and-summarize` | Scrape + resumen de una página |
| `POST /api/ai-assistant` | Chat IA en streaming (SSE) |

---

## 9. Colecciones Firestore y seguridad

Colecciones: `areas, projects, tasks, inbox_items, resources, wiki_pages, user_folders, user_files, user_file_tags, user_file_links, api_tokens, push_subscriptions`.

- Reglas en `firestore.rules`: acceso solo a usuarios autenticados (`request.auth != null`); deny-all por defecto.
- **Importante:** los listeners filtran por `where('userId','==',uid)` y **ordenan en JavaScript** — NO usar `orderBy()` en la query salvo que exista índice compuesto (provoca fallos silenciosos del listener).
- Storage (`storage.rules`): cada usuario solo accede a `/{userId}/...`. Rutas de Drive: `{userId}/drive/{fileId}.{ext}`.

---

## 10. Variables de entorno (`.env`)

```
VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID,
VITE_FIREBASE_APP_ID, VITE_FIREBASE_MEASUREMENT_ID,
VITE_GEMINI_API_KEY / GEMINI_API_KEY  (→ en realidad Groq),
VITE_APP_BASE_URL  (dev: http://localhost:8082)
```

> ⚠️ Nunca commitear `.env` ni `serviceAccountKey.json`.

---

## 11. Flujo de desarrollo

```bash
npm run dev          # Vite (8080) + Express (8082) a la vez
npm run dev:ui       # solo Vite
npm run dev:server   # solo Express
npm run build        # build de producción
npm run test         # tests (vitest)
firebase deploy --only storage     # desplegar reglas de Storage
firebase deploy --only firestore   # desplegar reglas de Firestore
```

---

## 12. Decisiones y "gotchas" importantes

- **Firebase Storage requiere plan Blaze** (ya no entra en el gratuito Spark). Hay que activarlo en consola antes de poder subir archivos; el bucket no existe hasta hacer "Get Started".
- **Audio = Web Speech API**, no Groq Whisper: más rápido, sin coste, transcribe en vivo. La transcripción server-side quedó como legacy.
- **No usar `orderBy` en queries de Firestore** combinado con `where` sin índice compuesto: el `onSnapshot` falla en silencio. Ordenar en JS.
- **`mapXxx(doc)` debe recibir `{ id: doc.id, ...doc.data() }`**, no el snapshot crudo (si no, los campos salen `undefined`).
- **Sin auto-seed de carpetas:** se eliminó porque duplicaba "Trabajo/Personal" en cada recarga. Hay limpieza única de duplicados vacíos.
- La marca es **JL's Brain** con icono `Brain` (Lucide) unificado en todas las vistas.
