import { createContext, useContext, ReactNode } from 'react';
import { useStore } from './useStore';

type Store = ReturnType<typeof useStore>;

// Single app-wide store instance. useStore() mounts 6 Firestore listeners and
// reads every listened collection in full on mount — calling the hook from
// several components (Index, FilesView, FileLinksManager…) multiplied those
// listeners and full reads. All components must consume this context instead.
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStoreContext(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStoreContext must be used within StoreProvider');
  return ctx;
}
