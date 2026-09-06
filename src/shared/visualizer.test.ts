import { describe, expect, it } from 'vitest';
import {
  createInitialVisualizerProfiles,
  evaluateDmxBinding,
  evaluateVisualizerFixture,
  isVisualizerStartChannelValid,
  maxVisualizerBindingOffset,
} from './visualizer';
import { createDefaultStaticFixtureParameters, type VisualizerFixture } from './types';

describe('3D Fixture parameter evaluation', () => {
  const moving = createInitialVisualizerProfiles()[3];

  it('evaluates 8bit and 16bit bindings from the final output frame', () => {
    const frame = new Array(512).fill(0);
    frame[10] = 128;
    frame[11] = 255;

    expect(evaluateDmxBinding({ resolution: '8bit', coarseOffset: 0 }, 10, frame)).toBeCloseTo(
      128 / 255,
    );
    expect(
      evaluateDmxBinding(
        { resolution: '16bit', coarseOffset: 0, fineOffset: 1 },
        10,
        frame,
      ),
    ).toBeCloseTo((128 * 256 + 255) / 65535);
  });

  it('keeps static values for unassigned parameters and switches assigned parameters to DMX', () => {
    const fixture: VisualizerFixture = {
      id: 'head',
      name: 'Head',
      profileId: moving.id,
      startChannel: 20,
      positionM: { x: 0, y: 4, z: 0 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: {
        dimmer: 0.25,
        red: 0.2,
        green: 0.4,
        blue: 0.6,
        strobe: 0.25,
        pan: 12,
        tilt: 13,
        zoom: 14,
      },
    };
    const frame = new Array(512).fill(0);
    frame[24] = 128;
    frame[25] = 255;
    frame[26] = 128;
    frame[27] = 0;
    frame[28] = 255;

    const state = evaluateVisualizerFixture(moving, fixture, frame);
    expect(state.parameters.dimmer).toBeCloseTo(128 / 255);
    expect(state.parameters.red).toBe(1);
    expect(state.parameters.green).toBeCloseTo(128 / 255);
    expect(state.parameters.blue).toBe(0);
    expect(state.parameters.strobe).toBe(0.25);
    expect(state.parameters.zoom).toBe(45);
  });

  it('keeps values below the Strobe start value steady and uses the configured max frequency', () => {
    const profile = structuredClone(createInitialVisualizerProfiles()[0]);
    profile.bindings.strobe = { resolution: '8bit', coarseOffset: 1 };
    profile.strobeSettings = { startValue: 11, maxFrequencyHz: 10 };
    const fixture: VisualizerFixture = {
      id: 'strobe',
      name: 'Strobe',
      profileId: profile.id,
      startChannel: 0,
      positionM: { x: 0, y: 2, z: 0 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: createDefaultStaticFixtureParameters(),
    };
    const frame = [255, 10];

    expect(evaluateVisualizerFixture(profile, fixture, frame, 0).intensity).toBe(1);
    expect(evaluateVisualizerFixture(profile, fixture, frame, 600).intensity).toBe(1);
    expect(evaluateVisualizerFixture(profile, fixture, frame).parameters.strobe).toBe(0);

    frame[1] = 11;
    expect(evaluateVisualizerFixture(profile, fixture, frame, 600).intensity).toBe(0);
    expect(evaluateVisualizerFixture(profile, fixture, frame).parameters.strobe).toBeGreaterThan(0);

    frame[1] = 255;
    expect(evaluateVisualizerFixture(profile, fixture, frame, 60).intensity).toBe(0);
    expect(evaluateVisualizerFixture(profile, fixture, frame, 110).intensity).toBe(1);
    expect(evaluateVisualizerFixture(profile, fixture, frame).parameters.strobe).toBe(1);
  });

  it('supports reversed physical ranges and falls back to static values when no start channel exists', () => {
    const profile = structuredClone(moving);
    profile.panRangeDeg = { min: 270, max: -270 };
    const fixture: VisualizerFixture = {
      id: 'head',
      name: 'Head',
      profileId: profile.id,
      positionM: { x: 0, y: 0, z: 0 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: { ...createDefaultStaticFixtureParameters(), pan: 42 },
    };

    expect(evaluateVisualizerFixture(profile, fixture, new Array(512).fill(255)).parameters.pan).toBe(
      42,
    );
    fixture.startChannel = 0;
    expect(evaluateVisualizerFixture(profile, fixture, new Array(512).fill(0)).parameters.pan).toBe(
      270,
    );
  });

  it('computes normalized beam color and Dimmer x max(RGB) intensity', () => {
    const profile = createInitialVisualizerProfiles()[2];
    const fixture: VisualizerFixture = {
      id: 'rgb',
      name: 'RGB',
      profileId: profile.id,
      startChannel: 0,
      positionM: { x: 0, y: 0, z: 0 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: createDefaultStaticFixtureParameters(),
    };
    const state = evaluateVisualizerFixture(profile, fixture, [128, 64, 128, 32]);

    expect(state.intensity).toBeCloseTo((128 / 255) * (128 / 255));
    expect(state.color).toEqual({ red: 0.5, green: 1, blue: 0.25 });
  });

  it('accepts the last possible start channel but rejects a one-channel overflow', () => {
    expect(maxVisualizerBindingOffset(moving)).toBe(8);
    expect(isVisualizerStartChannelValid(503, moving)).toBe(true);
    expect(isVisualizerStartChannelValid(504, moving)).toBe(false);
  });

  it('returns the same output for multiple 3D Fixtures sharing profile and channel', () => {
    const profile = createInitialVisualizerProfiles()[0];
    const fixture = (id: string): VisualizerFixture => ({
      id,
      name: id,
      profileId: profile.id,
      startChannel: 100,
      positionM: { x: 0, y: 0, z: 0 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: createDefaultStaticFixtureParameters(),
    });
    const frame = new Array(512).fill(0);
    frame[100] = 200;

    expect(evaluateVisualizerFixture(profile, fixture('a'), frame)).toEqual(
      evaluateVisualizerFixture(profile, fixture('b'), frame),
    );
  });
});

describe('initial 3D Fixture Profiles', () => {
  it('provides the four planned editable templates with independent nested values', () => {
    const profiles = createInitialVisualizerProfiles();
    expect(profiles.map((profile) => profile.name)).toEqual([
      'Dimmer 1ch',
      'RGB 3ch',
      'RGB + Dimmer 4ch',
      'RGB Moving Head 9ch',
    ]);
    profiles[0].defaultStaticParameters.red = 0;
    expect(profiles[1].defaultStaticParameters.red).toBe(1);
  });
});
