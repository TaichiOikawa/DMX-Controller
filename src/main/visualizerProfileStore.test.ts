import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultVisualizerProfileLibrary } from '../shared/visualizerProfiles';
import { VisualizerProfileStore } from './visualizerProfileStore';

const tempDirs: string[] = [];

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmx-visualizer-profiles-'));
  tempDirs.push(dir);
  return path.join(dir, 'visualizer-fixture-profiles.json');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('VisualizerProfileStore', () => {
  it('uses the four initial profiles when the file does not exist', () => {
    const store = new VisualizerProfileStore(tempFile());
    expect(store.get().profiles).toHaveLength(4);
  });

  it('persists an edited library and reloads it', () => {
    const filePath = tempFile();
    const store = new VisualizerProfileStore(filePath);
    const library = createDefaultVisualizerProfileLibrary();
    library.profiles[0].name = 'House Dimmer';
    library.profiles.splice(1);
    store.set(library);

    expect(new VisualizerProfileStore(filePath).get().profiles).toHaveLength(1);
    expect(new VisualizerProfileStore(filePath).get().profiles[0].name).toBe('House Dimmer');
  });

  it('recovers to the initial library when the saved file is broken', () => {
    const filePath = tempFile();
    fs.writeFileSync(filePath, '{broken', 'utf-8');
    expect(new VisualizerProfileStore(filePath).get().profiles).toHaveLength(4);
  });

  it('does not share nested state with callers', () => {
    const store = new VisualizerProfileStore(tempFile());
    const first = store.get();
    first.profiles[0].name = 'Mutated';
    first.profiles[0].defaultStaticParameters.red = 0;

    expect(store.get().profiles[0].name).toBe('Dimmer 1ch');
    expect(store.get().profiles[0].defaultStaticParameters.red).toBe(1);
  });
});
