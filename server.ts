import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

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

// Helper: call Gemini API
async function callGemini(prompt: string, systemPrompt?: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key not configured');

  const response = await axios.post(
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    {
      model: 'gemini-2.0-flash',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
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
      const response = await callGemini(prompt);
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

    let fileContent = '';
    try {
      const response = await axios.get(fileUrl, { timeout: 10000 });
      fileContent = response.data.substring(0, 10000);
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

    let result;
    try {
      const response = await callGemini(prompt);
      result = parseJsonResponse(response);
    } catch (geminiError: any) {
      console.error('Gemini API error:', geminiError.message);
      // Fallback: basic file analysis
      result = {
        suggestedName: currentName || `File (${mimeType})`,
        suggestedDescription: currentDescription || 'Archivo adjunto al inbox',
        additionalNotes: 'Análisis de archivo completado',
        summary: fileContent.substring(0, 200),
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
// SCRAPE AND SUMMARIZE
// ============================================================================

app.post('/api/scrape-and-summarize', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ error: 'URL required' });
      return;
    }

    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes('internal') || urlObj.hostname.includes('localhost')) {
        throw new Error('Invalid URL');
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    let content = '';
    try {
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      content = response.data.substring(0, 5000);
    } catch (e) {
      // Continue without content
    }

    const prompt = `Summarize this webpage content:

URL: ${url}
Content: ${content || '(Could not fetch content)'}

Respond with JSON: { "title": "...", "summary": "...", "keyPoints": [...] }`;

    const response = await callGemini(prompt);
    const result = parseJsonResponse(response);

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
    const response = await callGemini(userMessage, systemPrompt);

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
