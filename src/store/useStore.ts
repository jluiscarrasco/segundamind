import { useState, useCallback, useEffect } from 'react';
import { db, storage } from '@/integrations/firebase/config';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { useAuth } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/cloud-functions';
import type { Area, Project, Task, InboxItem, Resource, WikiPage, EntityType } from '@/types';
import { generateProjectKey } from '@/types';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
  onSnapshot, orderBy, writeBatch, increment, Unsubscribe,
} from 'firebase/firestore';

interface StoreData {
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  inbox: InboxItem[];
  resources: Resource[];
  wikiPages: WikiPage[];
}

function emptyData(): StoreData {
  return { areas: [], projects: [], tasks: [], inbox: [], resources: [], wikiPages: [] };
}

// Map Firestore doc to app types (already camelCase in Firestore, just extract)
function mapArea(doc: any): Area {
  return { id: doc.id, ...doc.data() };
}
function mapProject(doc: any): Project {
  return { id: doc.id, ...doc.data() };
}
function mapTask(doc: any): Task {
  return { id: doc.id, ...doc.data() };
}
function mapInbox(doc: any): InboxItem {
  return { id: doc.id, ...doc.data() };
}
function mapResource(doc: any): Resource {
  return { id: doc.id, ...doc.data() };
}
function mapWikiPage(doc: any): WikiPage {
  return { id: doc.id, ...doc.data() };
}

