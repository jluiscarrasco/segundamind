import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Brain, Plus, Image as ImageIcon, X, Download, Share, ArrowUpFromLine, Bell, BellOff, Loader2, LogOut, Mic, StopCircle, RotateCcw, Paperclip, Link2, ArrowRightCircle, Sparkles } from 'lucide-react';
import { cloudFunctions } from '@/lib/cloud-functions';
import type { Importance } from '@/types';
import { IMPORTANCE_LABELS } from '@/types';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { auth, storage } from '@/integrations/firebase/config';
import { signOut } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/contexts/AuthContext';
import type { InboxItem, Task, Project, Area } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { MobileTasksDrawer } from './MobileTasksDrawer';

interface Props {
  inbox: InboxItem[];
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onAdd: (item: Omit<InboxItem, 'id' | 'createdAt'>) => Promise<InboxItem | null> | void;
  onRemove: (id: string) => void;
  onEnrichUrl?: (inboxId: string, url: string) => void;
  onUpdateTask: (id: string, data: Partial<Task>) => void;
  onOpenDetail?: (id: string) => void;
  onConvertToTask?: (
    inboxId: string,
    projectId: string,
    importance: Importance,
    name?: string,
    description?: string,
    opts?: { discardImage?: boolean; reviewDate?: string | null; startTime?: string | null }
  ) => void;
}

