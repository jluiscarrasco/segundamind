import { useState, useCallback, useEffect } from 'react';
import { db } from '@/integrations/firebase/config';
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
  const unsubscribersRef = useCallback(() => new Map<string, Unsubscribe>(), [])();

  // Load all data on mount / user change with real-time listeners
  useEffect(() => {
    if (!user) {
      setData(emptyData());
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function setupListeners() {
      try {
        // Setup real-time listeners for all collections
        const unsubscribers = new Map<string, Unsubscribe>();

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

        // Save unsubscribers for cleanup
        unsubscribersRef.clear();
        unsubscribers.forEach((unsub, key) => unsubscribersRef.set(key, unsub));
      } catch (error) {
        console.error('Error setting up listeners:', error);
        setLoading(false);
      }
    }

    setupListeners();

    return () => {
      cancelled = true;
      unsubscribersRef.forEach(unsub => unsub());
      unsubscribersRef.clear();
    };
  }, [user, unsubscribersRef]);

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

  const updateArea = useCallback(async (id: string, patch: Partial<Area>) => {
    const dbPatch: any = { ...patch };
    delete dbPatch.id;
    delete dbPatch.createdAt;
    await updateDoc(doc(db, 'areas', id), dbPatch);
    setData(d => ({ ...d, areas: d.areas.map(a => a.id === id ? { ...a, ...patch } : a) }));
  }, []);

  const deleteArea = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'areas', id));
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
    await updateDoc(doc(db, 'projects', id), dbPatch);
    setData(d => ({ ...d, projects: d.projects.map(p => p.id === id ? { ...p, ...patch } : p) }));
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'projects', id));
    setData(d => ({
      ...d,
      projects: d.projects.filter(p => p.id !== id),
      tasks: d.tasks.filter(t => t.projectId !== id),
      resources: d.resources.filter(r => r.entityId !== id),
    }));
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
    await updateDoc(doc(db, 'tasks', id), dbPatch);
    setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === id ? { ...t, ...patch } : t) }));
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'tasks', id));
    setData(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== id) }));
  }, []);

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
    await deleteDoc(doc(db, 'inbox_items', id));
    setData(d => ({ ...d, inbox: d.inbox.filter(i => i.id !== id) }));
  }, []);

  const convertInboxToTask = useCallback(async (inboxId: string, projectId: string, importance: Task['importance'], taskName?: string, taskDescription?: string) => {
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

    const newTask: Task = {
      id: taskDocRef.id,
      projectId,
      taskNumber: nextNumber,
      name: taskName || item.content.slice(0, 80),
      description: taskDescription || item.content,
      status: 'funnel',
      importance,
      effort: null,
      reviewDate: null,
      createdAt: new Date().toISOString(),
    };

    // Auto-attach URL as resource if inbox item is a link
    let newResource: Resource | null = null;
    if (item.type === 'link') {
      const resDocRef = await addDoc(collection(db, 'resources'), {
        entityType: 'task',
        entityId: newTask.id,
        type: 'link',
        content: item.content,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
      newResource = {
        id: resDocRef.id,
        entityType: 'task',
        entityId: newTask.id,
        type: 'link',
        content: item.content,
        createdAt: new Date().toISOString(),
      };
    }

    // Delete inbox item
    await deleteDoc(doc(db, 'inbox_items', inboxId));

    setData(d => ({
      ...d,
      projects: d.projects.map(p => p.id === projectId ? { ...p, taskCounter: nextNumber } : p),
      inbox: d.inbox.filter(i => i.id !== inboxId),
      tasks: [...d.tasks, newTask],
      resources: newResource ? [...d.resources, newResource] : d.resources,
    }));
  }, [user, data.inbox, data.projects]);

  const attachInboxAsNote = useCallback(async (inboxId: string, entityType: EntityType, entityId: string) => {
    if (!user) return;
    const item = data.inbox.find(i => i.id === inboxId);
    if (!item) return;

    const batch = writeBatch(db);
    const newResources: Resource[] = [];

    // Add link resource if item is a link
    if (item.type === 'link') {
      const resDocRef = doc(collection(db, 'resources'));
      batch.set(resDocRef, {
        entityType,
        entityId,
        type: 'link',
        content: item.content,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
      newResources.push({
        id: resDocRef.id,
        entityType,
        entityId,
        type: 'link',
        content: item.content,
        createdAt: new Date().toISOString(),
      });
    }

    // Always add note resource
    const noteDocRef = doc(collection(db, 'resources'));
    batch.set(noteDocRef, {
      entityType,
      entityId,
      type: 'note',
      content: item.content,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });
    newResources.push({
      id: noteDocRef.id,
      entityType,
      entityId,
      type: 'note',
      content: item.content,
      createdAt: new Date().toISOString(),
    });

    // Delete inbox item
    batch.delete(doc(db, 'inbox_items', inboxId));

    await batch.commit();

    setData(d => ({
      ...d,
      inbox: d.inbox.filter(i => i.id !== inboxId),
      resources: [...d.resources, ...newResources],
    }));
  }, [user, data.inbox]);

  // --- Resources ---
  const addResource = useCallback(async (resource: Omit<Resource, 'id' | 'createdAt'>) => {
    if (!user) return;
    const docRef = await addDoc(collection(db, 'resources'), {
      ...resource,
      userId: user.uid,
      createdAt: serverTimestamp(),
    });
    return { ...resource, id: docRef.id, createdAt: new Date().toISOString() };
  }, [user]);

  const removeResource = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'resources', id));
    setData(d => ({ ...d, resources: d.resources.filter(r => r.id !== id) }));
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
    await updateDoc(doc(db, 'wiki_pages', id), dbPatch);
    setData(d => ({
      ...d,
      wikiPages: d.wikiPages.map(w =>
        w.id === id ? { ...w, ...patch, updatedAt: new Date().toISOString() } : w
      ),
    }));
  }, []);

  const deleteWikiPage = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'wiki_pages', id));
    setData(d => {
      const idsToRemove = new Set<string>();
      const collectChildren = (parentId: string) => {
        idsToRemove.add(parentId);
        d.wikiPages.filter(w => w.parentId === parentId).forEach(w => collectChildren(w.id));
      };
      collectChildren(id);
      return { ...d, wikiPages: d.wikiPages.filter(w => !idsToRemove.has(w.id)) };
    });
  }, []);

  const reorderWikiPage = useCallback(async (id: string, newParentId: string | null, newPosition: number) => {
    await updateDoc(doc(db, 'wiki_pages', id), {
      parentId: newParentId,
      position: newPosition,
    });
    setData(d => ({
      ...d,
      wikiPages: d.wikiPages.map(w =>
        w.id === id ? { ...w, parentId: newParentId, position: newPosition } : w
      ),
    }));
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
