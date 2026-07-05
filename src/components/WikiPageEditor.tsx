import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus, Trash2, ChevronRight, ChevronDown, FileText, Eye, Edit3, BookOpen, Sparkles, Loader2, Lightbulb } from 'lucide-react';
import type { WikiPage, EntityType } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/cloud-functions';
import { toast } from 'sonner';
import WikiStructureSuggestions from './WikiStructureSuggestions';

interface WikiPageEditorProps {
  pages: WikiPage[];
  entityType: EntityType;
  entityId: string;
  entityName: string;
  onAdd: (page: Omit<WikiPage, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string | null> | void;
  onUpdate: (id: string, patch: Partial<WikiPage>) => void;
  onDelete: (id: string) => void;
}

interface TreeNode {
  page: WikiPage;
  children: TreeNode[];
}

function buildTree(pages: WikiPage[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const sorted = [...pages].sort((a, b) => a.position - b.position);
  sorted.forEach(p => map.set(p.id, { page: p, children: [] }));
  sorted.forEach(p => {
    const node = map.get(p.id)!;
    if (p.parentId && map.has(p.parentId)) {
      map.get(p.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function TreeItem({ node, depth, selectedId, onSelect, expandedIds, onToggle, onDragStart, onDragOver, onDrop, dragOverId, dropPosition }: {
  node: TreeNode; depth: number; selectedId: string | null;
  onSelect: (id: string) => void; expandedIds: Set<string>; onToggle: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  dragOverId: string | null;
  dropPosition: 'before' | 'inside' | 'after' | null;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.page.id);
  const isSelected = selectedId === node.page.id;
  const isDragTarget = dragOverId === node.page.id;

  let dropIndicatorClass = '';
  if (isDragTarget) {
    if (dropPosition === 'before') dropIndicatorClass = 'border-t-2 border-t-primary';
    else if (dropPosition === 'after') dropIndicatorClass = 'border-b-2 border-b-primary';
    else if (dropPosition === 'inside') dropIndicatorClass = 'ring-2 ring-primary/40 bg-primary/5';
  }

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs ${
          isSelected ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-secondary/50'
        } ${dropIndicatorClass}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node.page.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.page.id);
          onDragStart(node.page.id);
        }}
        onDragOver={(e) => onDragOver(e, node.page.id)}
        onDrop={(e) => onDrop(e, node.page.id)}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); onToggle(node.page.id); }} className="p-0.5 rounded hover:bg-secondary shrink-0">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.page.title || 'Sin título'}</span>
      </div>
      {isExpanded && node.children.map(child => (
        <TreeItem key={child.page.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} expandedIds={expandedIds} onToggle={onToggle} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} dragOverId={dragOverId} dropPosition={dropPosition} />
      ))}
    </div>
  );
}