export function MobileNoteCaptureView({ inbox, tasks, projects, areas, onAdd, onRemove, onEnrichUrl, onUpdateTask, onOpenDetail, onConvertToTask }: Props) {
  const { user, signOut: authSignOut } = useAuth();
  const [text, setText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // AI-processing panel state (mobile-only version of InboxPanel's flow)
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [aiReasoning, setAiReasoning] = useState('');
  const [procName, setProcName] = useState('');
  const [procDescription, setProcDescription] = useState('');
  const [procArea, setProcArea] = useState('');
  const [procProject, setProcProject] = useState('');
  const [procImportance, setProcImportance] = useState<Importance>('normal');
  const [procReviewDate, setProcReviewDate] = useState('');
  const [procStartTime, setProcStartTime] = useState('');
  const [procKeepImage, setProcKeepImage] = useState(true);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(() => {
    const d = localStorage.getItem('push-banner-dismissed');
    return d ? Date.now() - parseInt(d) < 30 * 24 * 60 * 60 * 1000 : false;
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const push = usePushNotifications();
  const audioRecorder = useAudioRecorder();

  // Detect if app is installed (standalone) and platform
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;

    if (isStandalone) {
      setShowInstallBanner(false);
      return;
    }

    // Check if dismissed recently
    const dismissed = localStorage.getItem('install-banner-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) {
      return;
    }

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    if (ios) {
      setShowInstallBanner(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowInstallBanner(false);
      }
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const dismissBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem('install-banner-dismissed', String(Date.now()));
  };

  // Open the process panel for an inbox item and kick off the AI
  // classifier. Behaves like InboxPanel.startProcess on desktop.
  const startProcess = async (id: string) => {
    const item = inbox.find(i => i.id === id);
    if (!item || !user) return;
    setProcessingId(id);
    setProcName('');
    setProcDescription('');
    setProcArea('');
    setProcProject('');
    setProcImportance('normal');
    setProcReviewDate('');
    setProcStartTime('');
    setProcKeepImage(true);
    setAiReasoning('');
    if (projects.length === 0) return;
    setClassifying(true);
    try {
      const urlMatch = item.content.match(/https?:\/\/\S+/);
      const data = urlMatch
        ? await cloudFunctions.enrichUrl({ url: urlMatch[0] }, user)
        : await cloudFunctions.classifyInbox({ content: item.content, projects, areas }, user);
      if (data?.projectId && projects.some(p => p.id === data.projectId)) {
        setProcProject(data.projectId);
        const proj = projects.find(p => p.id === data.projectId);
        if (proj?.areaId) setProcArea(proj.areaId);
      }
      if (data?.importance) setProcImportance(data.importance);
      if (data?.suggestedName) setProcName(data.suggestedName);
      if (data?.suggestedDescription) setProcDescription(data.suggestedDescription);
      if (data?.reasoning) setAiReasoning(data.reasoning);
    } catch (err) {
      console.error('AI classification failed:', err);
    } finally {
      setClassifying(false);
    }
  };

  const cancelProcess = () => {
    setProcessingId(null);
    setClassifying(false);
    setAiReasoning('');
  };

  const confirmProcess = () => {
    if (!processingId || !procProject || !onConvertToTask) return;
    const item = inbox.find(i => i.id === processingId);
    const opts: {
      discardImage?: boolean;
      reviewDate?: string | null;
      startTime?: string | null;
    } = {
      reviewDate: procReviewDate || null,
      startTime: procReviewDate && procStartTime ? procStartTime : null,
    };
    if (item?.type === 'image') opts.discardImage = !procKeepImage;
    onConvertToTask(processingId, procProject, procImportance, procName || undefined, procDescription || undefined, opts);
    cancelProcess();
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && !imageFile) return;

    if (imageFile) {
      setUploading(true);
      try {
        if (!user) throw new Error('Not authenticated');
        const ext = imageFile.name.split('.').pop() || 'jpg';
        const path = `${user.uid}/inbox/${crypto.randomUUID()}.${ext}`;

        // Upload to Cloud Storage
        const fileRef = ref(storage, path);
        await uploadBytes(fileRef, imageFile);

        // Get download URL
        const imageUrl = await getDownloadURL(fileRef);
        const content = trimmed ? `${trimmed}\n\n![image](${imageUrl})` : imageUrl;
        onAdd({ type: 'image', content });
      } catch (err) {
        console.error('Upload error:', err);
        toast.error('Error al subir la imagen');
        setUploading(false);
        return;
      }
      setUploading(false);
    } else {
      const isLink = trimmed.startsWith('http://') || trimmed.startsWith('https://');
      const result = await onAdd({ type: isLink ? 'link' : 'note', content: trimmed });
      // Enrich URL in background
      if (isLink && result && 'id' in result && onEnrichUrl) {
        const itemId = result.id;
        setEnrichingIds(prev => new Set(prev).add(itemId));
        onEnrichUrl(itemId, trimmed);
        setTimeout(() => setEnrichingIds(prev => { const s = new Set(prev); s.delete(itemId); return s; }), 30000);
      }
    }

    setText('');
    setImagePreview(null);
    setImageFile(null);
    setIsExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('La imagen no puede superar 10 MB');
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setIsExpanded(true);
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStopAndTranscribe = async () => {
    const transcript = await audioRecorder.stopRecording();
    if (transcript) {
      setText((prev) => prev + (prev ? ' ' : '') + transcript);
      toast.success('Audio transcrito');
    }
  };

  useEffect(() => {
    if (isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded]);

  const isImageUrl = (content: string) => {
    return content.includes('![image]') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(content);
  };

  const extractImageUrl = (content: string) => {
    const match = content.match(/!\[image\]\((.+?)\)/);
    if (match) return match[1];
    const urlMatch = content.match(/(https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)\S*)/i);
    return urlMatch ? urlMatch[1] : null;
  };

  const extractText = (content: string) => {
    return content.replace(/!\[image\]\(.+?\)/, '').replace(/(https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)\S*)/i, '').trim();
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pt-safe-top py-3 bg-card border-b border-border">
        <button
          onClick={() => push.toggle()}
          disabled={push.isLoading}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label={push.isEnabled ? 'Desactivar notificaciones' : 'Activar notificaciones'}
        >
          {push.isLoading ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : push.isEnabled ? <BellOff className="w-4.5 h-4.5" /> : <Bell className="w-4.5 h-4.5" />}
        </button>
        <div className="flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary" />
          <h1 className="text-lg font-bold text-foreground tracking-tight">JL's Brain</h1>
        </div>
        <button
          onClick={async () => {
            await authSignOut();
            toast.success('Sesión cerrada');
          }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Cerrar sesión"
        >
          <LogOut className="w-4.5 h-4.5" />
        </button>
      </header>

      {/* Install banner */}
      <AnimatePresence>
        {showInstallBanner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-primary/10 border-b border-primary/20">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">
                  {isIOS ? (
                    <>Instala JL's Brain: pulsa <Share className="inline w-3.5 h-3.5 -mt-0.5 text-primary" /> y luego <span className="font-semibold">"Añadir a pantalla de inicio"</span></>
                  ) : (
                    <>Instala JL's Brain como app para acceso rápido</>
                  )}
                </p>
              </div>
              {!isIOS && deferredPrompt && (
                <Button size="sm" variant="default" className="shrink-0 h-7 text-xs rounded-lg gap-1" onClick={handleInstall}>
                  <Download className="w-3.5 h-3.5" />
                  Instalar
                </Button>
              )}
              <button onClick={dismissBanner} className="shrink-0 text-muted-foreground p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Push notification banner */}
      <AnimatePresence>
        {!push.isEnabled && !pushDismissed && push.permission !== 'denied' && 'Notification' in window && 'serviceWorker' in navigator && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-accent/50 border-b border-accent">
              <Bell className="w-4 h-4 text-primary shrink-0" />
              <p className="flex-1 text-xs font-medium text-foreground">
                Activa notificaciones para saber cuándo revisar tus tareas
              </p>
              <Button
                size="sm"
                variant="default"
                className="shrink-0 h-7 text-xs rounded-lg gap-1"
                disabled={push.isLoading}
                onClick={() => push.subscribe()}
              >
                {push.isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Activar'}
              </Button>
              <button
                onClick={() => {
                  setPushDismissed(true);
                  localStorage.setItem('push-banner-dismissed', String(Date.now()));
                }}
                className="shrink-0 text-muted-foreground p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.doc,.docx,audio/*,.mp3,.wav,.m4a,.ogg,.webm"
        capture="environment"
        className="hidden"
        onChange={handleImageSelect}
      />

      {/* Input area — top position */}
      <div className="border-b border-border bg-card px-4 py-3">
        {isExpanded ? (
          <div className="space-y-2">
            {imagePreview && (
              <div className="relative inline-block">
                <img src={imagePreview} alt="Preview" className="h-20 rounded-lg object-cover" />
                <button
                  onClick={removeImage}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={imageFile ? 'Añade una descripción (opcional)...' : 'Escribe tu nota...'}
              className="min-h-[80px] resize-none text-base rounded-xl border-border bg-background"
              disabled={audioRecorder.isRecording}
            />
            {audioRecorder.isRecording && (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg">
                <span className="animate-pulse w-2 h-2 rounded-full bg-destructive"></span>
                <span className="text-xs font-medium text-primary">{audioRecorder.duration}s grabando</span>
              </div>
            )}
            {audioRecorder.isTranscribing && (
              <p className="text-[10px] text-primary flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Transcribiendo audio...
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setIsExpanded(false); setText(''); removeImage(); }}
                className="text-muted-foreground"
              >
                Cancelar
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={audioRecorder.isRecording}
              >
                <Paperclip className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 transition-all ${
                  audioRecorder.isRecording
                    ? 'bg-destructive text-destructive-foreground'
                    : 'text-muted-foreground'
                }`}
                onClick={audioRecorder.isRecording ? handleStopAndTranscribe : audioRecorder.startRecording}
                disabled={audioRecorder.isTranscribing}
              >
                {audioRecorder.isTranscribing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : audioRecorder.isRecording ? (
                  <StopCircle className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </Button>
              {audioRecorder.isStopped && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={audioRecorder.resetRecording}
                >
                  <RotateCcw className="w-5 h-5" />
                </Button>
              )}
              <Button
                onClick={handleSend}
                disabled={(!text.trim() && !imageFile) || uploading || audioRecorder.isTranscribing}
                size="sm"
                className="ml-auto gap-2 rounded-xl"
              >
                <Send className="w-4 h-4" />
                {uploading ? 'Subiendo...' : 'Enviar'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setIsExpanded(true)}
              className="flex-1 flex items-center gap-3 px-4 py-3 bg-secondary rounded-xl text-muted-foreground text-sm hover:bg-secondary/80 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Capturar nota...
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-12 bg-secondary rounded-xl text-muted-foreground hover:bg-secondary/80 transition-colors"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-20 space-y-2">
        {inbox.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 opacity-60">
            <Brain className="w-16 h-16" />
            <p className="text-sm text-center">Tu inbox está vacío.<br />Captura tu primera nota.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {[...inbox].reverse().map((item) => {
              const imgUrl = isImageUrl(item.content) ? extractImageUrl(item.content) : null;
              const textContent = imgUrl ? extractText(item.content) : item.content;

              // Match the desktop InboxPanel link card: favicon + domain + path,
              // whole row clickable to open the URL in a new tab.
              const isLink = item.type === 'link';
              let linkUrl = '';
              let linkHostname = '';
              let linkPath = '';
              if (isLink) {
                linkUrl = item.content.trim();
                try {
                  const u = new URL(linkUrl);
                  linkHostname = u.hostname.replace(/^www\./, '');
                  linkPath = (u.pathname + u.search + u.hash).replace(/\/$/, '');
                } catch {
                  linkHostname = linkUrl;
                }
              }

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className="flex items-start gap-3 bg-card border border-border rounded-xl p-3.5 shadow-sm"
                >
                  <div className="flex-1 min-w-0">
                    {isLink ? (
                      <a
                        href={linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={linkUrl}
                        className="flex items-start gap-2 group"
                      >
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(linkHostname)}&sz=32`}
                          alt=""
                          width={16}
                          height={16}
                          className="mt-0.5 rounded-sm shrink-0"
                          loading="lazy"
                          onError={e => (e.currentTarget.style.display = 'none')}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                            {linkHostname}
                          </div>
                          {linkPath && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {linkPath}
                            </div>
                          )}
                        </div>
                        <Link2 className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
                      </a>
                    ) : (
                      <>
                        {imgUrl && (
                          <img
                            src={imgUrl}
                            alt="Nota con imagen"
                            className="w-full max-h-48 object-cover rounded-lg mb-2"
                          />
                        )}
                        {textContent && (
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                            {textContent}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col gap-1">
                    {onConvertToTask && (
                      <button
                        onClick={() => startProcess(item.id)}
                        title="Procesar con IA"
                        className="text-primary hover:text-primary/80 transition-colors p-1"
                      >
                        <ArrowRightCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(item.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      <MobileTasksDrawer tasks={tasks} projects={projects} areas={areas} onUpdateTask={onUpdateTask} onOpenDetail={onOpenDetail} />

      {/* AI processing panel — bottom sheet dialog for the mobile view */}
      {processingId && (() => {
        const item = inbox.find(i => i.id === processingId);
        if (!item) return null;
        return (
          <div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-background/60 backdrop-blur-sm"
            onClick={cancelProcess}
          >
            <div
              className="bg-card border-t border-border rounded-t-2xl shadow-card p-4 w-full max-h-[90vh] overflow-y-auto space-y-3"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">Procesar nota</h4>
                <button onClick={cancelProcess} className="p-1 text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {classifying && (
                <div className="flex items-center gap-2 text-xs text-primary">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>IA analizando…</span>
                </div>
              )}
              {!classifying && aiReasoning && (
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-primary/5 border border-primary/20 rounded-lg p-2">
                  <Sparkles className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  <span>{aiReasoning}</span>
                </div>
              )}

              {item.type === 'image' && (
                <label className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg bg-secondary/60">
                  <input
                    type="checkbox"
                    checked={procKeepImage}
                    onChange={e => setProcKeepImage(e.target.checked)}
                    className="w-3.5 h-3.5 accent-primary"
                  />
                  <span className="flex-1 text-foreground">Adjuntar imagen a la tarea</span>
                </label>
              )}

              <input
                type="text"
                value={procName}
                onChange={e => setProcName(e.target.value)}
                placeholder="Título de la tarea"
                className="w-full bg-secondary text-sm text-foreground rounded-md px-3 py-2 outline-none focus:ring-1 focus:ring-primary"
              />
              <textarea
                value={procDescription}
                onChange={e => setProcDescription(e.target.value)}
                placeholder="Descripción (opcional)"
                rows={3}
                className="w-full bg-secondary text-xs text-foreground rounded-md px-3 py-2 outline-none focus:ring-1 focus:ring-primary resize-none"
              />

              <select
                value={procArea}
                onChange={e => { setProcArea(e.target.value); setProcProject(''); }}
                className="w-full bg-secondary text-xs text-foreground rounded-md px-3 py-2 outline-none"
              >
                <option value="">Seleccionar área…</option>
                {areas.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
              </select>
              <select
                value={procProject}
                onChange={e => setProcProject(e.target.value)}
                disabled={!procArea}
                className="w-full bg-secondary text-xs text-foreground rounded-md px-3 py-2 outline-none disabled:opacity-40"
              >
                <option value="">Seleccionar proyecto…</option>
                {projects.filter(p => p.areaId === procArea).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={procImportance}
                onChange={e => setProcImportance(e.target.value as Importance)}
                className="w-full bg-secondary text-xs text-foreground rounded-md px-3 py-2 outline-none"
              >
                {(Object.entries(IMPORTANCE_LABELS) as [Importance, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>

              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={procReviewDate}
                  onChange={e => setProcReviewDate(e.target.value)}
                  className="flex-1 min-w-0 bg-secondary text-xs text-foreground rounded-md px-2 py-2 outline-none"
                />
                <input
                  type="time"
                  step={300}
                  value={procStartTime}
                  onChange={e => setProcStartTime(e.target.value)}
                  disabled={!procReviewDate}
                  className="w-28 shrink-0 bg-secondary text-xs text-foreground rounded-md px-2 py-2 outline-none disabled:opacity-40"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={cancelProcess}
                  className="flex-1 py-2 rounded-lg bg-secondary text-xs font-medium text-muted-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmProcess}
                  disabled={!procProject || classifying}
                  className="flex-1 py-2 rounded-lg gradient-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
                >
                  Crear tarea
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
