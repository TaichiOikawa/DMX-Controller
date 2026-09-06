/** Stage Layoutの不変更新。UI操作を1つの確定済み履歴単位へ変換する。 */

import {
  createDefaultStrobeSettings,
  createDefaultStaticFixtureParameters,
  genId,
  type StageLayout,
  type VisualizerFixture,
  type VisualizerFixtureProfile,
} from './types';
import { isVisualizerStartChannelValid } from './visualizer';
import { normalizeFixtureGroups } from './fixtureGroups';

export function addVisualizerFixture(
  stage: StageLayout,
  profileId: string,
  startChannel?: number,
): StageLayout {
  const profile = stage.profiles.find((item) => item.id === profileId);
  if (!profile || !isVisualizerStartChannelValid(startChannel, profile)) return stage;
  const fixture: VisualizerFixture = {
    id: genId(),
    name: nextFixtureName(stage, profile.name),
    profileId,
    positionM: { x: 0, y: Math.min(stage.heightM, 4), z: 0 },
    mountRotationDeg: { x: 0, y: 0, z: 0 },
    staticParameters: structuredClone(profile.defaultStaticParameters),
  };
  if (startChannel !== undefined) fixture.startChannel = startChannel;
  return { ...stage, fixtures: [...stage.fixtures, fixture] };
}

export function duplicateVisualizerFixture(stage: StageLayout, fixtureId: string): StageLayout {
  const source = stage.fixtures.find((item) => item.id === fixtureId);
  if (!source) return stage;
  const profile = stage.profiles.find((item) => item.id === source.profileId);
  if (!profile) return stage;
  const copy = structuredClone(source);
  copy.id = genId();
  copy.name = nextFixtureName(stage, profile.name);
  copy.positionM.x += 0.5;
  return { ...stage, fixtures: [...stage.fixtures, copy] };
}

export function deleteVisualizerFixture(stage: StageLayout, fixtureId: string): StageLayout {
  const fixtures = stage.fixtures.filter((item) => item.id !== fixtureId);
  return fixtures.length === stage.fixtures.length ? stage : { ...stage, fixtures,
    ...(stage.groups ? { groups: normalizeFixtureGroups(stage.groups, fixtures.map(fixture => fixture.id)) } : {}),
  };
}

export function profileUsageCount(stage: StageLayout, profileId: string): number {
  return stage.fixtures.filter((fixture) => fixture.profileId === profileId).length;
}

export function addProjectVisualizerProfile(
  stage: StageLayout,
  source?: VisualizerFixtureProfile,
  name?: string,
): StageLayout {
  const profile: VisualizerFixtureProfile = source
    ? structuredClone(source)
    : {
        id: '',
        name: 'New 3D Fixture Profile',
        bindings: {},
        panRangeDeg: { min: -270, max: 270 },
        tiltRangeDeg: { min: -135, max: 135 },
        zoomRangeDeg: { min: 5, max: 45 },
        strobeSettings: createDefaultStrobeSettings(),
        defaultStaticParameters: createDefaultStaticFixtureParameters(),
      };
  profile.id = genId();
  if (name?.trim()) profile.name = name.trim();
  return { ...stage, profiles: [...stage.profiles, profile] };
}

/** 使用中、または既存灯体の開始CHを範囲外にする変更は拒否して元の参照を返す。 */
export function replaceProjectVisualizerProfile(
  stage: StageLayout,
  profile: VisualizerFixtureProfile,
): StageLayout {
  const index = stage.profiles.findIndex((item) => item.id === profile.id);
  if (index < 0) return stage;
  const used = stage.fixtures.filter((fixture) => fixture.profileId === profile.id);
  if (used.some((fixture) => !isVisualizerStartChannelValid(fixture.startChannel, profile))) {
    return stage;
  }
  const profiles = stage.profiles.slice();
  profiles[index] = structuredClone(profile);
  return { ...stage, profiles };
}

export function deleteProjectVisualizerProfile(stage: StageLayout, profileId: string): StageLayout {
  if (profileUsageCount(stage, profileId) > 0) return stage;
  const profiles = stage.profiles.filter((profile) => profile.id !== profileId);
  return profiles.length === stage.profiles.length ? stage : { ...stage, profiles };
}

function nextFixtureName(stage: StageLayout, profileName: string): string {
  const prefix = `${profileName} #`;
  const used = new Set(
    stage.fixtures
      .map((fixture) => (fixture.name.startsWith(prefix) ? Number(fixture.name.slice(prefix.length)) : 0))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return `${prefix}${sequence}`;
}
