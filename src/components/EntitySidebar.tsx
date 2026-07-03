import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, FolderPlus, Pencil, Trash2, Link2, ExternalLink, Plus, StickyNote, Loader2, Paperclip, FileIcon, Download, Sparkles } from 'lucide-react';
import type { Importance, Status, Resource, Effort, Subtask } from '@/types';
import { IMPORTANCE_LABELS, STATUS_LABELS, EFFORT_OPTIONS } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useDrive } from '@/hooks/useDrive';
import { cloudFunctions } from '@/lib/cloud-functions';
import { toast } from 'sonner';

export interface EntityFormData {
  name: string;
  description: string;
  importance: Importance;
  status: Status;
  reviewDate: string | null;
  effort?: Effort;
  subtasks?: Subtask[];
}


interface EntitySidebarProps {
  type: 'area' | 'project' | 'task';
  mode: 'create' | 'edit';
  initialData?: EntityFormData;
  displayId?: string;
  resources?: Resource[];
  onSubmit: (data: EntityFormData) => void;
  onDelete?: () => void;
  onClose: () => void;
  onAddResource?: (resource: Omit<Resource, 'id' | 'createdAt'>) => void;
  onRemoveResource?: (id: string) => void;
  entityId?: string;
}

export function EntitySidebar({ type, mode, initialData, displayId, resources = [], onSubmit, onDelete, onClose, onAddResource, onRemoveResource, entityId }: EntitySidebarProps) {
  const { user } = useAuth();
  const { uploadAttachment } = useDrive();
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [importance, setImportance] = useState<Importance>(initialData?.importance || 'normal');
  const [status, setStatus] = useState<Status>(initialData?.status || 'funnel');
  const [reviewDate, setReviewDate] = useState(initialData?.reviewDate || '');
  const [effort, setEffort] = useState<Effort>(initialData?.effort ?? null);
  const [subtasks, setSubtasks] = useState<Subtask[]>(initialData?.subtasks ?? []);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);

  const entityLinks = resources.filter(r => r.entityId === entityId && r.entityType === type && r.type === 'link');
  const entityNotes = resources.filter(r => r.entityId === entityId && r.entityType === type && r.type === 'note');
  const entityFiles = resources.filter(r => r.entityId === entityId && r.entityType === type && r.type === 'file');

  const handleAddUrl = () => {
    if (!newUrl.trim() || !entityId || !onAddResource) return;
    onAddResource({ entityType: type, entityId, type: 'link', content: newUrl.trim() });
    setNewUrl('');
    setShowUrlInput(false);
  };

  const handleAddNote = () => {
    if (!newNote.trim() || !entityId || !onAddResource) return;
    onAddResource({ entityType: type, entityId, type: 'note', content: newNote.trim() });
    setNewNote('');
    setShowNoteInput(false);
  };

  const generateSubtasksWithAI = async () => {
    if (!user || type !== 'task') return;

    setGeneratingAI(true);
    try {
      const prompt = `Soy un usuario con TDAH y necesito descomponer una tarea compleja en pasos ejecutables para evitar procrastinación.

Tarea: "${name}"
${description ? `Descripción: ${description}` : ''}

Analiza la tarea y descomponla en todos los pasos necesarios y realistas para completarla. No hay límite de pasos.
- Algunos pasos pueden ser cortos (15-30 minutos)
- Otros pueden ser largos (varias horas, incluso días)
- Incluye pasos de preparación, aprendizaje, práctica, evaluación si aplica
- Cada paso debe ser accionable y específico

Responde SOLO con un JSON array con nombre de cada paso:
[{"name": "Paso 1: descripción breve"}, {"name": "Paso 2: descripción breve"}, ...]`;

      // Use streaming API and collect all chunks
      let fullContent = '';
      for await (const chunk of cloudFunctions.aiAssistantStream({ messages: [{ role: 'user', content: prompt }] }, user)) {
        console.log('Chunk received:', chunk);
        fullContent += chunk.content || chunk || '';
      }
      console.log('Full content accumulated:', fullContent);

      let subtasksData;
      try {
        const content = fullContent.trim();

        if (!content) {
          throw new Error('Empty response');
        }

        // Try to extract JSON array from content
        let jsonStr = '';
        if (content.startsWith('[')) {
          jsonStr = content;
        } else {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          jsonStr = jsonMatch ? jsonMatch[0] : '';
        }

        if (!jsonStr) {
          console.error('No JSON found in response:', content);
          throw new Error('No JSON array found in response');
        }

        subtasksData = JSON.parse(jsonStr);
      } catch (e) {
        console.error('Error parsing subtasks:', e);
        toast.error('No se pudo procesar la respuesta de IA');
        return;
      }

      if (Array.isArray(subtasksData) && subtasksData.length > 0) {
        const newSubtasksList = subtasksData.map((item: any) => ({
          id: Math.random().toString(36),
          name: item.name || '',
          completed: false,
        }));
        setSubtasks(newSubtasksList);
        toast.success(`${newSubtasksList.length} subtareas generadas`);
      }
    } catch (error) {
      console.error('Error generating subtasks:', error);
      toast.error('Error al generar subtareas');
    } finally {
      setGeneratingAI(false);
    }
  };

  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const attachFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !entityId || !onAddResource || !user) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('El archivo no puede superar 10MB');
      return;
    }
    setIsUploadingAttachment(true);
    try {
      const downloadUrl = await uploadAttachment(file, entityId);
      onAddResource({
        entityType: type,
        entityId,
        type: 'file',
        content: downloadUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });
      toast.success(`"${file.name}" adjuntado`);
    } catch (err: any) {
      console.error('File attach error:', err);
      toast.error(err.message || 'Error al subir archivo');
    } finally {
      setIsUploadingAttachment(false);
      if (attachFileInputRef.current) attachFileInputRef.current.value = '';
    }
  };


  useEffect(() => {
    setName(initialData?.name || '');
    setDescription(initialData?.description || '');
    setImportance(initialData?.importance || 'normal');
    setStatus(initialData?.status || 'funnel');
    setReviewDate(initialData?.reviewDate || '');
    setEffort(initialData?.effort ?? null);
  }, [initialData?.name, initialData?.description, initialData?.importance, initialData?.status, initialData?.reviewDate, initialData?.effort]);

  const labels = { area: 'Área', project: 'Proyecto', task: 'Tarea' };
  const isEdit = mode === 'edit';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      importance,
      status,
      reviewDate: reviewDate || null,
      ...(type === 'task' ? { effort, subtasks: subtasks.length > 0 ? subtasks : undefined } : {})
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-background/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed top-0 right-0 z-50 h-screen w-full max-w-sm bg-card border-l border-border shadow-card flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-2 shrink-0">
          {isEdit ? <Pencil className="w-4 h-4 text-primary" /> : <FolderPlus className="w-4 h-4 text-primary" />}
          <h3 className="text-sm font-semibold text-foreground">
            {isEdit ? `Editar ${labels[type]}` : `Nueva ${labels[type]}`}
          </h3>
          {displayId && (
            <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">{displayId}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {isEdit && onDelete && (
              <button
                onClick={onDelete}
                className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-destructive"
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-secondary transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Nombre</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`Nombre de la ${labels[type].toLowerCase()}...`}
              autoFocus
              className="w-full bg-secondary text-xs text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Descripción</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Descripción opcional..."
              rows={3}
              className="w-full bg-secondary text-xs text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Importancia</label>
            <select
              value={importance}
              onChange={e => setImportance(e.target.value as Importance)}
              className="w-full bg-secondary text-xs text-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all"
            >
              {(Object.entries(IMPORTANCE_LABELS) as [Importance, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Estado</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as Status)}
              className="w-full bg-secondary text-xs text-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all"
            >
              {(Object.entries(STATUS_LABELS) as [Status, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Fecha de Revisión</label>
            <input
              type="date"
              value={reviewDate}
              onChange={e => setReviewDate(e.target.value)}
              className="w-full bg-secondary text-xs text-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all"
            />
          </div>

          {/* Effort slider - only for tasks */}
          {type === 'task' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-2">
                Esfuerzo estimado
                <span className="ml-2 text-primary font-semibold">
                  {effort ? EFFORT_OPTIONS.find(o => o.value === effort)?.label : 'Sin estimar'}
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {EFFORT_OPTIONS.map(opt => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setEffort(opt.value)}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                      effort === opt.value
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subtasks - only for tasks */}
          {type === 'task' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">Subtareas</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setSubtasks([...subtasks, { id: Math.random().toString(36), name: '', completed: false }])}
                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" /> Añadir
                  </button>
                  <button
                    type="button"
                    onClick={generateSubtasksWithAI}
                    disabled={generatingAI}
                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5 disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3" /> {generatingAI ? 'Generando...' : 'IA'}
                  </button>
                </div>
              </div>

              {subtasks.length > 0 ? (
                <div className="space-y-1.5 mb-2">
                  {subtasks.map((subtask, idx) => (
                    <div key={subtask.id} className="flex items-center gap-2 bg-secondary/30 rounded-md px-2.5 py-2">
                      <input
                        type="checkbox"
                        checked={subtask.completed}
                        onChange={(e) => {
                          const updated = [...subtasks];
                          updated[idx].completed = e.target.checked;
                          setSubtasks(updated);
                        }}
                        className="w-3.5 h-3.5 shrink-0"
                      />
                      <input
                        type="text"
                        value={subtask.name}
                        onChange={(e) => {
                          const updated = [...subtasks];
                          updated[idx].name = e.target.value;
                          setSubtasks(updated);
                        }}
                        placeholder="Nombre de subtarea"
                        className={`flex-1 bg-transparent border-0 text-xs outline-none ${subtask.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                      />
                      <button
                        type="button"
                        onClick={() => setSubtasks(subtasks.filter(s => s.id !== subtask.id))}
                        className="text-muted-foreground hover:text-destructive text-xs shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground mb-2 italic">Sin subtareas</p>
              )}
            </div>
          )}


          {mode === 'edit' && entityId && onAddResource && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <StickyNote className="w-3 h-3" /> Notas
                </label>
                <button
                  type="button"
                  onClick={() => setShowNoteInput(!showNoteInput)}
                  className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> Añadir
                </button>
              </div>

              {entityNotes.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  {entityNotes.map(r => (
                    <div key={r.id} className="bg-secondary/50 rounded-md px-2.5 py-2 group relative">
                      <p className="text-xs text-foreground whitespace-pre-wrap pr-5">{r.content}</p>
                      <span className="text-[9px] text-muted-foreground mt-1 block">
                        {new Date(r.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                      </span>
                      {onRemoveResource && (
                        <button
                          type="button"
                          onClick={() => onRemoveResource(r.id)}
                          className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {entityNotes.length === 0 && !showNoteInput && (
                <p className="text-[11px] text-muted-foreground mb-2">Sin notas adjuntas.</p>
              )}

              {showNoteInput && (
                <div className="space-y-1.5">
                  <textarea
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    placeholder="Escribe una nota..."
                    rows={3}
                    className="w-full bg-secondary text-xs text-foreground placeholder:text-muted-foreground rounded-md px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary resize-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                    className="w-full text-[10px] py-1.5 rounded-md gradient-primary text-primary-foreground disabled:opacity-40 font-medium"
                  >
                    Guardar nota
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Links section */}
          {mode === 'edit' && entityId && onAddResource && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> Enlaces
                </label>
                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> Añadir
                </button>
              </div>

              {entityLinks.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  {entityLinks.map(r => (
                    <div key={r.id} className="flex items-center gap-2 bg-secondary/50 rounded-md px-2.5 py-1.5 group">
                      <ExternalLink className="w-3 h-3 text-primary shrink-0" />
                      <a
                        href={r.content}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline truncate flex-1"
                      >
                        {r.content}
                      </a>
                      {onRemoveResource && (
                        <button
                          type="button"
                          onClick={() => onRemoveResource(r.id)}
                          className="p-0.5 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {entityLinks.length === 0 && !showUrlInput && (
                <p className="text-[11px] text-muted-foreground mb-2">Sin enlaces adjuntos.</p>
              )}

              {showUrlInput && (
                <div className="flex gap-1.5">
                  <input
                    value={newUrl}
                    onChange={e => setNewUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddUrl())}
                    placeholder="https://..."
                    className="flex-1 bg-secondary text-xs text-foreground placeholder:text-muted-foreground rounded-md px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleAddUrl}
                    disabled={!newUrl.trim()}
                    className="text-[10px] px-2.5 py-1.5 rounded-md gradient-primary text-primary-foreground disabled:opacity-40 font-medium"
                  >
                    Añadir
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Files section */}
          {mode === 'edit' && entityId && onAddResource && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Paperclip className="w-3 h-3" /> Ficheros adjuntos
                </label>
                <button
                  type="button"
                  onClick={() => attachFileInputRef.current?.click()}
                  disabled={isUploadingAttachment}
                  className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
                >
                  {isUploadingAttachment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Subir
                </button>
              </div>

              <input
                ref={attachFileInputRef}
                type="file"
                onChange={handleFileAttach}
                className="hidden"
              />

              {entityFiles.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  {entityFiles.map(r => (
                    <div key={r.id} className="flex items-center gap-2 bg-secondary/50 rounded-md px-2.5 py-1.5 group">
                      <FileIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">{r.fileName || 'Archivo'}</p>
                        {r.fileSize && (
                          <span className="text-[9px] text-muted-foreground">
                            {r.fileSize < 1024 * 1024
                              ? `${(r.fileSize / 1024).toFixed(0)} KB`
                              : `${(r.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                          </span>
                        )}
                      </div>
                      <a
                        href={r.content}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-0.5 rounded hover:bg-secondary text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        onClick={e => e.stopPropagation()}
                      >
                        <Download className="w-3 h-3" />
                      </a>
                      {onRemoveResource && (
                        <button
                          type="button"
                          onClick={() => onRemoveResource(r.id)}
                          className="p-0.5 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {entityFiles.length === 0 && (
                <p className="text-[11px] text-muted-foreground mb-2">Sin ficheros adjuntos.</p>
              )}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={handleSubmit as any}
            disabled={!name.trim()}
            className="w-full py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 hover:shadow-glow transition-all"
          >
            {isEdit ? 'Guardar cambios' : `Crear ${labels[type]}`}
          </button>
        </div>
      </motion.aside>
    </>
  );
}

