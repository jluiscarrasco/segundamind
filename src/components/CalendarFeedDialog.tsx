import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Calendar, Copy, CheckCircle2, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface CalendarFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
}

export function CalendarFeedDialog({ open, onOpenChange, authToken }: CalendarFeedDialogProps) {
  const [copied, setCopied] = useState(false);
  const { user } = useAuth();

  const feedUrl = authToken && user
    ? `${window.location.origin}/api/ical`
    : null;

  const handleCopyUrl = () => {
    if (feedUrl) {
      navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${window.location.origin}/api/ical`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch calendar');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'jl-brain-tasks.ics';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('Error downloading calendar:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Calendario Público
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info section */}
          <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">
              Sincroniza tus tareas pendientes con tu móvil
            </p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li className="flex gap-2">
                <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                Se sincronizan todas las tareas NO cerradas
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                Solo tareas con fecha de revisión
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                Hora inicio: la que configures (o 9:30 AM por defecto)
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                Hora fin: calculada automáticamente con el esfuerzo
              </li>
            </ul>
          </div>

          {/* Feed URL section */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">URL DEL CALENDARIO</label>
            {feedUrl ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={feedUrl}
                  readOnly
                  className="flex-1 text-xs bg-background text-foreground rounded px-2 py-1.5 border border-border"
                />
                <button
                  onClick={handleCopyUrl}
                  className={`px-3 py-1.5 rounded font-medium text-xs transition-all ${
                    copied
                      ? 'bg-primary/20 text-primary'
                      : 'bg-secondary text-foreground hover:bg-secondary/80'
                  }`}
                >
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            ) : (
              <div className="text-xs text-destructive flex gap-2 items-center">
                <AlertCircle className="w-4 h-4" />
                No estás autenticado
              </div>
            )}
          </div>

          {/* Instructions section */}
          <div className="space-y-3 border-t border-border pt-4">
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">Agregar en Google Calendar:</p>
              <ol className="text-xs text-muted-foreground space-y-1 pl-4 list-decimal">
                <li>Abre Google Calendar en tu móvil</li>
                <li>Toca el + para agregar calendario</li>
                <li>Selecciona "Suscribirse a calendario"</li>
                <li>Pega esta URL y confirma</li>
              </ol>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">O descargarlo ahora:</p>
              <button
                onClick={handleDownload}
                disabled={!authToken}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                📥 Descargar archivo .ics
              </button>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground">
            El calendario es privado y solo accesible con tu autenticación. Se actualiza en tiempo real cuando cambias tus tareas.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
