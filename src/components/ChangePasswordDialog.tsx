import { useState } from 'react';
import { auth } from '@/integrations/firebase/config';
import { updatePassword } from 'firebase/auth';
import { toast } from 'sonner';
import { Loader2, KeyRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function ChangePasswordDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirm) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    if (!auth.currentUser) {
      toast.error('Debes estar autenticado');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(auth.currentUser, password);
      toast.success('Contraseña actualizada correctamente');
      setPassword('');
      setConfirm('');
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar contraseña');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPassword(''); setConfirm(''); } }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="w-4 h-4" />
            Cambiar contraseña
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Nueva contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              className="w-full bg-secondary text-xs text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-primary transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Confirmar contraseña</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-secondary text-xs text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-primary transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading || password.length < 6 || password !== confirm}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg px-3 py-2.5 hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Actualizar contraseña
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