export function WikiPageEditor({ pages, entityType, entityId, entityName, onAdd, onUpdate, onDelete }: WikiPageEditorProps) {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [previewMode, setPreviewMode] = useState(true);
  const [showDraftInput, setShowDraftInput] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'inside' | 'after' | null>(null);

  // Local title state to avoid cursor issues
  const [localTitle, setLocalTitle] = useState('');
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Local content state for responsive editing + debounce for saves
  const [localContent, setLocalContent] = useState('');
  const contentDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // AI edit state
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiEditing, setAiEditing] = useState(false);

  const entityPages = useMemo(
    () => pages.filter(p => p.entityType === entityType && p.entityId === entityId),
    [pages, entityType, entityId]
  );

  const tree = useMemo(() => buildTree(entityPages), [entityPages]);
  const selectedPage = selectedId ? entityPages.find(p => p.id === selectedId) : null;

  // Sync local content when selectedPage changes
  if (selectedPage && localContent !== selectedPage.content) {
    setLocalContent(selectedPage.content || '');
  }

  const handleToggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // --- Drag & Drop handlers ---
  const isDescendant = useCallback((parentId: string, childId: string): boolean => {
    const page = entityPages.find(p => p.id === childId);
    if (!page || !page.parentId) return false;
    if (page.parentId === parentId) return true;
    return isDescendant(parentId, page.parentId);
  }, [entityPages]);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.25) setDropPosition('before');
    else if (y > h * 0.75) setDropPosition('after');
    else setDropPosition('inside');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    setDragOverId(null);
    setDropPosition(null);
    if (!sourceId || sourceId === targetId) return;
    if (isDescendant(sourceId, targetId)) return;
    const target = entityPages.find(p => p.id === targetId);
    if (!target) return;

    if (dropPosition === 'inside') {
      const targetChildren = entityPages.filter(p => p.parentId === targetId);
      onUpdate(sourceId, { parentId: targetId, position: targetChildren.length });
      setExpandedIds(prev => new Set(prev).add(targetId));
    } else {
      const newParentId = target.parentId;
      const siblings = entityPages.filter(p => p.parentId === newParentId && p.id !== sourceId);
      const targetIdx = siblings.findIndex(p => p.id === targetId);
      const insertIdx = dropPosition === 'after' ? targetIdx + 1 : targetIdx;
      const source = entityPages.find(p => p.id === sourceId);
      if (!source) return;
      const reordered = [...siblings];
      reordered.splice(insertIdx, 0, source);
      reordered.forEach((p, i) => {
        if (p.id === sourceId) {
          onUpdate(p.id, { parentId: newParentId, position: i });
        } else if (p.position !== i) {
          onUpdate(p.id, { position: i });
        }
      });
    }
  }, [entityPages, dropPosition, isDescendant, onUpdate]);

  const openDraftInput = (parentId: string | null = null) => {
    setDraftParentId(parentId);
    setDraftText('');
    setShowDraftInput(true);
  };

  const handleGenerateFromDraft = async () => {
    if (!draftText.trim() || !user) {
      toast.error('Escribe algo en el borrador');
      return;
    }
    setGenerating(true);
    try {
      const data = await cloudFunctions.wikiGenerate({
        draft: draftText.trim(),
        entityName,
        entityType,
      }, user);

      const siblings = entityPages.filter(p => p.parentId === draftParentId);
      onAdd({
        entityType,
        entityId,
        parentId: draftParentId,
        title: data.title || 'Sin título',
        content: data.content || '',
        position: siblings.length,
      });

      setShowDraftInput(false);
      setDraftText('');
      toast.success('Página generada con IA');
    } catch (err: any) {
      console.error('Wiki generate error:', err);
      toast.error(err.message || 'Error al generar la página');
    } finally {
      setGenerating(false);
    }
  };

  const handleAiEdit = async () => {
    if (!aiInstruction.trim() || !selectedPage || !user) return;
    setAiEditing(true);
    try {
      const data = await cloudFunctions.wikiEdit({
        pageId: selectedPage.id,
        instruction: aiInstruction.trim(),
        entityName,
        entityType,
      }, user);

      if (data?.content) onUpdate(selectedPage.id, { content: data.content });
      if (data?.title && data.title !== selectedPage.title) onUpdate(selectedPage.id, { title: data.title });
      setAiInstruction('');
      toast.success('Página actualizada con IA');
    } catch (err: any) {
      console.error('Wiki AI edit error:', err);
      toast.error(err.message || 'Error al editar con IA');
    } finally {
      setAiEditing(false);
    }
  };

  const handleAddBlankPage = (parentId: string | null = null) => {
    const siblings = entityPages.filter(p => p.parentId === parentId);
    onAdd({
      entityType, entityId, parentId,
      title: 'Nueva página',
      content: '',
      position: siblings.length,
    });
  };

  const handleDelete = (id: string) => {
    if (selectedId === id) setSelectedId(null);
    onDelete(id);
  };

  // Draft input rendered inline (not as a nested component to avoid remounting)
  const draftInputJSX = (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Crear página con IA</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Escribe tu idea, borrador o notas sueltas. La IA lo transformará en una página wiki bien estructurada.
      </p>
      <textarea
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        className="w-full min-h-[120px] bg-secondary/30 rounded-lg p-3 text-sm text-foreground resize-y outline-none border border-border focus:border-primary/50 transition-colors"
        placeholder="Ej: Quiero documentar mi rutina de ejercicio semanal. Lunes y miércoles hago pesas, martes y jueves cardio, viernes yoga. Los fines de semana descanso o hago senderismo..."
        autoFocus
        disabled={generating}
      />
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={() => { setShowDraftInput(false); setDraftText(''); }}
          className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          disabled={generating}
        >
          Cancelar
        </button>
        <button
          onClick={() => { handleAddBlankPage(draftParentId); setShowDraftInput(false); setDraftText(''); }}
          className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          disabled={generating}
        >
          Crear en blanco
        </button>
        <button
          onClick={handleGenerateFromDraft}
          disabled={generating || !draftText.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? 'Generando...' : 'Generar con IA'}
        </button>
      </div>
    </div>
  );

  if (entityPages.length === 0 && !showDraftInput) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BookOpen className="w-10 h-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground mb-3">No hay páginas wiki aún</p>
        <button
          onClick={() => openDraftInput(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Crear primera página
        </button>
      </div>
    );
  }

  if (entityPages.length === 0 && showDraftInput) {
    return <div className="py-4">{draftInputJSX}</div>;
  }

  return (
    <div className="flex gap-4 min-h-[400px]">
      {/* Tree sidebar */}
      <div className="w-52 shrink-0 border-r border-border pr-3 space-y-2" onDragEnd={() => { setDraggedId(null); setDragOverId(null); setDropPosition(null); }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Páginas</span>
          <div className="flex items-center gap-1">
            {entityPages.length >= 3 && (
              <button
                onClick={() => setShowSuggestions(!showSuggestions)}
                className={`p-1 rounded transition-colors ${showSuggestions ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary hover:bg-secondary'}`}
                title="Sugerir estructura con IA"
              >
                <Lightbulb className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => openDraftInput(null)}
              className="p-1 rounded hover:bg-secondary text-primary transition-colors"
              title="Nueva página"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {tree.map(node => (
          <TreeItem key={node.page.id} node={node} depth={0} selectedId={selectedId} onSelect={setSelectedId} expandedIds={expandedIds} onToggle={handleToggle} onDragStart={setDraggedId} onDragOver={handleDragOver} onDrop={handleDrop} dragOverId={dragOverId} dropPosition={dropPosition} />
        ))}
      </div>

      {/* Editor / Preview / Draft */}
      <div className="flex-1 min-w-0 space-y-3">
        {showSuggestions && (
          <WikiStructureSuggestions
            pages={entityPages}
            entityType={entityType}
            entityId={entityId}
            entityName={entityName}
            onUpdate={onUpdate}
            onAdd={onAdd}
            onClose={() => setShowSuggestions(false)}
          />
        )}
        {showDraftInput ? (
          draftInputJSX
        ) : selectedPage ? (
          <div className="space-y-3">
            {/* Title + actions */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editingTitleId === selectedPage.id ? localTitle : selectedPage.title}
                onFocus={() => { setEditingTitleId(selectedPage.id); setLocalTitle(selectedPage.title); }}
                onChange={(e) => {
                  const val = e.target.value;
                  setLocalTitle(val);
                  if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
                  titleDebounceRef.current = setTimeout(() => onUpdate(selectedPage.id, { title: val }), 400);
                }}
                onBlur={() => {
                  if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
                  onUpdate(selectedPage.id, { title: localTitle });
                  setEditingTitleId(null);
                }}
                className="flex-1 text-base font-semibold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                placeholder="Título de la página"
              />
              <button
                onClick={() => setPreviewMode(!previewMode)}
                className={`p-1.5 rounded-md transition-colors ${previewMode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
                title={previewMode ? 'Editar' : 'Vista previa'}
              >
                {previewMode ? <Edit3 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => openDraftInput(selectedPage.id)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Nueva subpágina"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(selectedPage.id)}
                className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                title="Eliminar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content */}
            {previewMode ? (
              <div style={{ fontFamily: '"Anthropic Sans", ui-sans-serif, system-ui, -apple-system, sans-serif', fontSize: '0.8125rem' }} className="wiki-content prose prose-xs dark:prose-invert max-w-none rounded-lg p-5 min-h-[300px]
                prose-headings:text-foreground prose-headings:font-semibold
                prose-h1:text-xl prose-h1:font-bold prose-h1:mb-3 prose-h1:mt-0 prose-h1:leading-tight
                prose-h2:text-base prose-h2:font-bold prose-h2:border-t prose-h2:border-border prose-h2:pt-4 prose-h2:mt-6 prose-h2:mb-2 first:prose-h2:mt-0 first:prose-h2:border-t-0 first:prose-h2:pt-0
                prose-h3:text-xs prose-h3:font-bold prose-h3:mt-4 prose-h3:mb-1.5
                prose-h4:text-xs prose-h4:font-semibold prose-h4:mt-3
                prose-p:text-xs prose-p:leading-relaxed prose-p:text-foreground/85 prose-p:my-1.5
                prose-strong:text-foreground prose-strong:font-semibold
                prose-ul:text-sm prose-ul:my-2 prose-ul:pl-5 prose-ol:text-sm prose-ol:my-2 prose-ol:pl-5
                prose-li:text-foreground/85 prose-li:leading-relaxed prose-li:my-0.5
                prose-blockquote:border-l-primary prose-blockquote:border-l-2 prose-blockquote:bg-transparent prose-blockquote:py-0 prose-blockquote:px-3 prose-blockquote:not-italic prose-blockquote:text-muted-foreground prose-blockquote:text-sm prose-blockquote:my-1
                prose-a:text-primary prose-a:underline
                prose-code:bg-secondary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-secondary/60 prose-pre:rounded-lg
                prose-hr:border-border prose-hr:my-6
                prose-img:rounded-lg">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {selectedPage.content || '*Página vacía*'}
                </ReactMarkdown>
              </div>
            ) : (
              <textarea
                value={localContent}
                onChange={(e) => {
                  const newContent = e.target.value;
                  setLocalContent(newContent);

                  // Debounce saves — 500ms after user stops typing
                  clearTimeout(contentDebounceRef.current);
                  contentDebounceRef.current = setTimeout(() => {
                    if (selectedPage) {
                      onUpdate(selectedPage.id, { content: newContent });
                    }
                  }, 500);
                }}
                className="w-full min-h-[300px] bg-secondary/20 rounded-lg p-4 text-sm text-foreground resize-y outline-none border border-border focus:border-primary/50 transition-colors font-mono"
                placeholder="Escribe en Markdown..."
              />
            )}

            {/* AI Edit bar */}
            <div className="flex items-center gap-2 border border-border rounded-lg bg-card px-3 py-2">
              <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
              <input
                type="text"
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiEdit(); } }}
                placeholder="Instrucción para IA: ej. 'añade una sección de precios', 'resume el segundo párrafo'..."
                className="flex-1 text-xs bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                disabled={aiEditing}
              />
              <button
                onClick={handleAiEdit}
                disabled={aiEditing || !aiInstruction.trim()}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
              >
                {aiEditing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {aiEditing ? 'Editando...' : 'Aplicar'}
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Última edición: {new Date(selectedPage.updatedAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Selecciona una página del árbol
          </div>
        )}
      </div>
    </div>
  );
}
