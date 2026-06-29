import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Sparkles, Loader2, Wrench, AlertCircle, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/cloud-functions';
import { toast } from 'sonner';

type ToolEvent = { name: string; args: any; ok: boolean };
type Msg = { role: 'user' | 'assistant'; content: string; toolEvents?: ToolEvent[] };

const SUGGESTIONS = [
  '¿Qué tengo para hoy?',
  'Crea una tarea: revisar emails mañana',
  'Resume mi inbox sin procesar',
  '¿Qué proyectos están bloqueados?',
];

export function AiAssistantView() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || !user) return;
    const next: Msg[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const payload = next.map(m => ({ role: m.role, content: m.content }));
      const data = await cloudFunctions.aiAssistant({ messages: payload }, user);

      setMessages(prev => [...prev, { role: 'assistant', content: data.content || '', toolEvents: data.toolEvents || [] }]);
    } catch (e: any) {
      const errMsg = e?.message || 'Error desconocido';
      toast.error(errMsg);
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-65px)] max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Asistente IA</h1>
            <p className="text-xs text-muted-foreground">Consulta y modifica tu segundo cerebro en lenguaje natural</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-secondary transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpiar
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-lg font-medium mb-1">¿En qué te ayudo?</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Puedo leer y modificar áreas, proyectos, tareas, inbox y wiki. Pregúntame o pídeme acciones.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-sm px-3 py-2 rounded-md border border-border hover:bg-secondary transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
              m.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}>
              {m.toolEvents && m.toolEvents.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {m.toolEvents.map((t, j) => (
                    <span key={j} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                      t.ok ? 'bg-background/50 text-muted-foreground' : 'bg-destructive/20 text-destructive'
                    }`}>
                      {t.ok ? <Wrench className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
                      {t.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-2">
                <ReactMarkdown>{m.content || (m.role === 'assistant' ? '...' : '')}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-2xl px-4 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Pensando...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border px-6 py-4">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Pregunta o pide una acción..."
            rows={1}
            disabled={loading}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring max-h-32"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
