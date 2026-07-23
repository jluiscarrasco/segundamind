import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, FolderPlus, Pencil, Trash2, Link2, ExternalLink, Plus, StickyNote, Loader2, Sparkles, Image } from 'lucide-react';
import type { Importance, Status, Resource, Effort, Subtask } from '@/types';
import { IMPORTANCE_LABELS, STATUS_LABELS, EFFORT_OPTIONS } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/cloud-functions';
import { storage } from '@/integrations/firebase/config';
import { uploadBytes, ref, getDownloadURL, deleteObject } from 'firebase/storage';
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
  /** Close this task (as finished) and spawn a replica in "Listo" with a new date. */
  onCloseAndReplicate?: (data: EntityFormData, newReviewDate: string) => void;
  entityId?: string;
}

export function EntitySidebar({ type, mode, initialData, displayId, resources = [], onSubmit, onDelete, onClose, onAddResource, onRemoveResource, onCloseAndReplicate, entityId }: EntitySidebarProps) {
  const { user } = useAuth();
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
  const [showReplicate, setShowReplicate] = useState(false);
  const [replicateDate, setReplicateDate] = useState('');
  const [newImage, setNewImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [showImageInput, setShowImageInput] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const entityLinks = resources.filter(r => r.entityId === entityId && r.entityType === type && r.type === 'link');
  const entityNotes = resources.filter(r => r.entityId === entityId && r.entityType === type && r.type === 'note');
  const entityImages = resources.filter(r => r.entityId === entityId && r.entityType === type && r.type === 'image');

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

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen no puede superar 5MB');
      return;
    }
    setNewImage(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleAddImage = async () => {
    if (!newImage || !entityId || !onAddResource || !user) {
      toast.error('Error: datos faltantes');
      return;
    }
    setUploadingImage(true);
    try {
      const fileName = `${user.uid}/images/${Date.now()}-${newImage.name}`;
      const fileRef = ref(storage, fileName);
      await uploadBytes(fileRef, newImage);
      const imageUrl = await getDownloadURL(fileRef);

      await onAddResource({ entityType: type, entityId, type: 'image', content: imageUrl });
      setNewImage(null);
      setImagePreview('');
      setShowImageInput(false);
      toast.success('Imagen guardada');
    } catch (err: any) {
      console.error('Error adding image:', err);
      toast.error(err.message || 'Error al guardar la imagen');
    } finally {
      setUploadingImage(false);
    }
  };

  const generateSubtasksWithAI = async () => {
    if (!user || type !== 'task') return;
    if (!name.trim()) {
      toast.error('Escribe primero el nombre de la tarea');
      return;
    }

    setGeneratingAI(true);
    try {
      const prompt = `Soy un usuario con TDAH. Descompón esta tarea compleja en una SECUENCIA de pasos que, ejecutados en orden, la completan de principio a fin. Esta ayuda se pide para tareas que requieren esfuerzo mental, así que cada paso debe tener ENTIDAD propia: una acción que hace avanzar la tarea de verdad, no un micro-gesto.

Tarea: "${name}"
${description ? `Descripción: ${description}` : ''}

Reglas:
- Cada paso es una acción con sustancia que produce un avance real. PROHIBIDO trocear en gestos triviales que cualquiera hace sin pensar. Ridículo: "Abrir un navegador", "Coger el teléfono", "Ponerse las zapatillas". Bien (para "Sacarme el carnet de moto"): "Comparar precios en varias autoescuelas", "Verificar qué horarios encajan con mi trabajo", "Reservar la matrícula en la elegida"
- Acciones concretas, NO consejos ni objetivos vagos. Mal: "Informarse sobre requisitos". Bien: "Buscar en la web de la DGT los requisitos del A2"
- Cada paso empieza con un verbo en infinitivo y es autocontenido
- Orden estrictamente secuencial: completar uno desbloquea el siguiente
- Nombre corto y escaneable: máximo 8 palabras, en español. Sin numerar (el orden lo da la lista)
- Usa solo los pasos que la tarea necesite de verdad, sin relleno

Responde SOLO con un JSON array, sin texto adicional:
[{"name": "..."}, {"name": "..."}]`;

      let fullContent = '';
      for await (const chunk of cloudFunctions.aiAssistantStream({ messages: [{ role: 'user', content: prompt }] }, user)) {
        if (chunk?.error) {
          throw new Error(chunk.error);
        }
        fullContent += chunk?.content || '';
      }

      const jsonMatch = fullContent.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('AI response without JSON array:', fullContent);
        throw new Error('La IA no devolvió una lista válida');
      }

      const subtasksData = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(subtasksData) || subtasksData.length === 0) {
        throw new Error('La IA no devolvió pasos');
      }

      const generated: Subtask[] = subtasksData
        .filter((item: any) => item?.name)
        .map((item: any) => ({
          id: crypto.randomUUID(),
          name: String(item.name),
          completed: false,
        }));

      // Conservar las subtareas existentes y añadir las generadas
      setSubtasks(prev => [...prev, ...generated]);
      toast.success(`${generated.length} pasos generados`);
    } catch (error: any) {
      console.error('Error generating subtasks:', error);
      toast.error(error?.message || 'Error al generar subtareas');
    } finally {
      setGeneratingAI(false);
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
      ...(type === 'task' ? { effort, subtasks } : {})
    });
  };

  const handleCloseTask = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      importance,
      status: 'finished',
      reviewDate: reviewDate || null,
      effort,
      subtasks,
    });
  };

  const handleReplicateConfirm = () => {
    if (!name.trim() || !replicateDate || !onCloseAndReplicate) return;
    onCloseAndReplicate({
      name: name.trim(),
      description: description.trim(),
      importance,
      status: 'finished',
      reviewDate: reviewDate || null,
      effort,
      subtasks,
    }, replicateDate);
    setShowReplicate(false);
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
              onChange={e => {
                // "__close_new__" is an action, not a real status: it closes this
                // task and opens the replicate dialog instead of setting a status.
                if (e.target.value === '__close_new__') {
                  setReplicateDate(reviewDate || '');
                  setShowReplicate(true);
                  return;
                }
                setStatus(e.target.value as Status);
              }}
              className="w-full bg-secondary text-xs text-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all"
            >
              {(Object.entries(STATUS_LABELS) as [Status, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
              {isEdit && type === 'task' && onCloseAndReplicate && (
                <option value="__close_new__">↻ Cerrado y nueva…</option>
              )}
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubtasks([...subtasks, { id: crypto.randomUUID(), name: '', completed: false }])}
                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" /> Añadir
                  </button>
                  <button
                    type="button"
                    onClick={generateSubtasksWithAI}
                    disabled={generatingAI}
                    title="Dividir la tarea en pasos con IA (anti-procrastinación)"
                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5 disabled:opacity-50"
                  >
                    {generatingAI ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Generando...</>
                    ) : (
                      <><Sparkles className="w-3 h-3" /> Dividir con IA</>
                    )}
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
                        title={subtask.name}
                        className={`flex-1 bg-transparent border-0 text-xs outline-none truncate ${subtask.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}
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

          {/* Images section */}
          {mode === 'edit' && entityId && onAddResource && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Image className="w-3 h-3" /> Imágenes
                </label>
                <button
                  type="button"
                  onClick={() => setShowImageInput(!showImageInput)}
                  className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> Añadir
                </button>
              </div>

              {entityImages.length > 0 && (
                <div className="space-y-2 mb-2">
                  {entityImages.map(r => (
                    <div key={r.id} className="relative group border border-border rounded-lg overflow-hidden">
                      <img
                        src={r.content}
                        alt="Imagen adjunta"
                        className="w-full h-auto display-block"
                        style={{ maxHeight: '200px' }}
                      />
                      {onRemoveResource && (
                        <button
                          type="button"
                          onClick={() => onRemoveResource(r.id)}
                          className="absolute top-1 right-1 p-1 rounded bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {entityImages.length === 0 && !showImageInput && (
                <p className="text-[11px] text-muted-foreground mb-2">Sin imágenes adjuntas.</p>
              )}

              {showImageInput && (
                <div className="space-y-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileSelect}
                    className="w-full text-[10px]"
                  />
                  {imagePreview && (
                    <div className="relative border border-border rounded-lg overflow-hidden">
                      <img
                        src={imagePreview}
                        alt="Vista previa"
                        className="w-full h-auto display-block"
                        style={{ maxHeight: '200px' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setNewImage(null);
                          setImagePreview('');
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="absolute top-1 right-1 p-1 rounded bg-black/50 hover:bg-black/70 text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleAddImage}
                    disabled={!newImage || uploadingImage}
                    className="w-full text-[10px] py-1.5 rounded-md gradient-primary text-primary-foreground disabled:opacity-40 font-medium flex items-center justify-center gap-1"
                  >
                    {uploadingImage && <Loader2 className="w-3 h-3 animate-spin" />}
                    Guardar imagen
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
        </form>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
          <button
            onClick={handleSubmit as any}
            disabled={!name.trim()}
            className="w-full py-2.5 rounded-lg gradient-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 hover:shadow-glow transition-all"
          >
            {isEdit ? 'Guardar cambios' : `Crear ${labels[type]}`}
          </button>

          {/* Task-specific footer actions */}
          {isEdit && type === 'task' && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCloseTask}
                className="flex-1 py-2 rounded-lg bg-secondary text-xs font-medium text-foreground hover:bg-secondary/80 transition-all"
              >
                ✓ Cerrar
              </button>
              {onCloseAndReplicate && (
                <button
                  type="button"
                  onClick={() => {
                    setReplicateDate(reviewDate || '');
                    setShowReplicate(true);
                  }}
                  className="flex-1 py-2 rounded-lg bg-secondary text-xs font-medium text-foreground hover:bg-secondary/80 transition-all"
                >
                  ↻ Nueva
                </button>
              )}
            </div>
          )}
        </div>
      </motion.aside>

      {/* Close-and-replicate dialog (recurring tasks) */}
      {showReplicate && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-sm"
          onClick={() => setShowReplicate(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-card p-5 w-full max-w-xs mx-4"
            onClick={e => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold text-foreground mb-1">Cerrado y nueva</h4>
            <p className="text-[11px] text-muted-foreground mb-3">
              Esta tarea se cerrará y se creará una copia en estado{' '}
              <span className="font-medium text-foreground">Listo</span> con la fecha que elijas
              (mismo título, descripción, esfuerzo y subtareas sin marcar).
            </p>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Fecha de la nueva tarea</label>
            <input
              type="date"
              value={replicateDate}
              onChange={e => setReplicateDate(e.target.value)}
              className="w-full bg-secondary text-xs text-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all mb-4"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowReplicate(false)}
                className="flex-1 py-2 rounded-lg bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReplicateConfirm}
                disabled={!replicateDate || !name.trim()}
                className="flex-1 py-2 rounded-lg gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 transition-all"
              >
                Cerrar y crear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

