import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Folder,
  FolderPlus,
  Upload,
  Search,
  Download,
  Trash2,
  Pencil,
  Move,
  Tag as TagIcon,
  Link as LinkIcon,
  X,
  ChevronRight,
  Home,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  MoreHorizontal,
} from 'lucide-react';
import { useDriveContext } from '@/hooks/DriveContext';
import { useStoreContext } from '@/store/StoreContext';
import { FileLinksManager } from './FileLinksManager';
import type { UserFolder, UserFile, EntityType } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fileIcon(mime: string | null) {
  if (!mime) return FileIcon;
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.includes('pdf') || mime.startsWith('text/')) return FileText;
  return FileIcon;
}

GlobalWorkerOptions.workerSrc = pdfWorker;

export function FilesView() {
  const drive = useDriveContext();
  const { areas, projects, tasks } = useStoreContext();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [entityFilter, setEntityFilter] = useState<{ type: EntityType; id: string } | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<
    { kind: 'folder' | 'file'; id: string; name: string } | null
  >(null);
  const [moveTarget, setMoveTarget] = useState<
    { kind: 'folder' | 'file'; id: string } | null
  >(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  // Breadcrumb
  const breadcrumb = useMemo(() => {
    const path: UserFolder[] = [];
    let id: string | null = currentFolderId;
    while (id) {
      const f = drive.folders.find(x => x.id === id);
      if (!f) break;
      path.unshift(f);
      id = f.parentId;
    }
    return path;
  }, [currentFolderId, drive.folders]);

  // Visible folders & files in current folder
  const visibleFolders = useMemo(() => {
    if (entityFilter) return [];
    return drive.folders
      .filter(f => f.parentId === currentFolderId)
      .filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [drive.folders, currentFolderId, search, entityFilter]);

  const visibleFiles = useMemo(() => {
    let base = drive.files;
    if (entityFilter) {
      const ids = new Set(
        drive.links
          .filter(l => l.entityType === entityFilter.type && l.entityId === entityFilter.id)
          .map(l => l.fileId)
      );
      base = base.filter(f => ids.has(f.id));
    } else {
      base = base.filter(f => f.folderId === currentFolderId);
    }
    return base
      .filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()))
      .filter(f => activeTags.length === 0 || activeTags.every(t => f.tags.includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [drive.files, drive.links, entityFilter, currentFolderId, search, activeTags]);

  // All tags in current folder for chips
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    drive.files
      .filter(f => f.folderId === currentFolderId)
      .forEach(f => f.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [drive.files, currentFolderId]);

  const selectedFile = selectedFileId ? drive.files.find(f => f.id === selectedFileId) : null;

  // Load preview when selecting a previewable file (fetch as blob to avoid cross-origin/CSP issues)
  const previewableMime = selectedFile?.mimeType ?? '';
  const previewableStoragePath = selectedFile?.storagePath ?? '';
  const previewableFileId = selectedFile?.id ?? '';
  useEffect(() => {
    setPreviewUrl(null);
    setPdfPreviewError(false);
    setPdfPreviewLoading(false);
    if (!previewableFileId) return;
    const isPreviewable =
      previewableMime.startsWith('image/') || previewableMime.includes('pdf');
    if (!isPreviewable) return;

    let cancelled = false;
    let createdBlobUrl: string | null = null;
    (async () => {
      try {
        const url = await drive.getSignedUrl(previewableStoragePath);
        const res = await fetch(url);
        if (!res.ok) throw new Error('preview fetch failed');
        const blob = await res.blob();
        if (cancelled) return;
        createdBlobUrl = URL.createObjectURL(blob);
        setPreviewUrl(createdBlobUrl);
      } catch {
        if (!cancelled) setPdfPreviewError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewableFileId, previewableStoragePath, previewableMime]);

  useEffect(() => {
    if (!previewUrl || !selectedFile?.mimeType?.includes('pdf') || !pdfCanvasRef.current) return;

    let cancelled = false;
    const canvas = pdfCanvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    setPdfPreviewLoading(true);
    setPdfPreviewError(false);

    const loadingTask = getDocument(previewUrl);
    (async () => {
      try {
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.4, 260 / viewport.width);
        const scaledViewport = page.getViewport({ scale });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        await page.render({
          canvas,
          canvasContext: context,
          viewport: scaledViewport,
        }).promise;

        if (!cancelled) setPdfPreviewLoading(false);
      } catch {
        if (!cancelled) {
          setPdfPreviewError(true);
          setPdfPreviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      void loadingTask.destroy();
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [previewUrl, selectedFile?.id, selectedFile?.mimeType]);

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      for (const f of arr) {
        try {
          await drive.uploadFile(f, currentFolderId);
          toast.success(`${f.name} subido`);
        } catch (e: any) {
          toast.error(`Error subiendo ${f.name}: ${e.message}`);
        }
      }
    },
    [drive, currentFolderId]
  );

  const handleDownload = async (file: UserFile) => {
    try {
      const url = await drive.getSignedUrl(file.storagePath);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch {
        // Fallback: open in new tab
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e: any) {
      toast.error(`Error descargando: ${e.message}`);
    }
  };

  const handleCopyLink = async (file: UserFile) => {
    try {
      const url = await drive.getSignedUrl(file.storagePath, 60 * 60 * 24);
      await navigator.clipboard.writeText(url);
      toast.success('Enlace temporal copiado (válido 24h)');
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    try {
      if (renameTarget.kind === 'folder') {
        await drive.renameFolder(renameTarget.id, renameTarget.name);
      } else {
        await drive.renameFile(renameTarget.id, renameTarget.name);
      }
      toast.success('Renombrado');
    } catch (e: any) {
      toast.error(e.message);
    }
    setRenameTarget(null);
  };

  const handleMove = async (newParentId: string | null) => {
    if (!moveTarget) return;
    try {
      if (moveTarget.kind === 'folder') {
        await drive.moveFolder(moveTarget.id, newParentId);
      } else {
        await drive.moveFile(moveTarget.id, newParentId);
      }
      toast.success('Movido');
    } catch (e: any) {
      toast.error(e.message);
    }
    setMoveTarget(null);
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderId) return;
    try {
      await drive.deleteFolder(deleteFolderId);
      toast.success('Carpeta eliminada');
    } catch (e: any) {
      toast.error(e.message);
    }
    setDeleteFolderId(null);
  };

  const handleDeleteFile = async () => {
    if (!deleteFileId) return;
    try {
      await drive.deleteFile(deleteFileId);
      if (selectedFileId === deleteFileId) setSelectedFileId(null);
      toast.success('Archivo eliminado');
    } catch (e: any) {
      toast.error(e.message);
    }
    setDeleteFileId(null);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await drive.createFolder(name, currentFolderId);
      toast.success('Carpeta creada');
    } catch (e: any) {
      toast.error(e.message);
    }
    setNewFolderName('');
    setNewFolderOpen(false);
  };

  if (drive.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-border space-y-2.5">
          {/* Breadcrumb / filter */}
          <div className="flex items-center gap-1 text-xs flex-wrap">
            <button
              onClick={() => { setCurrentFolderId(null); setEntityFilter(null); }}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              Mis Archivos
            </button>
            {!entityFilter && breadcrumb.map(f => (
              <div key={f.id} className="flex items-center gap-1">
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                <button
                  onClick={() => setCurrentFolderId(f.id)}
                  className="text-foreground hover:text-primary transition-colors"
                >
                  {f.name}
                </button>
              </div>
            ))}
            {entityFilter && (() => {
              const e = entityFilter;
              let label = '';
              if (e.type === 'area') label = areas.find(a => a.id === e.id)?.name || '';
              else if (e.type === 'project') label = projects.find(p => p.id === e.id)?.name || '';
              else label = tasks.find(t => t.id === e.id)?.name || '';
              const typeLabel = e.type === 'area' ? 'Área' : e.type === 'project' ? 'Proyecto' : 'Tarea';
              return (
                <div className="flex items-center gap-1">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    {typeLabel}: {label}
                    <button onClick={() => setEntityFilter(null)} className="hover:text-destructive">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                </div>
              );
            })()}
          </div>

          {/* Entity filter selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Filtrar por:</span>
            <Select
              value={entityFilter ? `${entityFilter.type}:${entityFilter.id}` : 'none'}
              onValueChange={v => {
                if (v === 'none') setEntityFilter(null);
                else {
                  const [type, id] = v.split(':');
                  setEntityFilter({ type: type as EntityType, id });
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs w-64">
                <SelectValue placeholder="Sin filtro" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">Sin filtro (carpetas)</SelectItem>
                {areas.map(a => (
                  <SelectItem key={`area:${a.id}`} value={`area:${a.id}`}>
                    Área · {a.name}
                  </SelectItem>
                ))}
                {projects.map(p => (
                  <SelectItem key={`project:${p.id}`} value={`project:${p.id}`}>
                    Proyecto · {p.name}
                  </SelectItem>
                ))}
                {tasks.map(t => (
                  <SelectItem key={`task:${t.id}`} value={`task:${t.id}`}>
                    Tarea · {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar archivos..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="w-4 h-4 mr-1.5" />
              Carpeta
            </Button>
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4 mr-1.5" />
              Subir
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={e => {
                if (e.target.files) handleUpload(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {availableTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">Etiquetas:</span>
              {availableTags.map(t => {
                const active = activeTags.includes(t);
                return (
                  <Badge
                    key={t}
                    variant={active ? 'default' : 'secondary'}
                    className="cursor-pointer text-xs"
                    onClick={() =>
                      setActiveTags(active ? activeTags.filter(x => x !== t) : [...activeTags, t])
                    }
                  >
                    #{t}
                  </Badge>
                );
              })}
              {activeTags.length > 0 && (
                <button
                  onClick={() => setActiveTags([])}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  limpiar
                </button>
              )}
            </div>
          )}
        </div>

        {/* File/folder list with drag&drop */}
        <ScrollArea
          className={`flex-1 ${dragOver ? 'bg-primary/5' : ''}`}
          onDragOver={(e: any) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e: any) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) handleUpload(e.dataTransfer.files);
          }}
        >
          <div className="p-4 space-y-0.5">
            {visibleFolders.length === 0 && visibleFiles.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Folder className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Esta carpeta está vacía</p>
                <p className="text-[11px] mt-1">Arrastra archivos aquí o usa el botón Subir</p>
              </div>
            )}

            {visibleFolders.map(folder => (
              <div
                key={folder.id}
                className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-accent cursor-pointer"
                onDoubleClick={() => setCurrentFolderId(folder.id)}
              >
                <Folder className="w-4 h-4 text-primary shrink-0" />
                <button
                  className="flex-1 text-left text-xs text-foreground truncate"
                  onClick={() => setCurrentFolderId(folder.id)}
                >
                  {folder.name}
                </button>
                <span className="text-[11px] text-muted-foreground hidden md:inline">
                  {new Date(folder.updatedAt).toLocaleDateString()}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="w-7 h-7 opacity-0 group-hover:opacity-100">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setRenameTarget({ kind: 'folder', id: folder.id, name: folder.name })}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-2" /> Renombrar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setMoveTarget({ kind: 'folder', id: folder.id })}>
                      <Move className="w-3.5 h-3.5 mr-2" /> Mover
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteFolderId(folder.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {visibleFiles.map(file => {
              const Icon = fileIcon(file.mimeType);
              const isSelected = selectedFileId === file.id;
              return (
                <div
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-xs text-foreground truncate">{file.name}</span>
                  <div className="flex gap-1 hidden md:flex">
                    {file.tags.slice(0, 2).map(t => (
                      <Badge key={t} variant="secondary" className="text-[10px] h-4 px-1.5">
                        #{t}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-[11px] text-muted-foreground hidden md:inline w-14 text-right">
                    {formatSize(file.size)}
                  </span>
                  <span className="text-[11px] text-muted-foreground hidden lg:inline w-20 text-right">
                    {new Date(file.createdAt).toLocaleDateString()}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 opacity-0 group-hover:opacity-100"
                        onClick={e => e.stopPropagation()}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => handleDownload(file)}>
                        <Download className="w-3.5 h-3.5 mr-2" /> Descargar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleCopyLink(file)}>
                        <LinkIcon className="w-3.5 h-3.5 mr-2" /> Copiar enlace temporal
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setRenameTarget({ kind: 'file', id: file.id, name: file.name })}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Renombrar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMoveTarget({ kind: 'file', id: file.id })}>
                        <Move className="w-3.5 h-3.5 mr-2" /> Mover
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteFileId(file.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Detail panel */}
      {selectedFile && (
        <aside className="w-72 border-l border-border bg-card/30 flex flex-col">
          <div className="p-3 border-b border-border flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{selectedFile.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatSize(selectedFile.size)} • {new Date(selectedFile.createdAt).toLocaleString()}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => setSelectedFileId(null)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {/* Preview */}
              {selectedFile.mimeType?.startsWith('image/') && previewUrl && (
                <img
                  src={previewUrl}
                  alt={selectedFile.name}
                  className="w-full rounded-md border border-border"
                />
              )}
              {selectedFile.mimeType?.includes('pdf') && (
                <div className="rounded-md border border-border bg-muted/20 p-2">
                  {pdfPreviewLoading && (
                    <p className="text-xs text-muted-foreground mb-2">Cargando PDF…</p>
                  )}
                  {!pdfPreviewError && previewUrl && (
                    <canvas ref={pdfCanvasRef} className="w-full rounded bg-background" />
                  )}
                  {pdfPreviewError && (
                    <p className="text-xs text-muted-foreground">No se ha podido previsualizar este PDF.</p>
                  )}
                </div>
              )}

              {/* Tags */}
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <TagIcon className="w-3 h-3" />
                  Etiquetas
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedFile.tags.map(t => (
                    <Badge key={t} variant="secondary" className="text-xs gap-1">
                      #{t}
                      <button
                        onClick={() => drive.removeFileTag(selectedFile.id, t)}
                        className="hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        drive.addFileTag(selectedFile.id, tagInput);
                        setTagInput('');
                      }
                    }}
                    placeholder="Nueva etiqueta..."
                    className="h-7 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    onClick={() => {
                      drive.addFileTag(selectedFile.id, tagInput);
                      setTagInput('');
                    }}
                  >
                    +
                  </Button>
                </div>
              </div>

              {/* Entity links */}
              <div className="pt-2 border-t border-border">
                <FileLinksManager
                  fileId={selectedFile.id}
                  links={drive.links}
                  onAdd={drive.addFileLink}
                  onRemove={drive.removeFileLink}
                />
              </div>

              {/* Actions */}
              <div className="space-y-1.5 pt-2 border-t border-border">
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => handleDownload(selectedFile)}>
                  <Download className="w-3.5 h-3.5 mr-2" /> Descargar
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => handleCopyLink(selectedFile)}>
                  <LinkIcon className="w-3.5 h-3.5 mr-2" /> Copiar enlace (24h)
                </Button>
              </div>
            </div>
          </ScrollArea>
        </aside>
      )}

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva carpeta</DialogTitle>
            <DialogDescription>Crea una carpeta dentro de la ubicación actual.</DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="Nombre de la carpeta"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateFolder}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={open => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renombrar</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTarget?.name || ''}
            onChange={e =>
              renameTarget && setRenameTarget({ ...renameTarget, name: e.target.value })
            }
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={handleRename}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move dialog */}
      <Dialog open={!!moveTarget} onOpenChange={open => !open && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover a...</DialogTitle>
            <DialogDescription>Selecciona la carpeta de destino.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-72">
            <div className="space-y-1">
              <button
                onClick={() => handleMove(null)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent text-left text-sm"
              >
                <Home className="w-4 h-4" /> Mis Archivos (raíz)
              </button>
              {drive.folders
                .filter(f => moveTarget?.kind !== 'folder' || f.id !== moveTarget.id)
                .map(f => {
                  // Build path for display
                  const path: string[] = [f.name];
                  let p = f.parentId;
                  while (p) {
                    const par = drive.folders.find(x => x.id === p);
                    if (!par) break;
                    path.unshift(par.name);
                    p = par.parentId;
                  }
                  return (
                    <button
                      key={f.id}
                      onClick={() => handleMove(f.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent text-left text-sm"
                    >
                      <Folder className="w-4 h-4 text-primary" />
                      {path.join(' / ')}
                    </button>
                  );
                })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Delete folder confirmation */}
      <AlertDialog open={!!deleteFolderId} onOpenChange={open => !open && setDeleteFolderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar carpeta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán también todas las subcarpetas y archivos que contiene. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFolder} className="bg-destructive text-destructive-foreground">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete file confirmation */}
      <AlertDialog open={!!deleteFileId} onOpenChange={open => !open && setDeleteFileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar archivo?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFile} className="bg-destructive text-destructive-foreground">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
