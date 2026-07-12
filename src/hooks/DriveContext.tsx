import { createContext, useContext, ReactNode } from 'react';
import { useDrive } from './useDrive';

type Drive = ReturnType<typeof useDrive>;

// Single app-wide drive instance. useDrive() mounts 4 Firestore listeners and
// fully reads user_folders/user_files/user_file_tags/user_file_links on mount.
// LinkedFilesList (inside DetailPanel) and FilesView both called the hook,
// re-subscribing those listeners on every panel open. Consume this instead.
const DriveContext = createContext<Drive | null>(null);

export function DriveProvider({ children }: { children: ReactNode }) {
  const drive = useDrive();
  return <DriveContext.Provider value={drive}>{children}</DriveContext.Provider>;
}

export function useDriveContext(): Drive {
  const ctx = useContext(DriveContext);
  if (!ctx) throw new Error('useDriveContext must be used within DriveProvider');
  return ctx;
}
