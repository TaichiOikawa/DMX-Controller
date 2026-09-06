import type { StageLayout } from '../../../shared/types';

export function renderableFixtures(stage: StageLayout) {
  const profileIds = new Set(stage.profiles.map(profile => profile.id));
  return stage.fixtures.filter(fixture => profileIds.has(fixture.profileId)).slice(0, 170);
}

interface FixturePointerEvent {
  instanceId?: number;
  stopPropagation(): void;
}

export function createFixturePointerDownHandler(
  fixtures: readonly { id: string }[],
  onSelectFixture: (id: string) => void,
) {
  return (event: FixturePointerEvent) => {
    event.stopPropagation();
    if (event.instanceId === undefined) return;
    const fixture = fixtures[event.instanceId];
    if (fixture) onSelectFixture(fixture.id);
  };
}
