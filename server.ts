import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';

dotenv.config();

const app = express();
app.use(express.json());

// Enable CORS for all origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Helper: call LLM API (Groq - Llama 3.3).
// jsonMode forces valid JSON output (Groq response_format) + lower temperature;
// use it for endpoints that feed parseJsonResponse.
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
      max_tokens: 2048,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` }
    }
  );

  return response.data.choices?.[0]?.message?.content || '';
}

// Helper: extract JSON from markdown code blocks
function parseJsonResponse(text: string): any {
  // Try to extract JSON from markdown code blocks
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch (e) {
      // If it fails, try parsing the whole text
    }
  }

  // Try parsing the whole text as JSON
  return JSON.parse(text);
}

// ============================================================================
// CLASSIFY INBOX
// ============================================================================

app.post('/api/classify-inbox', async (req, res) => {
  try {
    const { content, projects = [], areas = [] } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Content required' });
      return;
    }

    let projectList = projects;
    let projectIds: Record<string, string> = {};
    let areaList = areas;

    projectList.forEach((p: any) => {
      projectIds[p.name] = p.id;
    });

    const prompt = `Analyze and classify this inbox item:

Item: "${content}"

Available projects: ${projectList.map((p: any) => p.name).join(', ')}
Available areas: ${areaList.map((a: any) => a.name).join(', ')}

Respond with JSON: {
  "suggestedName": "...",
  "suggestedDescription": "...",
  "suggestedAction": "task" | "note",
  "importance": "critical" | "important" | "normal" | "low" | "none",
  "projectName": "..." (most relevant project, or empty string),
  "reasoning": "..."
}`;

    let classification;
    try {
      const response = await callAI(prompt, undefined, true);
      classification = parseJsonResponse(response);
    } catch (geminiError: any) {
      console.error('Gemini API error:', geminiError.message);
      // Fallback: generate basic suggestions without Gemini
      classification = {
        suggestedName: content.substring(0, 100),
        suggestedDescription: 'Procesado automáticamente desde el inbox',
        suggestedAction: 'task',
        importance: 'normal',
        projectName: projectList[0]?.name || '',
        reasoning: 'Sugerencias por defecto (API no disponible)',
      };
    }

    const projectId = projectIds[classification.projectName] || (projectList[0]?.id || '');

    res.json({
      suggestedName: classification.suggestedName,
      suggestedDescription: classification.suggestedDescription,
      suggestedAction: classification.suggestedAction,
      importance: classification.importance,
      projectId,
      reasoning: classification.reasoning,
    });
  } catch (error: any) {
    console.error('classifyInbox error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// ANALYZE ATTACHMENT
// ============================================================================

app.post('/api/analyze-attachment', async (req, res) => {
  try {
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
    console.error('analyzeAttachment error:', error);
    res.status(400).json({ error: error.message });
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

  // Instagram stores caption in og:description
  const caption = ogData.description || '';
  // Extract hashtags and mentions for additional context
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

  // Twitter/X includes tweet text in og:description
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

  // YouTube includes title, description, and duration in og tags
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

  // Extract article preview if available
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

  // Extract main content intelligently
  let content = '';
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

// Transcribe audio to text using Groq Whisper
app.post('/api/transcribe-audio', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'audioBase64 required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'LLM API key not configured' });
    }

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    // Use Groq's Whisper model for transcription via OpenAI-compatible API
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: 'audio.webm', contentType: mimeType });
    formData.append('model', 'whisper-large-v3-turbo');

    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const transcript = response.data.text || '';
    res.json({ transcript, success: true });
  } catch (err: any) {
    console.error('Audio transcription error:', err?.response?.data || err.message);
    res.status(500).json({ error: err?.response?.data?.error?.message || err.message || 'Failed to transcribe audio' });
  }
});

app.post('/api/enrich-url', async (req, res) => {
  try {
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
    console.error('enrichUrl error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// SCRAPE AND SUMMARIZE
// ============================================================================

app.post('/api/scrape-and-summarize', async (req, res) => {
  try {
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
      // Fallback: try to extract og:title and og:description at minimum
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

    // Ensure result has the image if we found one
    if (scrapedContent.imageUrl) {
      result.imageUrl = scrapedContent.imageUrl;
    }

    res.json(result);
  } catch (error: any) {
    console.error('scrapeAndSummarize error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// AI ASSISTANT (streaming) - placeholder
// ============================================================================

app.post('/api/ai-assistant', async (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');

  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array required' });
      return;
    }

    const systemPrompt = `Eres un asistente inteligente para gestión de conocimiento personal.
Responde de forma concisa y útil. Cuando el usuario pida crear/actualizar elementos, confirma antes de hacerlo.`;

    const userMessage = messages[messages.length - 1]?.content || '';
    const response = await callAI(userMessage, systemPrompt);

    res.write('data: ' + JSON.stringify({ content: response }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    res.write('data: ' + JSON.stringify({ error: error.message }) + '\n\n');
    res.end();
  }
});

// Placeholder routes for other functions
['wiki-generate', 'wiki-edit', 'wiki-chat', 'wiki-suggest-structure'].forEach(path => {
  app.post(`/api/${path}`, async (req, res) => {
    res.status(501).json({ error: `${path} not yet implemented on dev server` });
  });
});

const PORT = 8082;
app.listen(PORT, () => {
  console.log(`📡 Dev API server running on http://localhost:${PORT}`);
  console.log(`✅ Make sure GEMINI_API_KEY is set in .env`);
});
