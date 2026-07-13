import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as cheerio from 'cheerio';
import express from 'express';

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
const appCheck = admin.appCheck();

// App Check verification — ENFORCED. Confirmed in production (2026-06-30):
// preflight requests the header, the real POST succeeds, and the client
// console shows no token errors.
const APP_CHECK_ENFORCE = true;

async function checkAppCheckToken(req: express.Request): Promise<void> {
  const token = req.header('X-Firebase-AppCheck');
  if (!token) {
    console.warn(`[AppCheck] Missing token for ${req.path}`);
    if (APP_CHECK_ENFORCE) throw new Error('Missing App Check token');
    return;
  }
  try {
    await appCheck.verifyToken(token);
  } catch (e: any) {
    console.warn(`[AppCheck] Invalid token for ${req.path}: ${e.message}`);
    if (APP_CHECK_ENFORCE) throw new Error('Invalid App Check token');
  }
}

// ============================================================================
// EXPRESS APP — single function serving all /api/* routes with CORS
// ============================================================================

const ALLOWED_ORIGINS = [
  'https://segundamind.vercel.app',
  'https://brain.joseluiscarrasco.com',
  'http://localhost:8080',
  'http://localhost:5173',
];

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  next();
});

const router = express.Router();

// Helper: verify Firebase ID token
async function verifyToken(authHeader: string): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }
  const token = authHeader.slice(7);
  try {
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

// Helper: per-user sliding-window rate limit for AI endpoints (Firestore-backed
// so it works correctly across Cloud Functions cold starts/instances).
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20; // AI calls per user per minute, across all AI endpoints

class RateLimitError extends Error {
  constructor() {
    super('Demasiadas peticiones. Espera un minuto e inténtalo de nuevo.');
    this.name = 'RateLimitError';
  }
}

async function checkRateLimit(userId: string): Promise<void> {
  const ref = db.collection('rate_limits').doc(userId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const now = Date.now();
    const data = doc.data();

    if (!doc.exists || !data || now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
      tx.set(ref, { windowStart: now, count: 1 });
      return;
    }

    if (data.count >= RATE_LIMIT_MAX) {
      throw new RateLimitError();
    }

    tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
  });
}

// Helper: send the right status code for a caught error (429 for rate limit,
// 400 for everything else — keeps every route's catch block one-liner).
function sendError(res: express.Response, error: any) {
  if (error instanceof RateLimitError) {
    res.status(429).json({ error: error.message });
    return;
  }
  res.status(400).json({ error: error.message });
}

// Helper: call LLM API (Groq - Llama 3.3).
// jsonMode forces the model to emit a valid JSON object (Groq/OpenAI
// response_format) and lowers the temperature — use it for every endpoint that
// feeds parseJsonResponse, otherwise the model occasionally returns malformed
// JSON (unescaped quotes, stray prose) and parsing fails.
async function callAI(prompt: string, systemPrompt?: string, jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('LLM API key not configured');

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      temperature: jsonMode ? 0.2 : 0.7,
      max_tokens: 1024,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` }
    }
  );

  return response.data.choices?.[0]?.message?.content || '';
}

// Helper: robustly extract JSON from an LLM response that may be wrapped in
// prose ("Here's the ...") or markdown code fences.
function parseJsonResponse(text: string): any {
  if (!text) throw new Error('Empty AI response');
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) candidates.push(text.slice(objStart, objEnd + 1));
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(text.slice(arrStart, arrEnd + 1));
  candidates.push(text.trim());
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  throw new Error('Could not parse JSON from AI response');
}

// ============================================================================
// PUSH NOTIFICATIONS
// ============================================================================

router.post('/push-subscribe', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    const { action, subscription, endpoint } = req.body;

    if (action === 'subscribe' && subscription) {
      await db.collection('push_subscriptions').add({
        userId,
        endpoint: subscription.endpoint,
        p256dhKey: subscription.p256dhKey,
        authKey: subscription.authKey,
        deviceInfo: subscription.deviceInfo,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({ success: true });
    } else if (action === 'unsubscribe' && endpoint) {
      const snap = await db
        .collection('push_subscriptions')
        .where('userId', '==', userId)
        .where('endpoint', '==', endpoint)
        .get();

      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid action or missing data' });
    }
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// AI ASSISTANT - Chat with access to areas, projects, tasks
// ============================================================================

router.post('/ai-assistant', async (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');

  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array required' });
      return;
    }

    // Get user's data for context
    const [areas, projects, tasks, inbox, wikiPages] = await Promise.all([
      db.collection('areas').where('userId', '==', userId).get(),
      db.collection('projects').where('userId', '==', userId).get(),
      db.collection('tasks').where('userId', '==', userId).get(),
      db.collection('inbox_items').where('userId', '==', userId).get(),
      db.collection('wiki_pages').where('userId', '==', userId).get(),
    ]);

    const context = `
## Tu Segundo Cerebro
### Áreas (${areas.size}): ${areas.docs.map(d => d.data().name).join(', ')}
### Proyectos (${projects.size}): ${projects.docs.map(d => d.data().name).join(', ')}
### Tareas (${tasks.size}): ${tasks.docs.map(d => d.data().name).slice(0, 5).join(', ')}...
### Wiki Pages: ${wikiPages.size}

Puedes ayudar al usuario a gestionar áreas, proyectos, tareas, inbox y wiki.
`;

    const systemPrompt = `Eres un asistente inteligente para gestión de conocimiento personal.
${context}

Responde de forma concisa y útil. Cuando el usuario pida crear/actualizar elementos, confirma antes de hacerlo.`;

    const userMessage = messages[messages.length - 1]?.content || '';
    const response = await callAI(userMessage, systemPrompt);

    // Send as SSE
    res.write('data: ' + JSON.stringify({ content: response }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    res.write('data: ' + JSON.stringify({ error: error.message }) + '\n\n');
    res.end();
  }
});

// ============================================================================
// WIKI CHAT - Answer questions based on wiki pages
// ============================================================================

router.post('/wiki-chat', async (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array required' });
      return;
    }

    // Get user's wiki pages as context
    const wikiSnapshot = await db
      .collection('wiki_pages')
      .where('userId', '==', userId)
      .get();

    const wikiContext = wikiSnapshot.docs
      .map(doc => `# ${doc.data().title}\n${doc.data().content}`)
      .join('\n\n');

    const userMessage = messages[messages.length - 1]?.content || '';
    const systemPrompt = `Eres un asistente que responde preguntas basadas en la siguiente wiki personal:

${wikiContext}

Responde basándote únicamente en la información de la wiki. Si no encuentras la respuesta, di que no está en la wiki.`;

    const response = await callAI(userMessage, systemPrompt);

    res.write('data: ' + JSON.stringify({ content: response }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    res.write('data: ' + JSON.stringify({ error: error.message }) + '\n\n');
    res.end();
  }
});

