import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

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

// Helper: call Gemini API
async function callGemini(prompt: string, systemPrompt?: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key not configured');

  const response = await axios.post(
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    {
      model: 'gemini-2.5-flash',
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

// ============================================================================
// PUSH NOTIFICATIONS
// ============================================================================

exports.pushSubscribe = functions.https.onRequest(async (req, res) => {
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

exports.aiAssistant = functions.https.onRequest(async (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  res.set('Cache-Control', 'no-cache');
  res.set('Connection', 'keep-alive');

  try {
    const userId = await verifyToken(req.headers.authorization || '');
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
    const response = await callGemini(userMessage, systemPrompt);

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

exports.wikiChat = functions.https.onRequest(async (req, res) => {
  res.set('Content-Type', 'text/event-stream');
  try {
    const userId = await verifyToken(req.headers.authorization || '');
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

    const response = await callGemini(userMessage, systemPrompt);

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

exports.wikiGenerate = functions.https.onRequest(async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
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
- References or related topics`;

    const content = await callGemini(prompt);

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
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// WIKI EDIT - AI edits existing wiki page
// ============================================================================

exports.wikiEdit = functions.https.onRequest(async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
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

Return the updated content in markdown format.`;

    const updatedContent = await callGemini(prompt);

    // Update in Firestore
    await db.collection('wiki_pages').doc(pageId).update({
      content: updatedContent,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ content: updatedContent });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// CLASSIFY INBOX - AI categorizes inbox items
// ============================================================================

exports.classifyInbox = functions.https.onRequest(async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
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

Respond with JSON: {
  "suggestedName": "...",
  "suggestedDescription": "...",
  "suggestedAction": "task" | "note",
  "importance": "critical" | "important" | "normal" | "low" | "none",
  "projectName": "..." (most relevant project),
  "reasoning": "..."
}`;

    const response = await callGemini(prompt);
    const classification = JSON.parse(response);

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
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// SCRAPE AND SUMMARIZE - Fetch URL content and summarize
// ============================================================================

exports.scrapeAndSummarize = functions.https.onRequest(async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ error: 'URL required' });
      return;
    }

    // Validate URL origin (SSRF prevention)
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes('internal') || urlObj.hostname.includes('localhost')) {
        throw new Error('Invalid URL');
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    // Try to fetch content
    let content = '';
    try {
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      content = response.data.substring(0, 5000); // Limit content
    } catch (e) {
      // Continue without content if fetch fails
    }

    const prompt = `Summarize this webpage content:

URL: ${url}
Content: ${content || '(Could not fetch content)'}

Respond with JSON: { "title": "...", "summary": "...", "keyPoints": [...] }`;

    const response = await callGemini(prompt);
    const result = JSON.parse(response);

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// ANALYZE ATTACHMENT - AI analyzes uploaded files
// ============================================================================

exports.analyzeAttachment = functions.https.onRequest(async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
    const { fileUrl, mimeType, currentName, currentDescription } = req.body;

    if (!fileUrl) {
      res.status(400).json({ error: 'fileUrl required' });
      return;
    }

    // Download and analyze file content
    let fileContent = '';
    try {
      const response = await axios.get(fileUrl, { timeout: 10000 });
      fileContent = response.data.substring(0, 10000); // Limit content
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

    const response = await callGemini(prompt);
    const result = JSON.parse(response);

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// WIKI SUGGEST STRUCTURE - AI suggests wiki page organization
// ============================================================================

exports.wikiSuggestStructure = functions.https.onRequest(async (req, res) => {
  try {
    const userId = await verifyToken(req.headers.authorization || '');
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

    const response = await callGemini(prompt);
    const result = JSON.parse(response);

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// MCP - Model Context Protocol server
// ============================================================================

exports.mcp = functions.https.onRequest(async (req, res) => {
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
