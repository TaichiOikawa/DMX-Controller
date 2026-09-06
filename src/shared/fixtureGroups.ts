import { genId, type FixtureGroup, type StageLayout } from './types';

/** Groups are flat and exclusive; groups with fewer than two surviving members dissolve. */
export function normalizeFixtureGroups(raw: unknown, fixtureIds: readonly string[]): FixtureGroup[] {
  if (!Array.isArray(raw)) return [];
  const available = new Set(fixtureIds);
  const used = new Set<string>();
  const groupIds = new Set<string>();
  const groups: FixtureGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || groupIds.has(item.id) || !Array.isArray(item.fixtureIds)) continue;
    const ids = [...new Set<string>(item.fixtureIds.filter((id: unknown): id is string => typeof id === 'string' && available.has(id) && !used.has(id)))];
    if (ids.length < 2) continue;
    groups.push({ id: item.id, name: typeof item.name === 'string' && item.name.trim() ? item.name : 'グループ', fixtureIds: ids });
    groupIds.add(item.id);
    ids.forEach(id => used.add(id));
  }
  return groups;
}

export function groupFixtures(stage: StageLayout, ids: readonly string[]): StageLayout {
  const members = stage.fixtures.filter(fixture => ids.includes(fixture.id)).map(fixture => fixture.id);
  if (members.length < 2) return stage;
  if (stage.groups?.some(group => group.fixtureIds.length === members.length && group.fixtureIds.every(id => members.includes(id)))) return stage;
  let sequence = 1;
  while (stage.groups?.some(group => group.name === `グループ ${sequence}`)) sequence++;
  const remaining = (stage.groups ?? []).map(group => ({ ...group, fixtureIds: group.fixtureIds.filter(id => !members.includes(id)) }));
  return { ...stage, groups: normalizeFixtureGroups([
    ...remaining, { id: genId(), name: `グループ ${sequence}`, fixtureIds: members },
  ], stage.fixtures.map(fixture => fixture.id)) };
}

export function ungroupFixtures(stage: StageLayout, groupId: string): StageLayout {
  if (!stage.groups?.some(group => group.id === groupId)) return stage;
  return { ...stage, groups: stage.groups.filter(group => group.id !== groupId) };
}

export function expandFixtureGroups(stage: StageLayout, ids: readonly string[]): string[] {
  const expanded = new Set(ids);
  for (const group of stage.groups ?? []) {
    if (group.fixtureIds.some(id => expanded.has(id))) group.fixtureIds.forEach(id => expanded.add(id));
  }
  return [...expanded].filter(id => stage.fixtures.some(fixture => fixture.id === id));
}