// ============================================================================
// WIKI GENERATE - AI generates wiki page content
// ============================================================================

router.post('/wiki-generate', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { title, entityType, entityId } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Title required' });
      return;
    }

    const prompt = `Generate a comprehensive wiki page for: "${title}" (${entityType}: ${entityId})

Write in markdown format. Include:
- Clear title
- Overview section
- Key points (if applicable)
- References or related topics

IMPORTANT: Write the entire page in the SAME LANGUAGE as the title above (if the title is in Spanish, write in Spanish).`;

    const content = await callAI(prompt);

    // Save to Firestore
    const docRef = await db.collection('wiki_pages').add({
      userId,
      entityType,
      entityId,
      title,
      content,
      position: 0,
      parentId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: docRef.id, content });
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// WIKI EDIT - AI edits existing wiki page
// ============================================================================

router.post('/wiki-edit', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { pageId, instruction } = req.body;

    if (!pageId || !instruction) {
      res.status(400).json({ error: 'pageId and instruction required' });
      return;
    }

    // Get existing page
    const doc = await db.collection('wiki_pages').doc(pageId).get();
    if (!doc.exists || doc.data()?.userId !== userId) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const currentContent = doc.data()?.content || '';
    const prompt = `Edit this wiki page based on the instruction:

Current content:
${currentContent}

Instruction: ${instruction}

Return the updated content in markdown format.
IMPORTANT: Write in the SAME LANGUAGE as the current content above (if it is in Spanish, answer in Spanish).`;

    const updatedContent = await callAI(prompt);

    // Update in Firestore
    await db.collection('wiki_pages').doc(pageId).update({
      content: updatedContent,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ content: updatedContent });
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// CLASSIFY INBOX - AI categorizes inbox items
// ============================================================================

router.post('/classify-inbox', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { content, projects: clientProjects = [], areas: clientAreas = [] } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Content required' });
      return;
    }

    // Use provided projects/areas or fetch from DB
    let projects = clientProjects;
    let projectIds: Record<string, string> = {};
    let areas = clientAreas;

    if (projects.length === 0) {
      const projectsSnapshot = await db
        .collection('projects')
        .where('userId', '==', userId)
        .get();
      projects = projectsSnapshot.docs.map(d => {
        projectIds[d.data().name] = d.id;
        return d.data().name;
      });
    } else {
      // Build project ID map from client data
      clientProjects.forEach((p: any) => {
        projectIds[p.name] = p.id;
      });
    }

    if (areas.length === 0) {
      const areasSnapshot = await db
        .collection('areas')
        .where('userId', '==', userId)
        .get();
      areas = areasSnapshot.docs.map(d => d.data().name);
    }

    const prompt = `Analyze and classify this inbox item:

Item: "${content}"

Available projects: ${projects.join(', ')}
Available areas: ${areas.join(', ')}

IMPORTANT: Write "suggestedName", "suggestedDescription" and "reasoning" in
the SAME LANGUAGE as the item content above (if the item is in Spanish, answer
in Spanish). Keep the JSON keys and the enum values exactly as specified.

Respond with JSON: {
  "suggestedName": "...",
  "suggestedDescription": "...",
  "suggestedAction": "task" | "note",
  "importance": "critical" | "important" | "normal" | "low" | "none",
  "projectName": "..." (most relevant project),
  "reasoning": "..."
}`;

    const response = await callAI(prompt, undefined, true);
    const classification = parseJsonResponse(response);

    // Map project name to ID
    const projectId = projectIds[classification.projectName] || '';

    res.json({
      suggestedName: classification.suggestedName,
      suggestedDescription: classification.suggestedDescription,
      suggestedAction: classification.suggestedAction,
      importance: classification.importance,
      projectId,
      reasoning: classification.reasoning,
    });
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// SCRAPING HELPERS
// ============================================================================

interface ScrapedContent {
  title: string;
  description: string;
  content: string;
  imageUrl?: string;
}

function extractOpenGraphTags(html: string): Partial<ScrapedContent> {
  const $ = cheerio.load(html);
  return {
    title: $('meta[property="og:title"]').attr('content') || $('title').text() || '',
    description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '',
    imageUrl: $('meta[property="og:image"]').attr('content'),
  };
}

async function scrapeInstagram(url: string, html: string): Promise<ScrapedContent> {
  const $ = cheerio.load(html);
  const ogData = extractOpenGraphTags(html);

  const caption = ogData.description || '';
  const hashtags = caption.match(/#\w+/g) || [];
  const mentions = caption.match(/@\w+/g) || [];

  return {
    title: ogData.title || 'Instagram Post',
    description: caption,
    content: `
Post by: ${ogData.title}
Caption: ${caption}
Hashtags: ${hashtags.join(', ')}
Mentions: ${mentions.join(', ')}
URL: ${url}
    `.trim(),
    imageUrl: ogData.imageUrl,
  };
}

async function scrapeTwitter(url: string, html: string): Promise<ScrapedContent> {
  const $ = cheerio.load(html);
  const ogData = extractOpenGraphTags(html);

  const tweetText = ogData.description || '';

  return {
    title: ogData.title || 'Tweet',
    description: tweetText,
    content: `
${tweetText}
URL: ${url}
    `.trim(),
    imageUrl: ogData.imageUrl,
  };
}

async function scrapeYouTube(url: string, html: string): Promise<ScrapedContent> {
  const $ = cheerio.load(html);
  const ogData = extractOpenGraphTags(html);

  const title = ogData.title || 'YouTube Video';
  const description = ogData.description || '';

  return {
    title,
    description,
    content: `
Title: ${title}
Description: ${description}
URL: ${url}
    `.trim(),
    imageUrl: ogData.imageUrl,
  };
}

async function scrapeMedium(url: string, html: string): Promise<ScrapedContent> {
  const $ = cheerio.load(html);
  const ogData = extractOpenGraphTags(html);

  const title = ogData.title || 'Medium Article';
  const description = ogData.description || '';

  const articleText = $('article').text() || $('main').text() || '';
  const preview = articleText.substring(0, 1000);

  return {
    title,
    description,
    content: `
Title: ${title}
Description: ${description}
Preview: ${preview}
URL: ${url}
    `.trim(),
    imageUrl: ogData.imageUrl,
  };
}

async function scrapeGeneric(url: string, html: string): Promise<ScrapedContent> {
  const $ = cheerio.load(html);
  const ogData = extractOpenGraphTags(html);

  const mainContent = $('article').text() || $('main').text() || $('body').text() || '';
  const textContent = mainContent
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 5000);

  return {
    title: ogData.title || 'Web Page',
    description: ogData.description || '',
    content: textContent || html.substring(0, 3000),
    imageUrl: ogData.imageUrl,
  };
}

// ============================================================================
// ENRICH URL - Intelligent link processing for inbox
// ============================================================================

router.post('/enrich-url', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ error: 'URL required' });
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(url);
      if (urlObj.hostname.includes('internal') || urlObj.hostname.includes('localhost')) {
        throw new Error('Invalid URL');
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    let scrapedContent: ScrapedContent = {
      title: 'Web Page',
      description: '',
      content: '',
    };

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        timeout: 8000,
      });

      const html = response.data;
      const hostname = urlObj.hostname.toLowerCase();

      if (hostname.includes('instagram.com')) {
        scrapedContent = await scrapeInstagram(url, html);
      } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
        scrapedContent = await scrapeTwitter(url, html);
      } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        scrapedContent = await scrapeYouTube(url, html);
      } else if (hostname.includes('medium.com')) {
        scrapedContent = await scrapeMedium(url, html);
      } else {
        scrapedContent = await scrapeGeneric(url, html);
      }
    } catch (e: any) {
      console.error('Scrape error:', e.message);
      scrapedContent = {
        title: 'Web Page',
        description: 'Could not fetch content',
        content: `URL: ${url}`,
      };
    }

    const isVideo = url.includes('instagram.com') || url.includes('youtube.com') || url.includes('youtu.be');

    const prompt = isVideo
      ? `Este es un video/reel que el usuario quiere revisar y aprender de él.

Título: ${scrapedContent.title}
Descripción: ${scrapedContent.description}

Proporciona:
1. Un nombre CORTO para la tarea (max 50 caracteres) que capture el tema principal
2. Una descripción BREVE (2-3 líneas) de qué se puede aprender
3. Sugerencia: ¿es para investigar, probar algo, o inspiración?

Responde con JSON: {
  "suggestedName": "...",
  "suggestedDescription": "...",
  "importance": "important" | "normal" | "low",
  "suggestedCategory": "investigar" | "probar" | "inspiracion" | "referencia"
}`
      : `Este es un contenido web que el usuario quiere revisar.

Título: ${scrapedContent.title}
Descripción: ${scrapedContent.description}
Contenido: ${scrapedContent.content}

Proporciona:
1. Un nombre conciso para la tarea
2. Descripción breve de qué aprender
3. Categoría sugerida

Responde con JSON: {
  "suggestedName": "...",
  "suggestedDescription": "...",
  "importance": "important" | "normal" | "low",
  "suggestedCategory": "investigar" | "probar" | "inspiracion" | "referencia"
}`;

    const aiResponse = await callAI(prompt, undefined, true);
    const result = parseJsonResponse(aiResponse);

    if (scrapedContent.imageUrl) {
      result.imageUrl = scrapedContent.imageUrl;
    }
    result.url = url;

    res.json(result);
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// SCRAPE AND SUMMARIZE - Fetch URL content and summarize
// ============================================================================

