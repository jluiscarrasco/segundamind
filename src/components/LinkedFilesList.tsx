import { useEffect, useState } from 'react';
import { FileIcon, Download, ExternalLink, FileText, Image as ImageIcon } from 'lucide-react';
import { useDriveContext } from '@/hooks/DriveContext';
import type { EntityType } from '@/types';
import { toast } from 'sonner';

interface Props {
  entityType: EntityType;
  entityId: string;
  /** If true, also include files linked to descendant entities */
  includeDescendants?: boolean;
  descendantIds?: { type: EntityType; id: string }[];
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mime: string | null) {
  if (!mime) return FileIcon;
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.includes('pdf') || mime.startsWith('text/')) return FileText;
  return FileIcon;
}

export function LinkedFilesList({ entityType, entityId, descendantIds = [] }: Props) {
  const { files, links, getSignedUrl } = useDriveContext();

  const targets = [{ type: entityType, id: entityId }, ...descendantIds];
  const targetSet = new Set(targets.map(t => `${t.type}:${t.id}`));
  const matchingLinks = links.filter(l => targetSet.has(`${l.entityType}:${l.entityId}`));
  const fileIds = Array.from(new Set(matchingLinks.map(l => l.fileId)));
  const linkedFiles = files.filter(f => fileIds.includes(f.id));

  const handleOpen = async (storagePath: string) => {
    try {
      const url = await getSignedUrl(storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDownload = async (storagePath: string, name: string) => {
    try {
      const url = await getSignedUrl(storagePath);
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (linkedFiles.length === 0) {
    return <p className="text-[11px] text-muted-foreground/60">Sin archivos asociados</p>;
  }

  return (
    <div className="space-y-1">
      {linkedFiles.map(f => {
        const Icon = fileIcon(f.mimeType);
        return (
          <div
            key={f.id}
            className="flex items-center gap-2 bg-secondary/40 rounded-lg px-3 py-2 group hover:bg-secondary/60 transition-colors"
          >
            <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
            <button
              onClick={() => handleOpen(f.storagePath)}
              className="flex-1 min-w-0 text-left"
            >
              <p className="text-xs text-foreground truncate">{f.name}</p>
              <span className="text-[9px] text-muted-foreground">{formatSize(f.size)}</span>
            </button>
            <button
              onClick={() => handleOpen(f.storagePath)}
              className="p-0.5 rounded hover:bg-secondary text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title="Abrir"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={() => handleDownload(f.storagePath, f.name)}
              className="p-0.5 rounded hover:bg-secondary text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title="Descargar"
            >
              <Download className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
