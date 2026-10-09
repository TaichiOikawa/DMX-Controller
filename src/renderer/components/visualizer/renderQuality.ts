export type RenderQuality = 'low' | 'medium' | 'high';

export const QUALITY_STORAGE_KEY = 'dmx.visualizer.quality';

export const RENDER_QUALITY: Record<RenderQuality, { dpr: [number, number]; geometryDetail: number; beamSegments: number }> = {
  low: { dpr: [1, 1.75], geometryDetail: 1, beamSegments: 64 },
  medium: { dpr: [1.5, 2.5], geometryDetail: 2, beamSegments: 128 },
  high: { dpr: [2, 3], geometryDetail: 3, beamSegments: 192 },
};

export function normalizeRenderQuality(value: unknown): RenderQuality {
  return value === 'medium' || value === 'high' ? value : 'low';
}

export function loadRenderQuality(): RenderQuality {
  try {
    return normalizeRenderQuality(localStorage.getItem(QUALITY_STORAGE_KEY));
  } catch {
    return 'low';
  }
}

export function saveRenderQuality(quality: RenderQuality): void {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, quality);
  } catch {
    // Storage restrictions must not prevent changing the current render quality.
  }
}
