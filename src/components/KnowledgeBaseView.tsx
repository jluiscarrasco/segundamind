import { useState, useRef, useEffect, useCallback } from 'react';
import { BookOpen, Search, MessageCircle, Send, Loader2, ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import type { Area, Project, WikiPage } from '@/types';
import { auth } from '@/integrations/firebase/config';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  wikiPages: WikiPage[];
  areas: Area[];
  projects: Project[];
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `${import.meta.env.VITE_APP_BASE_URL || 'http://localhost:8082'}/api/wiki-chat`;

export function KnowledgeBaseView({ wikiPages, areas, projects }: Props) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build tree: Area > Project > Pages
  const areaMap = new Map(areas.map(a => [a.id, a]));
  const projectMap = new Map(projects.map(p => [p.id, p]));

  type TreeNode = { area: Area; projects: { project: Project; pages: WikiPage[] }[]; areaPages: WikiPage[] };

  const tree: TreeNode[] = areas.map(area => {
    const areaProjects = projects.filter(p => p.areaId === area.id);
    return {
      area,
      areaPages: wikiPages.filter(w => w.entityType === 'area' && w.entityId === area.id),
      projects: areaProjects.map(project => ({
        project,
        pages: wikiPages.filter(w => w.entityType === 'project' && w.entityId === project.id),
      })).filter(p => p.pages.length > 0),
    };
  }).filter(n => n.areaPages.length > 0 || n.projects.length > 0);

  const filteredTree = search.trim()
    ? tree.map(node => {
        const q = search.toLowerCase();
        const filteredAreaPages = node.areaPages.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
        const filteredProjects = node.projects.map(pn => ({
          ...pn,
          pages: pn.pages.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)),
        })).filter(pn => pn.pages.length > 0);
        return { ...node, areaPages: filteredAreaPages, projects: filteredProjects };
      }).filter(n => n.areaPages.length > 0 || n.projects.length > 0)
    : tree;

  const selectedPage = selectedPageId ? wikiPages.find(w => w.id === selectedPageId) : null;

  // Build wiki context for AI
  const buildWikiContext = useCallback(() => {
    return wikiPages.map(w => {
      let path = '';
      if (w.entityType === 'area') {
        const area = areaMap.get(w.entityId);
        path = area ? `Área: ${area.name}` : 'Área desconocida';
      } else {
        const project = projectMap.get(w.entityId);
        const area = project ? areaMap.get(project.areaId) : null;
        path = `${area?.name || '?'} > ${project?.name || '?'}`;
      }
      return { title: w.title || 'Sin título', content: w.content, path };
    });
  }, [wikiPages, areaMap, projectMap]);

  // Streaming chat
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setSelectedPageId(null);

    let assistantSoFar = '';

    try {
      if (!user) {
        toast.error('Debes iniciar sesión');
        setIsLoading(false);
        return;
      }

      const token = await user.getIdToken();
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: newMessages,
          wikiContext: buildWikiContext(),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Error de conexión' }));
        toast.error(err.error || `Error ${resp.status}`);
        setIsLoading(false);
        return;
      }

      if (!resp.body) throw new Error('No response body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: 'assistant', content: assistantSoFar }];
              });
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Flush remaining
      if (buffer.trim()) {
        for (let raw of buffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: 'assistant', content: assistantSoFar }];
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error('Chat error:', e);
      toast.error('Error al conectar con la IA');
    }

    setIsLoading(false);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const showChat = !selectedPage;

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Sidebar */}
      <div className="w-72 border-r border-border bg-card flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar páginas..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {/* Chat button */}
            <button
              onClick={() => setSelectedPageId(null)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !selectedPage ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Chat IA
            </button>

            <div className="h-px bg-border my-2" />

            {filteredTree.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                No hay páginas wiki
              </p>
            )}

            {filteredTree.map(node => (
              <div key={node.area.id} className="space-y-0.5">
                <div className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {node.area.name}
                </div>

                {node.areaPages.map(page => (
                  <button
                    key={page.id}
                    onClick={() => setSelectedPageId(page.id)}
                    className={`w-full text-left px-2.5 py-1 rounded text-xs truncate transition-colors ${
                      selectedPageId === page.id ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-secondary'
                    }`}
                  >
                    {page.title || 'Sin título'}
                  </button>
                ))}

                {node.projects.map(pn => (
                  <div key={pn.project.id} className="ml-2">
                    <div className="px-2 py-0.5 text-[10px] text-muted-foreground font-medium">
                      {pn.project.name}
                    </div>
                    {pn.pages.map(page => (
                      <button
                        key={page.id}
                        onClick={() => setSelectedPageId(page.id)}
                        className={`w-full text-left px-2.5 py-1 rounded text-xs truncate transition-colors ${
                          selectedPageId === page.id ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-secondary'
                        }`}
                      >
                        {page.title || 'Sin título'}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="p-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground text-center">
            {wikiPages.length} página{wikiPages.length !== 1 ? 's' : ''} en la base de conocimiento
          </p>
        </div>
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col">
        {showChat ? (
          <>
            {/* Chat messages */}
            <ScrollArea className="flex-1">
              <div className="max-w-3xl mx-auto p-6 space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <BookOpen className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-sm font-medium text-foreground mb-1">Base de Conocimiento</h3>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      Pregunta cualquier cosa sobre tu conocimiento acumulado en las wikis. 
                      La IA tiene acceso a todas tus páginas.
                    </p>
                    {wikiPages.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-2">
                        {wikiPages.length} página{wikiPages.length !== 1 ? 's' : ''} disponibles como contexto
                      </p>
                    )}
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-foreground'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none wiki-content" style={{ fontFamily: '"Anthropic Sans", ui-sans-serif, system-ui, -apple-system, sans-serif' }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="flex justify-start">
                    <div className="bg-secondary rounded-lg px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </ScrollArea>

            {/* Chat input */}
            <div className="border-t border-border p-3">
              <form
                onSubmit={e => { e.preventDefault(); sendMessage(); }}
                className="max-w-3xl mx-auto flex gap-2"
              >
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Pregunta sobre tu base de conocimiento..."
                  className="flex-1 h-9 text-sm"
                  disabled={isLoading}
                />
                <Button type="submit" size="sm" disabled={isLoading || !input.trim()} className="h-9 px-3">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </form>
            </div>
          </>
        ) : (
          /* Page reading view */
          <ScrollArea className="flex-1">
            <div className="max-w-3xl mx-auto p-6">
              <button
                onClick={() => setSelectedPageId(null)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                Volver al chat
              </button>

              <h1 className="text-lg font-bold mb-1">{selectedPage.title || 'Sin título'}</h1>

              {/* Breadcrumb */}
              <p className="text-[10px] text-muted-foreground mb-4">
                {selectedPage.entityType === 'area'
                  ? areaMap.get(selectedPage.entityId)?.name
                  : (() => {
                      const proj = projectMap.get(selectedPage.entityId);
                      const area = proj ? areaMap.get(proj.areaId) : null;
                      return `${area?.name || '?'} › ${proj?.name || '?'}`;
                    })()}
              </p>

              <div className="prose prose-sm dark:prose-invert max-w-none wiki-content" style={{ fontFamily: '"Anthropic Sans", ui-sans-serif, system-ui, -apple-system, sans-serif' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedPage.content}</ReactMarkdown>
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