export function useStore() {
  const { user } = useAuth();
  const [data, setData] = useState<StoreData>(emptyData());
  const [loading, setLoading] = useState(true);

  // Load all data on mount / user change with real-time listeners
  useEffect(() => {
    if (!user) {
      setData(emptyData());
      setLoading(false);
      return;
    }

    let cancelled = false;
    // Effect-scoped so the cleanup below can unsubscribe. Deps are [user] only.
    // Previously this was a `useCallback(() => new Map(), [])()` at component
    // scope: it built a NEW Map every render, and (being in the dep array) that
    // re-ran this effect on every render — tearing down and recreating all
    // listeners, each re-listen billing a full re-read of every collection.
    const unsubscribers = new Map<string, Unsubscribe>();

    async function setupListeners() {
      try {
        unsubscribers.set('areas', onSnapshot(
          query(collection(db, 'areas'), where('userId', '==', user.uid)),
          (snapshot) => {
            if (!cancelled) {
              setData(d => ({ ...d, areas: snapshot.docs.map(mapArea).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }));
            }
          }
        ));

        unsubscribers.set('projects', onSnapshot(
          query(collection(db, 'projects'), where('userId', '==', user.uid)),
          (snapshot) => {
            if (!cancelled) {
              setData(d => ({ ...d, projects: snapshot.docs.map(mapProject).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }));
            }
          }
        ));

        unsubscribers.set('tasks', onSnapshot(
          query(collection(db, 'tasks'), where('userId', '==', user.uid)),
          (snapshot) => {
            if (!cancelled) {
              setData(d => ({ ...d, tasks: snapshot.docs.map(mapTask).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }));
            }
          }
        ));

        unsubscribers.set('inbox_items', onSnapshot(
          query(collection(db, 'inbox_items'), where('userId', '==', user.uid)),
          (snapshot) => {
            if (!cancelled) {
              setData(d => ({ ...d, inbox: snapshot.docs.map(mapInbox).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }));
            }
          }
        ));

        unsubscribers.set('resources', onSnapshot(
          query(collection(db, 'resources'), where('userId', '==', user.uid)),
          (snapshot) => {
            if (!cancelled) {
              setData(d => ({ ...d, resources: snapshot.docs.map(mapResource).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }));
            }
          }
        ));

        unsubscribers.set('wiki_pages', onSnapshot(
          query(collection(db, 'wiki_pages'), where('userId', '==', user.uid)),
          (snapshot) => {
            if (!cancelled) {
              setData(d => ({ ...d, wikiPages: snapshot.docs.map(mapWikiPage).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) }));
            }
          }
        ));

        setLoading(false);
      } catch (error) {
        console.error('Error setting up listeners:', error);
        setLoading(false);
      }
    }

    setupListeners();

    return () => {
      cancelled = true;
      unsubscribers.forEach(unsub => unsub());
      unsubscribers.clear();
    };
  }, [user]);

  // --- Areas ---
  const addArea = useCallback(async (area: Omit<Area, 'id' | 'createdAt'>) => {
    if (!user) return;
    console.log('Adding area:', area);
    const docRef = await addDoc(collection(db, 'areas'), {
      ...area,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });
    console.log('Area created with ID:', docRef.id);
    return { ...area, id: docRef.id, createdAt: new Date().toISOString() };
  }, [user]);

  // Update/delete helpers apply local state FIRST (optimistic — instant UI),
  // then await the server write. updateDoc's promise only resolves on server
  // ack, so updating state after the await made every edit feel laggy. If the
  // write fails, the active onSnapshot listener restores the server truth.
  const updateArea = useCallback(async (id: string, patch: Partial<Area>) => {
    const dbPatch: any = { ...patch };
    delete dbPatch.id;
    delete dbPatch.createdAt;
    setData(d => ({ ...d, areas: d.areas.map(a => a.id === id ? { ...a, ...patch } : a) }));
    await updateDoc(doc(db, 'areas', id), dbPatch);
  }, []);

  const deleteArea = useCallback(async (id: string) => {
    setData(d => {
      const projectIds = d.projects.filter(p => p.areaId === id).map(p => p.id);
      return {
        ...d,
        areas: d.areas.filter(a => a.id !== id),
        projects: d.projects.filter(p => p.areaId !== id),
        tasks: d.tasks.filter(t => !projectIds.includes(t.projectId)),
        resources: d.resources.filter(r => !projectIds.includes(r.entityId) && r.entityId !== id),
      };
    });
    await deleteDoc(doc(db, 'areas', id));
  }, []);

  // --- Projects ---
  const addProject = useCallback(async (project: Omit<Project, 'id' | 'createdAt' | 'key' | 'taskCounter'>) => {
    if (!user) return;
    const existingKeys = data.projects.map(p => p.key);
    const key = generateProjectKey(project.name, existingKeys);
    const docRef = await addDoc(collection(db, 'projects'), {
      ...project,
      key,
      taskCounter: 0,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });
    return { ...project, id: docRef.id, key, taskCounter: 0, createdAt: new Date().toISOString() };
  }, [user, data.projects]);

  const updateProject = useCallback(async (id: string, patch: Partial<Project>) => {
    const dbPatch: any = { ...patch };
    delete dbPatch.id;
    delete dbPatch.createdAt;
    setData(d => ({ ...d, projects: d.projects.map(p => p.id === id ? { ...p, ...patch } : p) }));
    await updateDoc(doc(db, 'projects', id), dbPatch);
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    setData(d => ({
      ...d,
      projects: d.projects.filter(p => p.id !== id),
      tasks: d.tasks.filter(t => t.projectId !== id),
      resources: d.resources.filter(r => r.entityId !== id),
    }));
    await deleteDoc(doc(db, 'projects', id));
  }, []);

  // --- Tasks ---
  const addTask = useCallback(async (task: Omit<Task, 'id' | 'createdAt' | 'taskNumber'>) => {
    if (!user) return;
    // Increment project counter atomically
    const projectRef = doc(db, 'projects', task.projectId);
    const project = data.projects.find(p => p.id === task.projectId);
    const nextNumber = (project?.taskCounter ?? 0) + 1;

    await updateDoc(projectRef, { taskCounter: nextNumber });

    const docRef = await addDoc(collection(db, 'tasks'), {
      ...task,
      taskNumber: nextNumber,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });

    return {
      ...task,
      id: docRef.id,
      taskNumber: nextNumber,
      createdAt: new Date().toISOString(),
    };
  }, [user, data.projects]);

  const updateTask = useCallback(async (id: string, patch: Partial<Task>) => {
    const dbPatch: any = { ...patch };
    delete dbPatch.id;
    delete dbPatch.createdAt;
    delete dbPatch.taskNumber;
    delete dbPatch.projectId;
    // Firestore rejects undefined values in updateDoc
    Object.keys(dbPatch).forEach(k => dbPatch[k] === undefined && delete dbPatch[k]);
    setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === id ? { ...t, ...patch } : t) }));
    await updateDoc(doc(db, 'tasks', id), dbPatch);
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    setData(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== id) }));
    await deleteDoc(doc(db, 'tasks', id));
  }, []);

  // Reassign a task to another project. Consumes a new taskNumber from the
  // destination project's counter so the new display ID matches its scheme
  // (e.g. moving a task into project SEC gives it SEC-<next>).
  const moveTaskToProject = useCallback(async (taskId: string, newProjectId: string) => {
    if (!user) return;
    const task = data.tasks.find(t => t.id === taskId);
    if (!task || task.projectId === newProjectId) return;
    const newProject = data.projects.find(p => p.id === newProjectId);
    if (!newProject) return;
    const nextNumber = (newProject.taskCounter ?? 0) + 1;
    // Optimistic: bump counter and reassign the task in local state
    setData(d => ({
      ...d,
      projects: d.projects.map(p => p.id === newProjectId ? { ...p, taskCounter: nextNumber } : p),
      tasks: d.tasks.map(t => t.id === taskId ? { ...t, projectId: newProjectId, taskNumber: nextNumber } : t),
    }));
    await updateDoc(doc(db, 'projects', newProjectId), { taskCounter: nextNumber });
    await updateDoc(doc(db, 'tasks', taskId), { projectId: newProjectId, taskNumber: nextNumber });
  }, [user, data.tasks, data.projects]);

  // --- Inbox ---
  const addInboxItem = useCallback(async (item: Omit<InboxItem, 'id' | 'createdAt'>) => {
    if (!user) return null;
    const docRef = await addDoc(collection(db, 'inbox_items'), {
      ...item,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });
    return { ...item, id: docRef.id, createdAt: new Date().toISOString() };
  }, [user]);

  const enrichUrlInboxItem = useCallback(async (inboxId: string, url: string) => {
    // Don't update inbox content with scraped data
    // Let user click AI button to get intelligent proposal
  }, []);

  const removeInboxItem = useCallback(async (id: string) => {
    const item = data.inbox.find(i => i.id === id);
    setData(d => ({ ...d, inbox: d.inbox.filter(i => i.id !== id) }));
    await deleteDoc(doc(db, 'inbox_items', id));
    // If it was an image, best-effort delete the file from Storage too so
    // discarding an inbox item does not leave orphan blobs behind.
    if (item?.type === 'image') {
      const url = extractImageUrl(item.content);
      if (url) await deleteStorageFile(url);
    }
  }, [data.inbox]);

  // Pull the storage URL out of an inbox image item's content.
  // Content is either a bare URL or "caption\n\n![image](url)".
  const extractImageUrl = (content: string): string | null => {
    const md = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
    const candidate = (md ? md[1] : content).trim();
    return candidate.startsWith('http') && candidate.includes('firebasestorage.googleapis.com')
      ? candidate
      : null;
  };

  // Best-effort delete of a Firebase Storage file from its download URL.
  const deleteStorageFile = async (url: string) => {
    try {
      const r = storageRef(storage, url);
      await deleteObject(r);
    } catch (err) {
      console.warn('[storage] delete failed', err);
    }
  };

  const convertInboxToTask = useCallback(async (inboxId: string, projectId: string, importance: Task['importance'], taskName?: string, taskDescription?: string, opts?: { discardImage?: boolean }) => {
    if (!user) return;
    const item = data.inbox.find(i => i.id === inboxId);
    if (!item) return;

    const project = data.projects.find(p => p.id === projectId);
    const nextNumber = (project?.taskCounter ?? 0) + 1;

    // Update project counter
    await updateDoc(doc(db, 'projects', projectId), { taskCounter: nextNumber });

    // Create task
    const taskDocRef = await addDoc(collection(db, 'tasks'), {
      projectId,
      taskNumber: nextNumber,
      name: taskName || item.content.slice(0, 80),
      description: taskDescription || item.content,
      status: 'funnel',
      importance,
      effort: null,
      reviewDate: null,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });

    // Auto-attach URL or image as resource if inbox item is a link or image.
    // Images can be discarded via opts.discardImage — we skip the resource
    // AND delete the file from Firebase Storage to reclaim the space.
    if (item.type === 'link') {
      await addDoc(collection(db, 'resources'), {
        entityType: 'task',
        entityId: taskDocRef.id,
        type: 'link',
        content: item.content,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
    } else if (item.type === 'image') {
      if (opts?.discardImage) {
        const url = extractImageUrl(item.content);
        if (url) await deleteStorageFile(url);
      } else {
        await addDoc(collection(db, 'resources'), {
          entityType: 'task',
          entityId: taskDocRef.id,
          type: 'image',
          content: item.content,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
    }

    // Delete inbox item
    await deleteDoc(doc(db, 'inbox_items', inboxId));

    // Only optimistic-remove the inbox item and update the project counter.
    // The `tasks` and `resources` collections have onSnapshot listeners that
    // will pick up the new documents; appending here would duplicate them.
    setData(d => ({
      ...d,
      projects: d.projects.map(p => p.id === projectId ? { ...p, taskCounter: nextNumber } : p),
      inbox: d.inbox.filter(i => i.id !== inboxId),
    }));
  }, [user, data.inbox, data.projects]);

  const attachInboxAsNote = useCallback(async (inboxId: string, entityType: EntityType, entityId: string, opts?: { discardImage?: boolean }) => {
    if (!user) return;
    const item = data.inbox.find(i => i.id === inboxId);
    if (!item) return;

    const batch = writeBatch(db);

    // Attach the inbox item as a single resource whose type matches the item —
    // unless it is an image and the caller opted to discard it, in which case
    // we only delete the storage file and drop the inbox item.
    if (!(item.type === 'image' && opts?.discardImage)) {
      const resDocRef = doc(collection(db, 'resources'));
      batch.set(resDocRef, {
        entityType,
        entityId,
        type: item.type,
        content: item.content,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
    }

    // Delete inbox item
    batch.delete(doc(db, 'inbox_items', inboxId));

    await batch.commit();

    // Discarded image: reclaim the storage space after Firestore succeeds.
    if (item.type === 'image' && opts?.discardImage) {
      const url = extractImageUrl(item.content);
      if (url) await deleteStorageFile(url);
    }

    // Only optimistic-remove the inbox item; the resources onSnapshot listener
    // will pick up the new documents and appending here would duplicate them.
    setData(d => ({
      ...d,
      inbox: d.inbox.filter(i => i.id !== inboxId),
    }));
  }, [user, data.inbox]);

  // --- Resources ---
  const addResource = useCallback(async (resource: Omit<Resource, 'id' | 'createdAt'>) => {
    if (!user) return;
    // Firestore rejects undefined values — strip them out before writing.
    const payload: any = { userId: user.uid, createdAt: serverTimestamp() };
    for (const [k, v] of Object.entries(resource)) if (v !== undefined) payload[k] = v;
    const docRef = await addDoc(collection(db, 'resources'), payload);
    return { ...resource, id: docRef.id, createdAt: new Date().toISOString() };
  }, [user]);

  const removeResource = useCallback(async (id: string) => {
    setData(d => ({ ...d, resources: d.resources.filter(r => r.id !== id) }));
    await deleteDoc(doc(db, 'resources', id));
  }, []);

  // --- Wiki Pages ---
  const addWikiPage = useCallback(async (page: Omit<WikiPage, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> => {
    if (!user) return null;
    const docRef = await addDoc(collection(db, 'wiki_pages'), {
      ...page,
      userId: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  }, [user]);

  const updateWikiPage = useCallback(async (id: string, patch: Partial<WikiPage>) => {
    const dbPatch: any = { ...patch, updatedAt: serverTimestamp() };
    delete dbPatch.id;
    delete dbPatch.createdAt;
    delete dbPatch.updatedAt; // Will be overwritten by serverTimestamp
    setData(d => ({
      ...d,
      wikiPages: d.wikiPages.map(w =>
        w.id === id ? { ...w, ...patch, updatedAt: new Date().toISOString() } : w
      ),
    }));
    await updateDoc(doc(db, 'wiki_pages', id), dbPatch);
  }, []);

  const deleteWikiPage = useCallback(async (id: string) => {
    setData(d => {
      const idsToRemove = new Set<string>();
      const collectChildren = (parentId: string) => {
        idsToRemove.add(parentId);
        d.wikiPages.filter(w => w.parentId === parentId).forEach(w => collectChildren(w.id));
      };
      collectChildren(id);
      return { ...d, wikiPages: d.wikiPages.filter(w => !idsToRemove.has(w.id)) };
    });
    await deleteDoc(doc(db, 'wiki_pages', id));
  }, []);

  const reorderWikiPage = useCallback(async (id: string, newParentId: string | null, newPosition: number) => {
    setData(d => ({
      ...d,
      wikiPages: d.wikiPages.map(w =>
        w.id === id ? { ...w, parentId: newParentId, position: newPosition } : w
      ),
    }));
    await updateDoc(doc(db, 'wiki_pages', id), {
      parentId: newParentId,
      position: newPosition,
    });
  }, []);

  return {
    ...data,
    loading,
    addArea,
    updateArea,
    deleteArea,
    addProject,
    updateProject,
    deleteProject,
    addTask,
    updateTask,
    deleteTask,
    moveTaskToProject,
    addInboxItem,
    enrichUrlInboxItem,
    removeInboxItem,
    convertInboxToTask,
    attachInboxAsNote,
    addResource,
    removeResource,
    addWikiPage,
    updateWikiPage,
    deleteWikiPage,
    reorderWikiPage,
  };
}
