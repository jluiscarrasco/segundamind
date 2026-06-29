import { useState, useCallback, useEffect, useRef } from 'react';
import { db, storage } from '@/integrations/firebase/config';
import { useAuth } from '@/contexts/AuthContext';
import type { UserFolder, UserFile, UserFileLink, EntityType } from '@/types';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
  writeBatch, orderBy, onSnapshot, Unsubscribe,
} from 'firebase/firestore';
import {
  ref, uploadBytes, deleteObject, getBytes, getDownloadURL, listAll,
} from 'firebase/storage';

const BUCKET = 'attachments';

function mapFolder(doc: any): UserFolder {
  return {
    id: doc.id,
    parentId: doc.parentId,
    name: doc.name,
    createdAt: doc.createdAt?.toDate?.().toISOString() || new Date().toISOString(),
    updatedAt: doc.updatedAt?.toDate?.().toISOString() || new Date().toISOString(),
  };
}

function mapFile(doc: any, tags: string[] = []): UserFile {
  return {
    id: doc.id,
    folderId: doc.folderId,
    name: doc.name,
    storagePath: doc.storagePath,
    mimeType: doc.mimeType,
    size: Number(doc.size ?? 0),
    createdAt: doc.createdAt?.toDate?.().toISOString() || new Date().toISOString(),
    updatedAt: doc.updatedAt?.toDate?.().toISOString() || new Date().toISOString(),
    tags,
  };
}

function mapLink(doc: any): UserFileLink {
  return {
    id: doc.id,
    fileId: doc.fileId,
    entityType: doc.entityType,
    entityId: doc.entityId,
    createdAt: doc.createdAt?.toDate?.().toISOString() || new Date().toISOString(),
  };
}

