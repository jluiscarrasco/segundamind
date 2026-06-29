import { useState, useEffect } from 'react';
import { Brain, Download, Share, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-sm w-full space-y-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">JL's Brain</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Captura ideas y notas al instante desde tu móvil.
          </p>
        </div>

        {isInstalled ? (
          <div className="bg-card border border-border rounded-xl p-6 space-y-3">
            <p className="text-foreground font-medium">✅ App instalada</p>
            <p className="text-muted-foreground text-sm">
              Abre JL's Brain desde tu pantalla de inicio.
            </p>
          </div>
        ) : deferredPrompt ? (
          <Button onClick={handleInstall} size="lg" className="w-full gap-2 rounded-xl">
            <Download className="w-5 h-5" />
            Instalar app
          </Button>
        ) : isIOS ? (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4 text-left">
            <p className="text-foreground font-medium text-center">Instalar en iPhone / iPad</p>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">1</span>
                <span>Pulsa el botón <Share className="w-4 h-4 inline text-primary" /> <strong className="text-foreground">Compartir</strong> en Safari</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">2</span>
                <span>Selecciona <Plus className="w-4 h-4 inline text-primary" /> <strong className="text-foreground">Añadir a pantalla de inicio</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">3</span>
                <span>Pulsa <strong className="text-foreground">Añadir</strong></span>
              </li>
            </ol>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-6 space-y-3">
            <p className="text-muted-foreground text-sm">
              Abre esta página en el navegador de tu móvil para instalar la app.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