router.post('/scrape-and-summarize', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ error: 'URL required' });
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(url);
      if (urlObj.hostname.includes('internal') || urlObj.hostname.includes('localhost')) {
        throw new Error('Invalid URL');
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    let scrapedContent: ScrapedContent = {
      title: 'Web Page',
      description: '',
      content: '',
    };

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        timeout: 8000,
      });

      const html = response.data;
      const hostname = urlObj.hostname.toLowerCase();

      // Domain-specific scraping
      if (hostname.includes('instagram.com')) {
        scrapedContent = await scrapeInstagram(url, html);
      } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
        scrapedContent = await scrapeTwitter(url, html);
      } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        scrapedContent = await scrapeYouTube(url, html);
      } else if (hostname.includes('medium.com')) {
        scrapedContent = await scrapeMedium(url, html);
      } else {
        scrapedContent = await scrapeGeneric(url, html);
      }
    } catch (e: any) {
      console.error('Scrape error:', e.message);
      scrapedContent = {
        title: 'Web Page',
        description: 'Could not fetch content',
        content: `URL: ${url}`,
      };
    }

    const prompt = `Analiza este contenido web y proporciona:
1. Un resumen breve (1-2 oraciones)
2. 3-4 puntos clave
3. Si esto es útil para investigar, probar, inspiración, etc.

Contenido:
Título: ${scrapedContent.title}
Descripción: ${scrapedContent.description}
Contenido: ${scrapedContent.content}
URL: ${url}

Responde con JSON: {
  "title": "...",
  "summary": "...",
  "keyPoints": ["...", "...", "..."],
  "suggestedCategory": "investigar" | "probar" | "inspiracion" | "referencia" | "otro"
}`;

    const aiResponse = await callAI(prompt, undefined, true);
    const result = parseJsonResponse(aiResponse);

    if (scrapedContent.imageUrl) {
      result.imageUrl = scrapedContent.imageUrl;
    }

    res.json(result);
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// ANALYZE ATTACHMENT - AI analyzes uploaded files
// ============================================================================

