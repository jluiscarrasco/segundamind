import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadBytes, ref, getDownloadURL, deleteObject } from 'firebase/storage';
import { Inbox, Send, Link2, FileText, Trash2, ArrowRightCircle, Sparkles, Loader2, StickyNote, ListChecks, Upload, Paperclip, Mic, StopCircle, RotateCcw } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useAuth } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/cloud-functions';
import { storage } from '@/integrations/firebase/config';
import { toast } from 'sonner';
import type { InboxItem, Project, Area, Task, Importance, EntityType } from '@/types';
import { IMPORTANCE_LABELS } from '@/types';

type ConvertMode = 'task' | 'note';

interface InboxPanelProps {
  items: InboxItem[];
  projects: Project[];
  areas: Area[];
  tasks: Task[];
  onAdd: (item: Omit<InboxItem, 'id' | 'createdAt'>) => Promise<InboxItem | null> | void;
  onRemove: (id: string) => void;
  onConvertToTask: (inboxId: string, projectId: string, importance: Importance, name?: string, description?: string) => void;
  onAttachAsNote: (inboxId: string, entityType: EntityType, entityId: string) => void;
  onEnrichUrl?: (inboxId: string, url: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function InboxPanel({ items, projects, areas, tasks, onAdd, onRemove, onConvertToTask, onAttachAsNote, onEnrichUrl, isOpen, onToggle }: InboxPanelProps) {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [convertMode, setConvertMode] = useState<ConvertMode>('task');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedImportance, setSelectedImportance] = useState<Importance>('normal');
  const [classifying, setClassifying] = useState(false);
  const [aiReasoning, setAiReasoning] = useState('');
  const [taskName, setTaskName] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [noteEntityType, setNoteEntityType] = useState<EntityType>('project');
  const [noteEntityId, setNoteEntityId] = useState('');
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRecorder = useAudioRecorder();

  const handleStopAndTranscribe = async () => {
    console.log('📱 handleStopAndTranscribe called');
    const transcript = await audioRecorder.stopRecording();
    console.log('📝 Received transcript from hook:', transcript);
    if (transcript) {
      console.log('✅ Setting input with transcript');
      setInput((prev) => prev + (prev ? ' ' : '') + transcript);
      toast.success('Audio transcrito');
    } else {
      console.log('❌ No transcript received');
    }
  };

  const handleSubmit = async () => {
    if (!input.trim()) return;
    try {
      const isLink = input.startsWith('http://') || input.startsWith('https://');
      const trimmed = input.trim();
      const result = await onAdd({ type: isLink ? 'link' : 'note', content: trimmed });
      if (isLink && result && 'id' in result && onEnrichUrl) {
        onEnrichUrl(result.id, trimmed);
      }
      setInput('');
      toast.success('Añadido al inbox');
    } catch (err: any) {
      console.error('Error adding to inbox:', err);
      toast.error(err.message || 'Error al añadir al inbox');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!input.trim()) {
      toast.error('Escribe un contexto en el campo de texto antes de subir un archivo');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El archivo no puede superar 5MB');
      return;
    }
    const userContext = input.trim();

    setIsUploadingFile(true);
    try {
      const fileName = `inbox-temp/${user.uid}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, fileName);
      await uploadBytes(fileRef, file);
      const fileUrl = await getDownloadURL(fileRef);

      // Analyze with AI, passing user context
      const analysis = await cloudFunctions.analyzeAttachment({
        fileUrl,
        mimeType: file.type,
        entityType: 'task',
        currentName: userContext,
        currentDescription: userContext,
      }, user);

      // Cleanup temp file
      await deleteObject(fileRef);

      // Build a rich inbox note from the analysis
      const parts: string[] = [];
      if (analysis.suggestedName) parts.push(`📌 ${analysis.suggestedName}`);
      if (analysis.suggestedDescription) parts.push(analysis.suggestedDescription);
      if (analysis.additionalNotes) parts.push(analysis.additionalNotes);
      if (analysis.urls?.length) parts.push(`🔗 ${analysis.urls.join('\n🔗 ')}`);
      if (analysis.suggestedReviewDate) parts.push(`📅 Fecha sugerida: ${analysis.suggestedReviewDate}`);

      const content = `💬 ${userContext}\n\n${parts.join('\n\n') || analysis.summary || `Análisis de: ${file.name}`}`;
      onAdd({ type: 'note', content });
      setInput('');
      toast.success(`"${file.name}" analizado y añadido al inbox`);
    } catch (err: any) {
      console.error('File upload error:', err);
      toast.error(err.message || 'Error al procesar el archivo');
    } finally {
      setIsUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const classifyWithAI = async (content: string) => {
    if (!user) return;
    setClassifying(true);
    setAiReasoning('');
    try {
      const isUrl = content.trim().startsWith('http://') || content.trim().startsWith('https://');

      let data;
      if (isUrl) {
        // For URLs: use intelligent enrichment
        data = await cloudFunctions.enrichUrl({ url: content.trim() }, user);
      } else {
        // For text: use standard classification
        data = await cloudFunctions.classifyInbox({
          content,
          projects,
          areas,
        }, user);

        if (data?.projectId && projects.some(p => p.id === data.projectId)) {
          setSelectedProject(data.projectId);
          setNoteEntityType('project');
          setNoteEntityId(data.projectId);
        }
      }

      if (data?.importance) {
        setSelectedImportance(data.importance);
      }
      if (data?.suggestedName) {
        setTaskName(data.suggestedName);
      }
      if (data?.suggestedDescription) {
        setTaskDescription(data.suggestedDescription);
      }
      if (data?.suggestedAction === 'note') {
        setConvertMode('note');
      }
      if (data?.reasoning) {
        setAiReasoning(data.reasoning);
      }
    } catch (err) {
      console.error('AI classification failed:', err);
    } finally {
      setClassifying(false);
    }
  };

  const handleProcess = (id: string) => {
    if (processingId === id) {
      setProcessingId(null);
      setAiReasoning('');
      return;
    }
    setProcessingId(id);
    setSelectedProject('');
    setSelectedImportance('normal');
    setAiReasoning('');
    setTaskName('');
    setTaskDescription('');
    setConvertMode('task');
    setNoteEntityType('project');
    setNoteEntityId('');

    const item = items.find(i => i.id === id);
    if (item && projects.length > 0) {
      classifyWithAI(item.content);
    }
  };

  const handleConvertToTask = (id: string) => {
    if (!selectedProject) return;
    onConvertToTask(id, selectedProject, selectedImportance, taskName || undefined, taskDescription || undefined);
    resetProcessing();
  };

  const handleAttachAsNote = (id: string) => {
    if (!noteEntityId) return;
    onAttachAsNote(id, noteEntityType, noteEntityId);
    resetProcessing();
  };

  const resetProcessing = () => {
    setProcessingId(null);
    setSelectedProject('');
    setSelectedImportance('normal');
    setAiReasoning('');
    setTaskName('');
    setTaskDescription('');
    setConvertMode('task');
    setNoteEntityType('project');
    setNoteEntityId('');
  };

  const getAreaForProject = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    return project ? areas.find(a => a.id === project.areaId) : null;
  };

  // Build entity options for note attachment
  const entityOptions = () => {
    if (noteEntityType === 'area') return areas.map(a => ({ id: a.id, label: a.name }));
    if (noteEntityType === 'project') return projects.map(p => {
      const area = getAreaForProject(p.id);
      return { id: p.id, label: `${area?.name ?? '?'} › ${p.name}` };
    });
    if (noteEntityType === 'task') return tasks.map(t => {
      const project = projects.find(p => p.id === t.projectId);
      return { id: t.id, label: `${project?.key ?? '?'}-${t.taskNumber} ${t.name}` };
    });
    return [];
  };

  return (
    <>
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full gradient-primary shadow-glow flex items-center justify-center hover:scale-105 transition-transform"
      >
        <Inbox className="w-5 h-5 text-primary-foreground" />
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
            {items.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-20 right-6 z-50 w-96 max-h-[560px] bg-card border border-border rounded-xl shadow-card overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Inbox className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Inbox Universal</h3>
              <span className="text-xs text-muted-foreground ml-auto">{items.length} pendientes</span>
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-b border-border">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.doc,.docx,audio/*,.mp3,.wav,.m4a,.ogg,.webm"
                onChange={handleFileUpload}
                className="hidden"
              />
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="Captura una idea, enlace o nota..."
                  className="flex-1 bg-secondary text-sm text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary transition-all"
                  disabled={isUploadingFile || audioRecorder.isRecording}
                />
                {audioRecorder.isRecording && (
                  <div className="flex items-center gap-2 px-2 py-1 bg-primary/10 rounded-lg">
                    <span className="animate-pulse w-2 h-2 rounded-full bg-destructive"></span>
                    <span className="text-xs font-medium text-primary">{audioRecorder.duration}s</span>
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingFile || audioRecorder.isRecording}
                  className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40 transition-all"
                  title="Subir archivo para análisis IA"
                >
                  {isUploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                </button>
                <button
                  onClick={audioRecorder.isRecording ? handleStopAndTranscribe : audioRecorder.startRecording}
                  disabled={isUploadingFile || audioRecorder.isTranscribing}
                  className={`p-2 rounded-lg transition-all ${
                    audioRecorder.isRecording
                      ? 'bg-destructive text-destructive-foreground hover:scale-105'
                      : 'bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40'
                  }`}
                  title={audioRecorder.isRecording ? 'Detener grabación' : 'Grabar audio'}
                >
                  {audioRecorder.isTranscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : audioRecorder.isRecording ? (
                    <StopCircle className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>
                {audioRecorder.isStopped && (
                  <button
                    onClick={audioRecorder.resetRecording}
                    className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                    title="Limpiar grabación"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isUploadingFile || audioRecorder.isTranscribing}
                  className="p-2 rounded-lg gradient-primary text-primary-foreground disabled:opacity-40 hover:scale-105 transition-transform"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              {isUploadingFile && (
                <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Subiendo y analizando con IA...
                </p>
              )}
              {audioRecorder.isTranscribing && (
                <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Transcribiendo audio...
                </p>
              )}
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  Tu inbox está vacío. Captura ideas aquí.
                </div>
              ) : (
                items.map(item => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-4 py-3"
                  >
                    <div className="flex items-start gap-2">
                      {item.type === 'link' ? (
                        <Link2 className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      )}
                      <p className="text-sm text-foreground flex-1 break-all">{item.content}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleProcess(item.id)}
                          className="p-1 rounded hover:bg-secondary transition-colors text-primary"
                          title="Procesar con IA"
                        >
                          <ArrowRightCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onRemove(item.id)}
                          className="p-1 rounded hover:bg-secondary transition-colors text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {processingId === item.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden mt-2 space-y-2"
                        >
                          {/* AI status */}
                          {classifying && (
                            <div className="flex items-center gap-2 text-xs text-primary py-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>IA clasificando...</span>
                            </div>
                          )}

                          {aiReasoning && !classifying && (
                            <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-secondary/50 rounded-md px-2 py-1.5">
                              <Sparkles className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                              <span>{aiReasoning}</span>
                            </div>
                          )}

                          {/* Mode toggle: Task vs Note */}
                          <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
                            <button
                              onClick={() => setConvertMode('task')}
                              className={`flex-1 flex items-center justify-center gap-1 text-[11px] font-medium py-1.5 rounded-md transition-all ${
                                convertMode === 'task'
                                  ? 'bg-card text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              <ListChecks className="w-3 h-3" /> Tarea
                            </button>
                            <button
                              onClick={() => setConvertMode('note')}
                              className={`flex-1 flex items-center justify-center gap-1 text-[11px] font-medium py-1.5 rounded-md transition-all ${
                                convertMode === 'note'
                                  ? 'bg-card text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              <StickyNote className="w-3 h-3" /> Nota
                            </button>
                          </div>

                          {convertMode === 'task' ? (
                            <>
                              <input
                                value={taskName}
                                onChange={e => setTaskName(e.target.value)}
                                placeholder="Nombre de la tarea..."
                                className="w-full bg-secondary text-xs text-foreground rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                              />
                              <textarea
                                value={taskDescription}
                                onChange={e => setTaskDescription(e.target.value)}
                                placeholder="Descripción..."
                                rows={2}
                                className="w-full bg-secondary text-xs text-foreground rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary resize-none"
                              />
                              <select
                                value={selectedProject}
                                onChange={e => setSelectedProject(e.target.value)}
                                className="w-full bg-secondary text-xs text-foreground rounded-md px-2 py-1.5 outline-none"
                              >
                                <option value="">Seleccionar proyecto...</option>
                                {projects.map(p => {
                                  const area = getAreaForProject(p.id);
                                  return (
                                    <option key={p.id} value={p.id}>
                                      {area?.name} › {p.name}
                                    </option>
                                  );
                                })}
                              </select>
                              <select
                                value={selectedImportance}
                                onChange={e => setSelectedImportance(e.target.value as Importance)}
                                className="w-full bg-secondary text-xs text-foreground rounded-md px-2 py-1.5 outline-none"
                              >
                                {(Object.entries(IMPORTANCE_LABELS) as [Importance, string][]).map(([key, label]) => (
                                  <option key={key} value={key}>{label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleConvertToTask(item.id)}
                                disabled={!selectedProject || classifying}
                                className="w-full text-xs py-1.5 rounded-md gradient-primary text-primary-foreground disabled:opacity-40 font-medium"
                              >
                                Convertir en Tarea
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Note attachment: select entity type and entity */}
                              <div className="flex gap-1">
                                {(['area', 'project', 'task'] as EntityType[]).map(et => (
                                  <button
                                    key={et}
                                    onClick={() => { setNoteEntityType(et); setNoteEntityId(''); }}
                                    className={`flex-1 text-[10px] py-1 rounded-md font-medium transition-all ${
                                      noteEntityType === et
                                        ? 'bg-primary/10 text-primary border border-primary/20'
                                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    {et === 'area' ? 'Área' : et === 'project' ? 'Proyecto' : 'Tarea'}
                                  </button>
                                ))}
                              </div>
                              <select
                                value={noteEntityId}
                                onChange={e => setNoteEntityId(e.target.value)}
                                className="w-full bg-secondary text-xs text-foreground rounded-md px-2 py-1.5 outline-none"
                              >
                                <option value="">Seleccionar {noteEntityType === 'area' ? 'área' : noteEntityType === 'project' ? 'proyecto' : 'tarea'}...</option>
                                {entityOptions().map(opt => (
                                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleAttachAsNote(item.id)}
                                disabled={!noteEntityId || classifying}
                                className="w-full text-xs py-1.5 rounded-md bg-secondary text-foreground border border-border hover:bg-secondary/80 disabled:opacity-40 font-medium transition-all"
                              >
                                Adjuntar como Nota
                              </button>
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