export function useDrive() {
  const { user } = useAuth();
  const [folders, setFolders] = useState<UserFolder[]>([]);
  const [files, setFiles] = useState<UserFile[]>([]);
  const [links, setLinks] = useState<UserFileLink[]>([]);
  const [loading, setLoading] = useState(true);
  const unsubscribersRef = useCallback(() => new Map<string, Unsubscribe>(), [])();

  // Setup real-time listeners
  useEffect(() => {
    if (!user) {
      setFolders([]);
      setFiles([]);
      setLinks([]);
      setLoading(false);
      return;
    }

    const unsubscribers = new Map<string, Unsubscribe>();

    // Folders listener — sort in JS to avoid needing a composite index
    unsubscribers.set('folders', onSnapshot(
      query(collection(db, 'user_folders'), where('userId', '==', user.uid)),
      (snapshot) => {
        setFolders(
          snapshot.docs
            .map((doc) => mapFolder({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        );
      },
      (error) => {
        console.error('❌ Folders listener error:', error);
      }
    ));

    // Files listener — sort in JS to avoid needing a composite index
    unsubscribers.set('files', onSnapshot(
      query(collection(db, 'user_files'), where('userId', '==', user.uid)),
      (snapshot) => {
        setFiles(snapshot.docs.map((doc) => {
          const fileId = doc.id;
          const fileTags = files.find(f => f.id === fileId)?.tags || [];
          return mapFile({ id: doc.id, ...doc.data() }, fileTags);
        }).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      },
      (error) => {
        console.error('❌ Files listener error:', error);
      }
    ));

    // Tags listener (build tag map on demand)
    unsubscribers.set('tags', onSnapshot(
      query(collection(db, 'user_file_tags'), where('userId', '==', user.uid)),
      (snapshot) => {
        const tagsByFile = new Map<string, string[]>();
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          const list = tagsByFile.get(data.fileId) || [];
          list.push(data.tag);
          tagsByFile.set(data.fileId, list);
        });
        // Update files with tags
        setFiles(f => f.map(file => ({
          ...file,
          tags: tagsByFile.get(file.id) || [],
        })));
      },
      (error) => {
        console.error('❌ Tags listener error:', error);
      }
    ));

    // Links listener
    unsubscribers.set('links', onSnapshot(
      query(collection(db, 'user_file_links'), where('userId', '==', user.uid)),
      (snapshot) => {
        setLinks(snapshot.docs.map((doc) => mapLink({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        console.error('❌ Links listener error:', error);
      }
    ));

    setLoading(false);

    // Save unsubscribers
    unsubscribersRef.clear();
    unsubscribers.forEach((unsub, key) => unsubscribersRef.set(key, unsub));

    return () => {
      unsubscribersRef.forEach(unsub => unsub());
      unsubscribersRef.clear();
    };
  }, [user, unsubscribersRef]);

  // One-time cleanup: remove duplicate EMPTY folders (same name + same parent).
  // Auto-seeding previously created duplicates on every reload; this self-heals.
  const cleanedRef = useRef(false);
  useEffect(() => {
    if (!user || loading || cleanedRef.current) return;
    if (folders.length === 0) return;

    // Group folders by parentId|name
    const groups = new Map<string, UserFolder[]>();
    folders.forEach(f => {
      const key = `${f.parentId ?? 'root'}|${f.name}`;
      const list = groups.get(key) || [];
      list.push(f);
      groups.set(key, list);
    });

    // Find duplicates whose extras are empty (no subfolders, no files)
    const toDelete: string[] = [];
    groups.forEach(list => {
      if (list.length <= 1) return;
      // Keep the first, evaluate the rest
      list.slice(1).forEach(dup => {
        const hasSubfolder = folders.some(f => f.parentId === dup.id);
        const hasFiles = files.some(f => f.folderId === dup.id);
        if (!hasSubfolder && !hasFiles) toDelete.push(dup.id);
      });
    });

    if (toDelete.length === 0) {
      cleanedRef.current = true;
      return;
    }

    cleanedRef.current = true;
    (async () => {
      try {
        const batch = writeBatch(db);
        toDelete.forEach(id => batch.delete(doc(db, 'user_folders', id)));
        await batch.commit();
        console.log(`🧹 Removed ${toDelete.length} duplicate empty folders`);
      } catch (e) {
        console.error('Cleanup failed:', e);
      }
    })();
  }, [user, loading, folders, files]);

  // --- Folders ---
  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    if (!user) return;
    const docRef = await addDoc(collection(db, 'user_folders'), {
      name,
      parentId,
      userId: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setFolders(f => [...f, {
      id: docRef.id,
      name,
      parentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
  }, [user]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    await updateDoc(doc(db, 'user_folders', id), {
      name,
      updatedAt: serverTimestamp(),
    });
    setFolders(f => f.map(x => (x.id === id ? { ...x, name } : x)));
  }, []);

  const moveFolder = useCallback(async (id: string, newParentId: string | null) => {
    await updateDoc(doc(db, 'user_folders', id), {
      parentId: newParentId,
      updatedAt: serverTimestamp(),
    });
    setFolders(f => f.map(x => (x.id === id ? { ...x, parentId: newParentId } : x)));
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    if (!user) return;

    // Get all files in this folder and subfolders
    const allFolderIds = new Set<string>([id]);
    const collectSubfolders = (parentId: string) => {
      folders.filter(f => f.parentId === parentId).forEach(f => {
        allFolderIds.add(f.id);
        collectSubfolders(f.id);
      });
    };
    collectSubfolders(id);

    // Get all files to delete from storage
    const filesToDelete = files.filter(f => allFolderIds.has(f.folderId || ''));
    const batch = writeBatch(db);

    // Delete files from storage and database
    for (const file of filesToDelete) {
      try {
        await deleteObject(ref(storage, file.storagePath));
      } catch (e) {
        console.warn('File not found in storage:', file.storagePath);
      }
      batch.delete(doc(db, 'user_files', file.id));
    }

    // Delete folders
    allFolderIds.forEach(folderId => {
      batch.delete(doc(db, 'user_folders', folderId));
    });

    await batch.commit();

    setFolders(f => f.filter(x => !allFolderIds.has(x.id)));
    setFiles(f => f.filter(x => !filesToDelete.includes(x)));
  }, [user, folders, files]);

  // --- Files ---
  const uploadFile = useCallback(
    async (file: File, folderId: string | null) => {
      if (!user) return;

      const fileId = crypto.randomUUID();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const storagePath = `${user.uid}/drive/${fileId}${ext ? '.' + ext : ''}`;

      try {
        // Upload directly to Firebase Storage
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' });

        // Create Firestore record
        const docRef = await addDoc(collection(db, 'user_files'), {
          folderId,
          name: file.name,
          storagePath,
          mimeType: file.type || null,
          size: file.size,
          userId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        setFiles(f => [...f, mapFile({
          id: docRef.id,
          folderId,
          name: file.name,
          storagePath,
          mimeType: file.type,
          size: file.size,
        }, [])]);
      } catch (error: any) {
        console.error('Upload error:', error);
        // Clean up storage if Firestore write failed
        try { await deleteObject(ref(storage, storagePath)); } catch {}
        throw error;
      }
    },
    [user]
  );

  const renameFile = useCallback(async (id: string, name: string) => {
    await updateDoc(doc(db, 'user_files', id), {
      name,
      updatedAt: serverTimestamp(),
    });
    setFiles(f => f.map(x => (x.id === id ? { ...x, name } : x)));
  }, []);

  const moveFile = useCallback(async (id: string, folderId: string | null) => {
    await updateDoc(doc(db, 'user_files', id), {
      folderId,
      updatedAt: serverTimestamp(),
    });
    setFiles(f => f.map(x => (x.id === id ? { ...x, folderId } : x)));
  }, []);

  const deleteFile = useCallback(async (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file) return;

    try {
      // Delete from storage
      await deleteObject(ref(storage, file.storagePath));
    } catch (e) {
      console.warn('File not found in storage:', file.storagePath);
    }

    // Delete from database
    await deleteDoc(doc(db, 'user_files', id));
    setFiles(f => f.filter(x => x.id !== id));
  }, [files]);

  const getSignedUrl = useCallback(async (storagePath: string) => {
    try {
      const fileRef = ref(storage, storagePath);
      const url = await getDownloadURL(fileRef);
      return url;
    } catch (error) {
      console.error('Error getting download URL:', error);
      throw error;
    }
  }, []);

  // --- Tags ---
  const addFileTag = useCallback(async (fileId: string, tag: string) => {
    if (!user) return;
    const trimmed = tag.trim();
    if (!trimmed) return;

    try {
      await addDoc(collection(db, 'user_file_tags'), {
        fileId,
        tag: trimmed,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });

      setFiles(f =>
        f.map(x =>
          x.id === fileId && !x.tags.includes(trimmed)
            ? { ...x, tags: [...x.tags, trimmed] }
            : x
        )
      );
    } catch (error) {
      // Silently ignore duplicate errors
      if (!String(error).includes('duplicate')) {
        throw error;
      }
    }
  }, [user]);

  const removeFileTag = useCallback(async (fileId: string, tag: string) => {
    if (!user) return;

    // Find and delete the tag document
    const tagsSnapshot = await getDocs(
      query(
        collection(db, 'user_file_tags'),
        where('fileId', '==', fileId),
        where('tag', '==', tag),
        where('userId', '==', user.uid)
      )
    );

    const batch = writeBatch(db);
    tagsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    setFiles(f =>
      f.map(x => (x.id === fileId ? { ...x, tags: x.tags.filter(t => t !== tag) } : x))
    );
  }, [user]);

  // --- Links to entities ---
  const addFileLink = useCallback(async (fileId: string, entityType: EntityType, entityId: string) => {
    if (!user) return;

    try {
      const docRef = await addDoc(collection(db, 'user_file_links'), {
        fileId,
        entityType,
        entityId,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });

      setLinks(l => [...l, {
        id: docRef.id,
        fileId,
        entityType,
        entityId,
        createdAt: new Date().toISOString(),
      }]);
    } catch (error) {
      // Silently ignore duplicate errors
      if (!String(error).includes('duplicate')) {
        throw error;
      }
    }
  }, [user]);

  const removeFileLink = useCallback(async (linkId: string) => {
    await deleteDoc(doc(db, 'user_file_links', linkId));
    setLinks(l => l.filter(x => x.id !== linkId));
  }, []);

  return {
    folders,
    files,
    links,
    loading,
    reload: async () => {
      // Listeners handle reload automatically
    },
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    uploadFile,
    renameFile,
    moveFile,
    deleteFile,
    getSignedUrl,
    addFileTag,
    removeFileTag,
    addFileLink,
    removeFileLink,
  };
}
