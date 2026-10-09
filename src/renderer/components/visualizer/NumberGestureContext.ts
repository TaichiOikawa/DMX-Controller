import { createContext } from 'react';

export const NumberGestureContext = createContext<{ begin(): void; finish(): void } | null>(null);
