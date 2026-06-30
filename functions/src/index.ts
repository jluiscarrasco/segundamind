import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as cheerio from 'cheerio';
import express from 'express';

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
const appCheck = admin.appCheck();

// App Check verification — MONITOR MODE: logs missing/invalid tokens but does
// not block requests yet. Flip APP_CHECK_ENFORCE to true once the frontend is
// confirmed to be sending valid 'X-Firebase-AppCheck' headers in production.
const APP_CHECK_ENFORCE = false;

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

// Helper: call LLM API (Groq - Llama 3.3)
async function callAI(prompt: string, systemPrompt?: string) {
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
      temperature: 0.7,
      max_tokens: 1024,
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

    const response = await callAI(prompt);
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

    const aiResponse = await callAI(prompt);
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

    const aiResponse = await callAI(prompt);
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

        const response = await callAI(prompt);
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

    const response = await callAI(prompt);
    const result = parseJsonResponse(response);

    res.json(result);
  } catch (error: any) {
    sendError(res, error);
  }
});

// ============================================================================
// MCP - Model Context Protocol server
// ============================================================================

router.all('/mcp', async (req, res) => {
  try {
    const { action, path, method, body } = req.body;

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

    res.status(400).json({ error: 'Unknown endpoint' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Mount the router at both /api and / so it works whether or not the
// Cloud Functions function-name prefix ("/api") is stripped from the path.
app.use('/api', router);
app.use('/', router);

// Single HTTPS function serving every route above.
exports.api = functions.https.onRequest(app);