router.post('/analyze-attachment', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { fileUrl, mimeType, currentName, currentDescription } = req.body;

    if (!fileUrl) {
      res.status(400).json({ error: 'fileUrl required' });
      return;
    }

    const isImage = mimeType?.startsWith('image/');
    let result;

    try {
      if (isImage) {
        // For images: download as buffer, convert to base64, send to AI with vision
        const imageResponse = await axios.get(fileUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
        });
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');
        const base64Image = imageBuffer.toString('base64');

        const prompt = `You are an expert at analyzing images and documents.

User context: ${currentName} ${currentDescription}

Please analyze this image and provide:
1. A clear, descriptive name (suggestedName)
2. A detailed description of what you see (suggestedDescription)
3. Any additional notes or insights (additionalNotes)
4. A brief summary (summary)
5. Any URLs or links mentioned in the image (urls array)
6. If this seems time-sensitive, suggest a review date (suggestedReviewDate in YYYY-MM-DD format, or null)

IMPORTANT: Write "suggestedName", "suggestedDescription", "additionalNotes" and "summary" in
the SAME LANGUAGE as the user context above (if it is in Spanish, answer in Spanish; default to Spanish if no context is given).

Respond with JSON: {
  "suggestedName": "...",
  "suggestedDescription": "...",
  "additionalNotes": "...",
  "summary": "...",
  "urls": [],
  "suggestedReviewDate": null
}`;

        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.2-11b-vision-preview',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType};base64,${base64Image}`,
                    },
                  },
                ],
              },
            ],
            temperature: 0.7,
            max_tokens: 1024,
          },
          {
            headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}` },
          }
        );

        result = parseJsonResponse(response.data.choices?.[0]?.message?.content || '{}');
      } else {
        // For non-image files: fetch as text
        let fileContent = '';
        try {
          const response = await axios.get(fileUrl, { timeout: 10000 });
          fileContent = response.data.substring ? response.data.substring(0, 10000) : response.data;
        } catch (e) {
          fileContent = '(Could not fetch file)';
        }

        const prompt = `Analyze this file/document and extract useful information:

