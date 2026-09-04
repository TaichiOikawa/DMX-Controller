/** 端末共通の3D Fixture Profileライブラリ用シリアライズとコピー操作。 */

import { normalizeVisualizerProfiles } from './persistence';
import { genId, type VisualizerFixtureProfile } from './types';
import { createInitialVisualizerProfiles } from './visualizer';

export const VISUALIZER_PROFILE_LIBRARY_VERSION = 1;

export interface VisualizerProfileLibrary {
  version: number;
  profiles: VisualizerFixtureProfile[];
}

export function createDefaultVisualizerProfileLibrary(): VisualizerProfileLibrary {
  return {
    version: VISUALIZER_PROFILE_LIBRARY_VERSION,
    profiles: createInitialVisualizerProfiles(),
  };
}

export function serializeVisualizerProfileLibrary(library: VisualizerProfileLibrary): string {
  return JSON.stringify(
    {
      version: VISUALIZER_PROFILE_LIBRARY_VERSION,
      profiles: normalizeVisualizerProfiles(library.profiles),
    },
    null,
    2,
  );
}

export function deserializeVisualizerProfileLibrary(text: string): VisualizerProfileLibrary {
  const raw = JSON.parse(text) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.profiles)) {
    throw new Error('Invalid 3D Fixture Profile library');
  }
  return {
    version: VISUALIZER_PROFILE_LIBRARY_VERSION,
    profiles: normalizeVisualizerProfiles(raw.profiles),
  };
}

/** 共通/Project間のコピー。新しいIDを発行し、ネストした値も共有しない。 */
export function copyVisualizerProfile(
  profile: VisualizerFixtureProfile,
  name = profile.name,
): VisualizerFixtureProfile {
  return {
    ...structuredClone(profile),
    id: genId(),
    name: name.trim() || profile.name,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
