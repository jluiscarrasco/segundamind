import { User } from 'firebase/auth';
import { getAppCheckHeader } from '@/integrations/firebase/config';

export const API_BASE = import.meta.env.VITE_APP_BASE_URL || 'http://localhost:8082';

async function callFunction(endpoint: string, body: any, user: User | null) {
  if (!user) throw new Error('Not authenticated');

  const token = await user.getIdToken();
  const appCheckToken = await getAppCheckHeader();
  const response = await fetch(`${API_BASE}/api${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Function call failed');
  return data;
}

export const cloudFunctions = {
  wikiGenerate: (params: any, user: User | null) =>
    callFunction('/wiki-generate', params, user),

  wikiEdit: (params: any, user: User | null) =>
    callFunction('/wiki-edit', params, user),

  wikiChat: (params: any, user: User | null) =>
    callFunction('/wiki-chat', params, user),

  wikiSuggestStructure: (params: any, user: User | null) =>
    callFunction('/wiki-suggest-structure', params, user),

  aiAssistant: (params: any, user: User | null) =>
    callFunction('/ai-assistant', params, user),

  classifyInbox: (params: any, user: User | null) =>
    callFunction('/classify-inbox', params, user),

  enrichUrl: (params: any, user: User | null) =>
    callFunction('/enrich-url', params, user),

  analyzeAttachment: (params: any, user: User | null) =>
    callFunction('/analyze-attachment', params, user),

  scrapeAndSummarize: (params: any, user: User | null) =>
    callFunction('/scrape-and-summarize', params, user),

  // Streaming responses
  async *aiAssistantStream(params: any, user: User | null) {
    if (!user) throw new Error('Not authenticated');

    const token = await user.getIdToken();
    const appCheckToken = await getAppCheckHeader();
    const response = await fetch(`${API_BASE}/api/ai-assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) throw new Error('AI assistant failed');
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') return;
            if (jsonStr) {
              yield JSON.parse(jsonStr);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
};