File type: ${mimeType}
Content: ${fileContent}
User context: ${currentName} ${currentDescription}

IMPORTANT: Write "suggestedName", "suggestedDescription", "additionalNotes" and "summary" in
the SAME LANGUAGE as the file content/user context above (if it is in Spanish, answer in Spanish; default to Spanish if no language is detectable).

Respond with JSON: {
  "suggestedName": "...",
  "suggestedDescription": "...",
  "additionalNotes": "...",
  "summary": "...",
  "urls": [],
  "suggestedReviewDate": null
}`;

        const response = await callAI(prompt, undefined, true);
        result = parseJsonResponse(response);
      }
    } catch (aiError: any) {
      console.error('AI API error:', aiError.message);
      // Fallback: basic file analysis
      result = {
        suggestedName: currentName || `File (${mimeType})`,
        suggestedDescription: currentDescription || 'Archivo adjunto al inbox',
        additionalNotes: 'Análisis de archivo completado',
        summary: 'Archivo procesado',
        urls: [],
        suggestedReviewDate: null,
      };
    }

    res.json(result);
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// WIKI SUGGEST STRUCTURE - AI suggests wiki page organization
// ============================================================================

router.post('/wiki-suggest-structure', async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    await checkRateLimit(userId);
    await checkAppCheckToken(req);
    const { pages, entityName, entityType } = req.body;

    if (!Array.isArray(pages)) {
      res.status(400).json({ error: 'pages array required' });
      return;
    }

    const pagesText = pages
      .map((p: any) => `- ${p.title} (content preview: ${p.contentPreview})`)
      .join('\n');

    const prompt = `Analyze this wiki structure and suggest improvements:

Entity: ${entityType} "${entityName}"
Pages:
${pagesText}

Suggest 2-3 structural improvements (moves, reorders, or groupings) that would make navigation better.

IMPORTANT: Write "reason" and "suggestedTitle" in the SAME LANGUAGE as the page titles above (if they are in Spanish, answer in Spanish).

