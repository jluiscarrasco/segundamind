import { useState, useCallback } from 'react';
import type { EntityType } from '@/types';

export interface ContextPanelState {
  isOpen: boolean;
  entityType: EntityType | null;
  entityId: string | null;
}

export function useContextPanel() {
  const [state, setState] = useState<ContextPanelState>({
    isOpen: false,
    entityType: null,
    entityId: null,
  });

  const open = useCallback((entityType: EntityType, entityId: string) => {
    setState({
      isOpen: true,
      entityType,
      entityId,
    });
  }, []);

  const close = useCallback(() => {
    setState({
      isOpen: false,
      entityType: null,
      entityId: null,
    });
  }, []);

  const toggle = useCallback((entityType?: EntityType, entityId?: string) => {
    setState(prev => {
      if (prev.isOpen) {
        return {
          isOpen: false,
          entityType: null,
          entityId: null,
        };
      } else {
        return {
          isOpen: true,
          entityType: entityType || null,
          entityId: entityId || null,
        };
      }
    });
  }, []);

  const setEntity = useCallback((entityType: EntityType, entityId: string) => {
    setState(prev => ({
      ...prev,
      entityType,
      entityId,
      isOpen: true,
    }));
  }, []);

  return {
    ...state,
    open,
    close,
    toggle,
    setEntity,
  };
}
