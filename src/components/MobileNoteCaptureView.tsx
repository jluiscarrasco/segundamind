import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Brain, Plus, Image as ImageIcon, X, Download, Share, ArrowUpFromLine, Bell, BellOff, Loader2, LogOut, Mic, StopCircle, RotateCcw, Paperclip } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { auth, storage } from '@/integrations/firebase/config';
import { signOut } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/contexts/AuthContext';
import type { InboxItem } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface Props {
  inbox: InboxItem[];
  onAdd: (item: Omit<InboxItem, 'id' | 'createdAt'>) => Promise<InboxItem | null> | void;
  onRemove: (id: string) => void;
  onEnrichUrl?: (inboxId: string, url: string) => void;
}

export function MobileNoteCaptureView({ inbox, onAdd, onRemove, onEnrichUrl }: Props) {
  const { user, signOut: authSignOut } = useAuth();
  const [text, setText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
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

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className="flex items-start gap-3 bg-card border border-border rounded-xl p-3.5 shadow-sm"
                >
                  <div className="flex-1 min-w-0">
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
                  </div>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
