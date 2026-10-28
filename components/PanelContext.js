'use client';

import { createContext, useContext } from 'react';

export const PanelContext = createContext(null);

export function usePanel() {
  return useContext(PanelContext);
}
