import { lazy } from 'react';

export const LazyVisualizerApp = lazy(async () => {
  const module = await import('./VisualizerApp');
  return { default: module.VisualizerApp };
});
