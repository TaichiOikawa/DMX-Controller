import { describe, expect, it } from 'vitest';
import {
  copyVisualizerProfile,
  createDefaultVisualizerProfileLibrary,
  deserializeVisualizerProfileLibrary,
  serializeVisualizerProfileLibrary,
} from './visualizerProfiles';

describe('3D Fixture Profile library serialization', () => {
  it('starts with the four planned profiles and round-trips them', () => {
    const library = createDefaultVisualizerProfileLibrary();
    expect(library.profiles).toHaveLength(4);
    expect(deserializeVisualizerProfileLibrary(serializeVisualizerProfileLibrary(library))).toEqual(
      library,
    );
  });

  it('rejects malformed roots and normalizes malformed profiles', () => {
    expect(() => deserializeVisualizerProfileLibrary('{}')).toThrow();
    const library = deserializeVisualizerProfileLibrary(
      JSON.stringify({
        version: 99,
        profiles: [
          {
            id: 'valid',
            name: ' Test ',
            bindings: { red: { resolution: '8bit', coarseOffset: -1 } },
          },
          42,
        ],
      }),
    );
    expect(library.version).toBe(1);
    expect(library.profiles).toHaveLength(1);
    expect(library.profiles[0]).toMatchObject({
      id: 'valid',
      name: 'Test',
      bindings: {},
      strobeSettings: { startValue: 1, maxFrequencyHz: 20 },
    });
  });

  it('copies a profile with a fresh id and independent nested values', () => {
    const source = createDefaultVisualizerProfileLibrary().profiles[3];
    const copy = copyVisualizerProfile(source, ' My Head ');
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe('My Head');
    expect(copy.bindings).toEqual(source.bindings);

    copy.bindings.pan = { resolution: '8bit', coarseOffset: 10 };
    copy.panRangeDeg.min = -180;
    copy.strobeSettings.startValue = 11;
    expect(source.bindings.pan).toEqual({ resolution: '16bit', coarseOffset: 0, fineOffset: 1 });
    expect(source.panRangeDeg.min).toBe(-270);
    expect(source.strobeSettings.startValue).toBe(1);
  });
});
