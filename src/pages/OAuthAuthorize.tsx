import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Brain, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const MCP_FUNCTION_URL = `${import.meta.env.VITE_APP_BASE_URL || 'http://localhost:8082'}/api/mcp`;

export default function OAuthAuthorizePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  // Required OAuth params
  const oauth = useMemo(() => ({
    response_type: params.get("response_type") ?? "",
    client_id: params.get("client_id") ?? "",
    redirect_uri: params.get("redirect_uri") ?? "",
    code_challenge: params.get("code_challenge") ?? "",
    code_challenge_method: params.get("code_challenge_method") ?? "",
    state: params.get("state") ?? "",
    scope: params.get("scope") ?? "mcp",
    resource: params.get("resource") ?? "",
  }), [params]);

  const missing =
    !oauth.response_type || !oauth.client_id || !oauth.redirect_uri ||
    !oauth.code_challenge || !oauth.code_challenge_method;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Stash the full URL to come back after login
      sessionStorage.setItem("postLoginRedirect", window.location.pathname + window.location.search);
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  const approve = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${MCP_FUNCTION_URL}/oauth/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(oauth),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error || "Error");
      window.location.href = data.redirect_to;
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo autorizar");
      setSubmitting(false);
    }
  };

  const deny = () => {
    if (!oauth.redirect_uri) { navigate("/"); return; }
    let back: URL;
    try {
      back = new URL(oauth.redirect_uri);
    } catch {
      navigate("/");
      return;
    }
    const ok =
      back.protocol === "https:" ||
      (back.protocol === "http:" && (back.hostname === "localhost" || back.hostname === "127.0.0.1"));
    if (!ok) { navigate("/"); return; }
    back.searchParams.set("error", "access_denied");
    if (oauth.state) back.searchParams.set("state", oauth.state);
    window.location.href = back.toString();
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  if (missing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold">Solicitud OAuth inválida</h1>
          <p className="text-sm text-muted-foreground">Faltan parámetros OAuth obligatorios.</p>
        </div>
      </div>
    );
  }

  let redirectHost = "";
  try { redirectHost = new URL(oauth.redirect_uri).hostname; } catch { /* noop */ }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 space-y-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Autorizar acceso</h1>
            <p className="text-xs text-muted-foreground">Mi Segundo Cerebro · MCP</p>
          </div>
        </div>

        <div className="rounded-md bg-muted/50 p-3 space-y-1.5 text-sm">
          <p>
            <span className="font-medium">{oauth.client_id}</span> quiere conectarse a tu Segundo Cerebro.
          </p>
          {redirectHost && (
            <p className="text-xs text-muted-foreground">
              Te devolverá a <code className="font-mono">{redirectHost}</code>
            </p>
          )}
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span>Lectura y escritura sobre tus áreas, proyectos, tareas, inbox, wiki y archivos.</span>
          </div>
          <p className="pl-6">Podrás revocar el acceso en cualquier momento desde 🔌 Acceso MCP.</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={deny} disabled={submitting}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={approve} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Autorizar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
