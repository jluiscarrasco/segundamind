import { useState, useCallback } from 'react';

export interface CommandPaletteState {
  isOpen: boolean;
  searchQuery: string;
  selectedIndex: number;
}

export function useCommandPalette() {
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    searchQuery: '',
    selectedIndex: 0,
  });

  const open = useCallback(() => {
    setState(prev => ({
      ...prev,
      isOpen: true,
      searchQuery: '',
      selectedIndex: 0,
    }));
  }, []);

  const close = useCallback(() => {
    setState(prev => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  const toggle = useCallback(() => {
    setState(prev => ({
      ...prev,
      isOpen: !prev.isOpen,
      ...(prev.isOpen ? {} : { searchQuery: '', selectedIndex: 0 }),
    }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState(prev => ({
      ...prev,
      searchQuery: query,
      selectedIndex: 0, // Reset selection when query changes
    }));
  }, []);

  const setSelectedIndex = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      selectedIndex: index,
    }));
  }, []);

  const moveSelection = useCallback((direction: 'up' | 'down', itemCount: number) => {
    setState(prev => {
      let newIndex = prev.selectedIndex;
      if (direction === 'down') {
        newIndex = (newIndex + 1) % itemCount;
      } else {
        newIndex = (newIndex - 1 + itemCount) % itemCount;
      }
      return {
        ...prev,
        selectedIndex: newIndex,
      };
    });
  }, []);

  return {
    ...state,
    open,
    close,
    toggle,
    setSearchQuery,
    setSelectedIndex,
    moveSelection,
  };
}
