import { useEffect, useState } from "react";
import { Plug, Plus, Copy, Trash2, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { db } from "@/integrations/firebase/config";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { toast } from "sonner";

interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const MCP_URL = `${import.meta.env.VITE_APP_BASE_URL || 'http://localhost:8082'}/api/mcp`;

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "mcp_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function McpAccessDialog({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Sort in JS — where + orderBy would require a composite index
      const querySnapshot = await getDocs(
        query(
          collection(db, "api_tokens"),
          where("userId", "==", user.uid)
        )
      );
      const loadedTokens = querySnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        tokenPrefix: doc.data().tokenPrefix,
        createdAt: doc.data().createdAt?.toDate?.().toISOString() || new Date().toISOString(),
        lastUsedAt: doc.data().lastUsedAt?.toDate?.().toISOString() || null,
      })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setTokens(loadedTokens);
    } catch (error: any) {
      toast.error(error.message || "Error loading tokens");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open && user) { loadTokens(); setNewToken(null); setName(""); } }, [open, user]);

  const createToken = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Ponle un nombre"); return; }
    if (!user) { toast.error("No autenticado"); return; }

    try {
      const token = generateToken();
      const hash = await sha256Hex(token);
      const prefix = token.slice(0, 12);

      await addDoc(collection(db, "api_tokens"), {
        userId: user.uid,
        name: trimmed,
        tokenHash: hash,
        tokenPrefix: prefix,
        createdAt: serverTimestamp(),
        lastUsedAt: null,
      });

      setNewToken(token);
      setName("");
      loadTokens();
    } catch (error: any) {
      toast.error(error.message || "Error creating token");
    }
  };

  const deleteToken = async (id: string) => {
    if (!confirm("¿Borrar este token? Las apps que lo usen perderán acceso.")) return;
    try {
      await deleteDoc(doc(db, "api_tokens", id));
      loadTokens();
    } catch (error: any) {
      toast.error(error.message || "Error deleting token");
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyConfig = async () => {
    if (!newToken) return;
    const cfg = {
      mcpServers: {
        "mi-segundo-cerebro": {
          url: MCP_URL,
          headers: { Authorization: `Bearer ${newToken}` },
        },
      },
    };
    await navigator.clipboard.writeText(JSON.stringify(cfg, null, 2));
    toast.success("Configuración copiada");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plug className="w-4 h-4" /> Acceso para Claude (MCP)</DialogTitle>
          <DialogDescription className="text-xs">
            Genera un token personal para conectar Claude Desktop u otros clientes MCP a tu Segundo Cerebro.
            Tendrán lectura y escritura sobre áreas, proyectos, tareas, inbox y wiki.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md bg-muted p-2 text-[11px] font-mono break-all">
            <div className="text-muted-foreground text-[10px] mb-1">Endpoint MCP:</div>
            {MCP_URL}
          </div>

          {newToken ? (
            <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs font-medium text-foreground">⚠️ Copia este token ahora. No volverás a verlo.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono break-all bg-background rounded px-2 py-1.5 border">{newToken}</code>
                <Button size="sm" variant="outline" onClick={copyToken} className="h-8">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
              <Button size="sm" variant="secondary" onClick={copyConfig} className="w-full h-8 text-xs">
                Copiar config JSON para Claude Desktop
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                placeholder="Nombre (ej: Claude Desktop)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="h-8 text-xs"
              />
              <Button size="sm" onClick={createToken} className="h-8"><Plus className="w-3.5 h-3.5 mr-1" />Generar</Button>
            </div>
          )}

          <div className="space-y-1.5 max-h-64 overflow-auto">
            {loading && <Loader2 className="w-4 h-4 animate-spin mx-auto" />}
            {!loading && tokens.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Sin tokens creados</p>
            )}
            {tokens.map(t => (
              <div key={t.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {t.tokenPrefix}…  ·  {t.lastUsedAt ? `usado ${new Date(t.lastUsedAt).toLocaleDateString()}` : "sin uso"}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => deleteToken(t.id)} className="h-7 w-7 p-0">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
