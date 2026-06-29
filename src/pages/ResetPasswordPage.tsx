import { useState } from 'react';
import { auth } from '@/integrations/firebase/config';
import { updatePassword } from 'firebase/auth';
import { toast } from 'sonner';
import { Brain, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function ResetPasswordPage() {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (!user) {
      toast.error('Debes estar autenticado para cambiar tu contraseña');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(user, password);
      toast.success('Contraseña actualizada');
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar contraseña');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mx-auto mb-3">
            <Brain className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-lg font-semibold text-foreground tracking-tight">Nueva contraseña</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border shadow-card p-5 space-y-4">
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
          <button
            type="submit"
            disabled={loading || password.length < 6}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg px-3 py-2.5 hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Actualizar contraseña
          </button>
        </form>
      </div>
    </div>
  );
}
