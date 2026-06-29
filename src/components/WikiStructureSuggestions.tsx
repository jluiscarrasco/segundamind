import { useState } from 'react';
import { Sparkles, ArrowRight, Layers, ArrowUpDown, Check, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { WikiPage } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Suggestion {
  type: 'move' | 'reorder' | 'group';
  pageId?: string;
  newParentId?: string;
  parentId?: string;
  order?: string[];
  pageIds?: string[];
  suggestedTitle?: string;
  reason: string;
}

interface WikiStructureSuggestionsProps {
  pages: WikiPage[];
  entityType: string;
  entityId: string;
  entityName: string;
  onUpdate: (id: string, patch: Partial<WikiPage>) => void;
  onAdd: (page: Omit<WikiPage, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string | null> | void;
  onClose: () => void;
}

export default function WikiStructureSuggestions({
  pages, entityType, entityId, entityName, onUpdate, onAdd, onClose,
}: WikiStructureSuggestionsProps) {
  const { user } = useAuth();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [fetched, setFetched] = useState(false);

  const fetchSuggestions = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const pagesInput = pages.map(p => ({
        id: p.id,
        title: p.title,
        parentId: p.parentId,
        position: p.position,
        contentPreview: p.content.slice(0, 200),
      }));

      const token = await user.getIdToken();
      const response = await fetch('/api/wiki-suggest-structure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ pages: pagesInput, entityName, entityType }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error');

      setSuggestions(data.suggestions || []);
      setFetched(true);
      if (!data.suggestions?.length) {
        toast.info('La estructura actual ya es óptima 👍');
      }
    } catch (err: any) {
      console.error('Suggest structure error:', err);
      toast.error('Error al analizar la estructura');
    } finally {
      setLoading(false);
    }
  };

  const applySuggestion = async (idx: number) => {
    const s = suggestions[idx];

    if (s.type === 'move' && s.pageId) {
      const newParent = s.newParentId === 'root' ? null : (s.newParentId || null);
      onUpdate(s.pageId, { parentId: newParent });
      toast.success('Página movida');
    } else if (s.type === 'reorder' && s.order) {
      s.order.forEach((pageId, i) => {
        onUpdate(pageId, { position: i });
      });
      toast.success('Páginas reordenadas');
    } else if (s.type === 'group' && s.pageIds && s.suggestedTitle) {
      // Build content for the grouping page with links to child pages
      const childTitles = s.pageIds.map(id => {
        const p = pages.find(pg => pg.id === id);
        return p ? `- **${p.title}**` : null;
      }).filter(Boolean).join('\n');

      const groupContent = `## ${s.suggestedTitle}\n\n> Página agrupadora que reúne contenido relacionado.\n\nEsta sección contiene las siguientes páginas:\n\n${childTitles}`;

      const siblings = pages.filter(p => p.parentId === null);
      const newId = await onAdd({
        entityType: entityType as any,
        entityId,
        parentId: null,
        title: s.suggestedTitle,
        content: groupContent,
        position: siblings.length,
      });

      // Move child pages under the new group
      if (newId) {
        s.pageIds.forEach((pageId, i) => {
          onUpdate(pageId, { parentId: newId, position: i });
        });
        toast.success(`Páginas agrupadas bajo "${s.suggestedTitle}"`);
      } else {
        toast.error('Error al crear la página agrupadora');
        return;
      }
    }

    setApplied(prev => new Set(prev).add(idx));
  };

  const dismissSuggestion = (idx: number) => {
    setDismissed(prev => new Set(prev).add(idx));
  };

  const getPageTitle = (id?: string) => {
    if (!id || id === 'root') return 'Raíz';
    return pages.find(p => p.id === id)?.title || '?';
  };

  const iconForType = (type: string) => {
    switch (type) {
      case 'move': return <ArrowRight className="w-3.5 h-3.5 text-primary" />;
      case 'reorder': return <ArrowUpDown className="w-3.5 h-3.5 text-accent" />;
      case 'group': return <Layers className="w-3.5 h-3.5 text-primary" />;
      default: return null;
    }
  };

  const labelForType = (type: string) => {
    switch (type) {
      case 'move': return 'Mover';
      case 'reorder': return 'Reordenar';
      case 'group': return 'Agrupar';
      default: return type;
    }
  };

  const descForSuggestion = (s: Suggestion) => {
    if (s.type === 'move') {
      return `Mover "${getPageTitle(s.pageId)}" → dentro de "${getPageTitle(s.newParentId)}"`;
    }
    if (s.type === 'reorder') {
      const names = s.order?.map(id => `"${getPageTitle(id)}"`).join(', ');
      return `Reordenar: ${names}`;
    }
    if (s.type === 'group') {
      const names = s.pageIds?.map(id => `"${getPageTitle(id)}"`).join(', ');
      return `Agrupar ${names} bajo "${s.suggestedTitle}"`;
    }
    return '';
  };

  const visibleSuggestions = suggestions.filter((_, i) => !dismissed.has(i));

  return (
    <div className="border border-primary/20 rounded-lg bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">Sugerencias de estructura</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!fetched && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            La IA analizará tus {pages.length} páginas y sugerirá mejoras en la jerarquía y organización.
          </p>
          <button
            onClick={fetchSuggestions}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {loading ? 'Analizando...' : 'Analizar estructura'}
          </button>
        </div>
      )}

      {fetched && visibleSuggestions.length === 0 && (
        <p className="text-xs text-muted-foreground">No hay más sugerencias pendientes.</p>
      )}

      {visibleSuggestions.map((s, vIdx) => {
        const realIdx = suggestions.indexOf(s);
        const isApplied = applied.has(realIdx);

        return (
          <div key={realIdx} className={`border rounded-lg p-3 space-y-2 transition-colors ${isApplied ? 'border-green-300 bg-green-50/50' : 'border-border bg-card'}`}>
            <div className="flex items-center gap-2">
              {iconForType(s.type)}
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{labelForType(s.type)}</span>
            </div>
            <p className="text-xs text-foreground font-medium">{descForSuggestion(s)}</p>
            <p className="text-xs text-muted-foreground italic">{s.reason}</p>

            {!isApplied && (
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => dismissSuggestion(realIdx)}
                  className="px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  Descartar
                </button>
                <button
                  onClick={() => applySuggestion(realIdx)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors"
                >
                  <Check className="w-3 h-3" /> Aplicar
                </button>
              </div>
            )}

            {isApplied && (
              <div className="flex items-center gap-1 text-green-600 text-[10px] font-medium">
                <Check className="w-3 h-3" /> Aplicada
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