Respond with JSON: {
  "suggestions": [
    {
      "type": "move" | "reorder" | "group",
      "pageId": "...",
      "newParentId": "..." (for move),
      "order": [...] (for reorder),
      "pageIds": [...] (for group),
      "suggestedTitle": "..." (for group),
      "reason": "..."
    }
  ]
}`;

    const response = await callAI(prompt, undefined, true);
    const result = parseJsonResponse(response);

    res.json(result);
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// OAuth 2.0 + MCP - Model Context Protocol server
// ============================================================================

// OAuth endpoints (REST) for Claude's standard OAuth flow
router.get('/oauth/authorize', async (req, res) => {
  try {
    const { response_type, client_id, redirect_uri, state, code_challenge } = req.query;
    if (response_type !== 'code') {
      res.status(400).json({ error: 'response_type must be "code"' });
      return;
    }
    if (!client_id || !redirect_uri) {
      res.status(400).json({ error: 'Missing client_id or redirect_uri' });
      return;
    }

    // Generate authorization code (auto-approve; Claude Desktop is a trusted app)
    const code = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await db.collection('oauth_codes').doc(code).set({
      clientId: client_id as string,
      redirectUri: redirect_uri as string,
      codeChallenge: code_challenge as string || null,
      expiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      autoApproved: true, // Claude Desktop is trusted
    });

    const redirectUrl = new URL(redirect_uri as string);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state as string);

    res.redirect(redirectUrl.toString());
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/oauth/token', async (req, res) => {
  try {
    const { code, code_verifier, grant_type } = req.body;

    const codeDoc = await db.collection('oauth_codes').doc(code).get();
    if (!codeDoc.exists) {
      res.status(400).json({ error: 'invalid_code' });
      return;
    }

    const codeData = codeDoc.data();
    if (!codeData) {
      res.status(400).json({ error: 'invalid_code' });
      return;
    }

    if (codeData.expiresAt < new Date()) {
      res.status(400).json({ error: 'expired_code' });
      return;
    }

    // Verify PKCE if code_challenge was set
    if (codeData.codeChallenge) {
      const crypto = require('crypto');
      const hash = crypto
        .createHash('sha256')
        .update(code_verifier || '')
        .digest('base64url');
      if (hash !== codeData.codeChallenge) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
    }

    // For Claude OAuth: create a custom token for a "Claude" virtual user
    // Every code_id maps to a unique Firebase custom token scoped to that OAuth session
    const customToken = await auth.createCustomToken(`claude-oauth-${code}`);

    await db.collection('oauth_codes').doc(code).delete();

    res.json({
      access_token: customToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// MCP - Model Context Protocol server (Streamable HTTP + JSON-RPC 2.0)
// ============================================================================

// Auth: personal tokens (mcp_…) created in the "Acceso para Claude (MCP)"
// dialog. Only the SHA-256 hash is stored in api_tokens; the bearer token is
// hashed and looked up. Returns the owning userId — every tool is scoped to it.
async function verifyMcpToken(req: express.Request): Promise<string> {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new Error('Missing bearer token');
  const token = header.slice(7).trim();
  const hash = require('crypto').createHash('sha256').update(token).digest('hex');
  const snap = await db.collection('api_tokens').where('tokenHash', '==', hash).limit(1).get();
  if (snap.empty) throw new Error('Invalid token');
  const tokenDoc = snap.docs[0];
  // Refresh lastUsedAt at most every 5 minutes to avoid write churn
  const last = tokenDoc.data().lastUsedAt?.toMillis?.() ?? 0;
  if (Date.now() - last > 5 * 60 * 1000) {
    tokenDoc.ref.update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  }
  return tokenDoc.data().userId;
}

const toIso = (t: any): string | null => t?.toDate?.()?.toISOString?.() ?? null;

const TASK_STATUSES = ['funnel', 'ready', 'active', 'waiting', 'blocked', 'finished'];
const IMPORTANCES = ['critical', 'important', 'normal', 'low', 'none'];

async function fetchOwned(col: string, userId: string) {
  const snap = await db.collection(col).where('userId', '==', userId).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
}

async function getOwnedDoc(col: string, id: string, userId: string) {
  const snap = await db.collection(col).doc(id).get();
  if (!snap.exists || snap.data()!.userId !== userId) throw new Error(`Documento no encontrado: ${col}/${id}`);
  return { id: snap.id, ...snap.data() } as any;
}

const MCP_TOOLS = [
  {
    name: 'list_areas',
    description: 'Lista todas las áreas de vida/trabajo del usuario (nivel superior de la jerarquía Área → Proyecto → Tarea).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_projects',
    description: 'Lista los proyectos del usuario, opcionalmente filtrados por área.',
    inputSchema: {
      type: 'object',
      properties: { areaId: { type: 'string', description: 'Filtrar por ID de área' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description: 'Lista tareas. Por defecto excluye las terminadas (finished). Estados: funnel, ready, active, waiting, blocked, finished.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filtrar por ID de proyecto' },
        status: { type: 'string', enum: TASK_STATUSES, description: 'Filtrar por estado' },
        includeFinished: { type: 'boolean', description: 'Incluir tareas terminadas (por defecto false)' },
        limit: { type: 'number', description: 'Máximo de resultados (por defecto 100)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description: 'Obtiene el detalle completo de una tarea por su ID.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description: 'Crea una tarea en un proyecto. Importancia: critical, important, normal, low, none. reviewDate en formato YYYY-MM-DD.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        importance: { type: 'string', enum: IMPORTANCES },
        status: { type: 'string', enum: TASK_STATUSES },
        reviewDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['projectId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description: 'Actualiza campos de una tarea (nombre, descripción, estado, importancia, fecha de revisión, esfuerzo en minutos).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: TASK_STATUSES },
        importance: { type: 'string', enum: IMPORTANCES },
        reviewDate: { type: ['string', 'null'], description: 'YYYY-MM-DD o null para quitar la fecha' },
        effort: { type: ['number', 'null'], description: 'Esfuerzo estimado en minutos, o null' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_inbox_item',
    description: 'Captura rápida: añade una nota o enlace al inbox universal para procesar después.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_inbox',
    description: 'Lista los elementos pendientes del inbox universal.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search',
    description: 'Busca por texto en nombres y descripciones de áreas, proyectos y tareas.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_wiki_pages',
    description: 'Lista las páginas de wiki/documentación, opcionalmente filtradas por la entidad a la que pertenecen.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string', enum: ['area', 'project', 'task'] },
        entityId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_wiki_page',
    description: 'Obtiene el contenido Markdown completo de una página de wiki.',
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string' } },
      required: ['pageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_wiki_page',
    description: 'Crea una página de wiki (Markdown) asociada a un área, proyecto o tarea.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string', enum: ['area', 'project', 'task'] },
        entityId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Contenido en Markdown' },
      },
      required: ['entityType', 'entityId', 'title', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_wiki_page',
    description: 'Actualiza el título y/o contenido Markdown de una página de wiki.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['pageId'],
      additionalProperties: false,
    },
  },
];

async function runMcpTool(name: string, args: any, userId: string): Promise<any> {
  switch (name) {
    case 'list_areas': {
      const areas = await fetchOwned('areas', userId);
      return areas.map(a => ({
        id: a.id, name: a.name, description: a.description || null,
        importance: a.importance, status: a.status, reviewDate: a.reviewDate || null,
      }));
    }

    case 'list_projects': {
      let projects = await fetchOwned('projects', userId);
      if (args.areaId) projects = projects.filter(p => p.areaId === args.areaId);
      return projects.map(p => ({
        id: p.id, key: p.key, name: p.name, areaId: p.areaId,
        description: p.description || null, importance: p.importance,
        status: p.status, reviewDate: p.reviewDate || null,
      }));
    }

    case 'list_tasks': {
      let tasks = await fetchOwned('tasks', userId);
      const projects = await fetchOwned('projects', userId);
      const keyOf = (pid: string) => projects.find(p => p.id === pid)?.key || '?';
      if (args.projectId) tasks = tasks.filter(t => t.projectId === args.projectId);
      if (args.status) tasks = tasks.filter(t => t.status === args.status);
      else if (!args.includeFinished) tasks = tasks.filter(t => t.status !== 'finished');
      const limit = Math.min(Number(args.limit) || 100, 500);
      return tasks.slice(0, limit).map(t => ({
        id: t.id, displayId: `${keyOf(t.projectId)}-${t.taskNumber}`, name: t.name,
        projectId: t.projectId, status: t.status, importance: t.importance,
        reviewDate: t.reviewDate || null, effort: t.effort ?? null,
        description: t.description || null,
      }));
    }

    case 'get_task': {
      const t = await getOwnedDoc('tasks', args.taskId, userId);
      return {
        id: t.id, name: t.name, projectId: t.projectId, taskNumber: t.taskNumber,
        status: t.status, importance: t.importance, reviewDate: t.reviewDate || null,
        effort: t.effort ?? null, description: t.description || null,
        createdAt: toIso(t.createdAt),
      };
    }

    case 'create_task': {
      if (args.status && !TASK_STATUSES.includes(args.status)) throw new Error('Estado inválido');
      if (args.importance && !IMPORTANCES.includes(args.importance)) throw new Error('Importancia inválida');
      const created = await db.runTransaction(async tx => {
        const pRef = db.collection('projects').doc(args.projectId);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists || pSnap.data()!.userId !== userId) throw new Error('Proyecto no encontrado');
        const next = (pSnap.data()!.taskCounter ?? 0) + 1;
        tx.update(pRef, { taskCounter: next });
        const tRef = db.collection('tasks').doc();
        tx.set(tRef, {
          projectId: args.projectId,
          taskNumber: next,
          name: args.name,
          description: args.description || '',
          status: args.status || 'funnel',
          importance: args.importance || 'normal',
          effort: null,
          reviewDate: args.reviewDate || null,
          userId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { id: tRef.id, displayId: `${pSnap.data()!.key}-${next}` };
      });
      return { ok: true, ...created };
    }

    case 'update_task': {
      await getOwnedDoc('tasks', args.taskId, userId); // ownership check
      if (args.status && !TASK_STATUSES.includes(args.status)) throw new Error('Estado inválido');
      if (args.importance && !IMPORTANCES.includes(args.importance)) throw new Error('Importancia inválida');
      const patch: any = {};
      for (const f of ['name', 'description', 'status', 'importance', 'reviewDate', 'effort']) {
        if (args[f] !== undefined) patch[f] = args[f];
      }
      if (Object.keys(patch).length === 0) throw new Error('Nada que actualizar');
      await db.collection('tasks').doc(args.taskId).update(patch);
      return { ok: true, updated: Object.keys(patch) };
    }

    case 'add_inbox_item': {
      const isLink = /^https?:\/\//i.test(args.content.trim());
      const ref = await db.collection('inbox_items').add({
        content: args.content,
        type: isLink ? 'link' : 'note',
        userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, id: ref.id };
    }

    case 'list_inbox': {
      const items = await fetchOwned('inbox_items', userId);
      return items.map(i => ({ id: i.id, content: i.content, type: i.type, createdAt: toIso(i.createdAt) }));
    }

    case 'search': {
      const q = String(args.query || '').toLowerCase();
      if (!q) throw new Error('Query vacía');
      const [areas, projects, tasks] = await Promise.all([
        fetchOwned('areas', userId), fetchOwned('projects', userId), fetchOwned('tasks', userId),
      ]);
      const match = (x: any) =>
        (x.name || '').toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q);
      return {
        areas: areas.filter(match).map(a => ({ id: a.id, name: a.name })),
        projects: projects.filter(match).map(p => ({ id: p.id, key: p.key, name: p.name })),
        tasks: tasks.filter(match).slice(0, 50).map(t => ({
          id: t.id, name: t.name, status: t.status, projectId: t.projectId,
        })),
      };
    }

    case 'list_wiki_pages': {
      let pages = await fetchOwned('wiki_pages', userId);
      if (args.entityType) pages = pages.filter(w => w.entityType === args.entityType);
      if (args.entityId) pages = pages.filter(w => w.entityId === args.entityId);
      return pages.map(w => ({
        id: w.id, title: w.title, entityType: w.entityType, entityId: w.entityId,
        parentId: w.parentId || null, updatedAt: toIso(w.updatedAt),
      }));
    }

    case 'get_wiki_page': {
      const w = await getOwnedDoc('wiki_pages', args.pageId, userId);
      return {
        id: w.id, title: w.title, content: w.content || '',
        entityType: w.entityType, entityId: w.entityId, updatedAt: toIso(w.updatedAt),
      };
    }

    case 'create_wiki_page': {
      const siblings = (await fetchOwned('wiki_pages', userId))
        .filter(w => w.entityType === args.entityType && w.entityId === args.entityId);
      const ref = await db.collection('wiki_pages').add({
        entityType: args.entityType,
        entityId: args.entityId,
        title: args.title,
        content: args.content,
        parentId: null,
        position: siblings.length,
        userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, id: ref.id };
    }

    case 'update_wiki_page': {
      await getOwnedDoc('wiki_pages', args.pageId, userId); // ownership check
      const patch: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (args.title !== undefined) patch.title = args.title;
      if (args.content !== undefined) patch.content = args.content;
      await db.collection('wiki_pages').doc(args.pageId).update(patch);
      return { ok: true };
    }

    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
}

router.all('/mcp', async (req, res) => {
  try {
    const { path, method, body } = req.body || {};

    // For OAuth authorize endpoint
    if (path === '/oauth/approve' && method === 'POST') {
      const userId = await verifyToken(req.headers.authorization || '');
      const { client_id, redirect_uri, code_challenge, state } = body;

      // Generate authorization code
      const code = require('crypto').randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      await db.collection('oauth_codes').doc(code).set({
        clientId: client_id,
        userId,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        expiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state);

      res.json({ redirect_to: redirectUrl.toString() });
      return;
    }

    // For token exchange
    if (path === '/oauth/token' && method === 'POST') {
      const { code, code_verifier } = body;

      const codeDoc = await db.collection('oauth_codes').doc(code).get();
      if (!codeDoc.exists) {
        res.status(400).json({ error: 'invalid_code' });
        return;
      }

      const codeData = codeDoc.data();
      if (!codeData) {
        res.status(400).json({ error: 'invalid_code' });
        return;
      }

      if (codeData.expiresAt < new Date()) {
        res.status(400).json({ error: 'expired_code' });
        return;
      }

      // Verify PKCE
      const crypto = require('crypto');
      const hash = crypto
        .createHash('sha256')
        .update(code_verifier)
        .digest('base64url');

      if (hash !== codeData.codeChallenge) {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }

      // Issue token
      const token = await auth.createCustomToken(codeData.userId);

      await db.collection('oauth_codes').doc(code).delete();

      res.json({ access_token: token, token_type: 'Bearer' });
      return;
    }

    // ---- MCP protocol (Streamable HTTP transport) ----
    // Stateless server: no SSE stream, no sessions. Clients POST JSON-RPC 2.0
    // messages and get a JSON response.
    if (req.method === 'GET') {
      res.status(405).json({ error: 'SSE stream not supported. POST JSON-RPC messages.' });
      return;
    }
    if (req.method === 'DELETE') {
      res.status(200).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const msg = req.body;
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      res.status(400).json({ error: 'Expected a JSON-RPC 2.0 message' });
      return;
    }

    // Notifications (no id) just get acknowledged
    if (msg.id === undefined || msg.id === null) {
      res.status(202).send('');
      return;
    }

    const reply = (result: any) => res.json({ jsonrpc: '2.0', id: msg.id, result });

    switch (msg.method) {
      case 'initialize':
        reply({
          protocolVersion: typeof msg.params?.protocolVersion === 'string'
            ? msg.params.protocolVersion : '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'segundo-cerebro', version: '1.0.0' },
        });
        return;

      case 'ping':
        reply({});
        return;

      case 'tools/list':
        await verifyMcpToken(req);
        reply({ tools: MCP_TOOLS });
        return;

      case 'tools/call': {
        const userId = await verifyMcpToken(req);
        const toolName = msg.params?.name;
        const toolArgs = msg.params?.arguments || {};
        try {
          const result = await runMcpTool(toolName, toolArgs, userId);
          reply({
            content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            }],
          });
        } catch (toolError: any) {
          // Tool failures are results (isError), not protocol errors
          reply({ content: [{ type: 'text', text: `Error: ${toolError.message}` }], isError: true });
        }
        return;
      }

      case 'resources/list':
        reply({ resources: [] });
        return;

      case 'prompts/list':
        reply({ prompts: [] });
        return;

      default:
        res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
        return;
    }
  } catch (error: any) {
    // Auth failures on MCP requests → 401 so clients surface re-auth
    const isAuthError = /token/i.test(error.message || '');
    const id = req.body?.id ?? null;
    res.status(isAuthError ? 401 : 400).json({
      jsonrpc: '2.0', id, error: { code: isAuthError ? -32001 : -32603, message: error.message },
    });
  }
});

// Mount the router at both /api and / so it works whether or not the
// Cloud Functions function-name prefix ("/api") is stripped from the path.
app.use('/api', router);
app.use('/', router);

// Single HTTPS function serving every route above.
exports.api = functions.https.onRequest(app);
