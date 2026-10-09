import { ChevronDown, ChevronRight, Folder, Lightbulb } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import type { StageLayout, VisualizerFixture } from '../../../shared/types';

export function FixtureHierarchy({ stage, selectedIds, onSelect, onSelectFixture, onContextMenu }: {
  stage: StageLayout;
  selectedIds: readonly string[];
  onSelect(ids: string[]): void;
  onSelectFixture(fixtureId: string, visibleIds: string[], event: MouseEvent): void;
  onContextMenu(event: MouseEvent, ids: string[]): void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const groups = (stage.groups ?? []).map(group => ({
    ...group, fixtures: stage.fixtures.filter(fixture => group.fixtureIds.includes(fixture.id)),
  })).filter(group => group.fixtures.length > 0);
  const groupedIds = new Set(groups.flatMap(group => group.fixtureIds));
  const ungrouped = stage.fixtures.filter(fixture => !groupedIds.has(fixture.id));
  const visibleIds = [...groups.flatMap(group => collapsed.has(group.id) ? [] : group.fixtures.map(fixture => fixture.id)), ...ungrouped.map(fixture => fixture.id)];

  const fixtureRow = (fixture: VisualizerFixture) => <li key={fixture.id}>
    <button type="button" title={fixture.name} aria-pressed={selectedIds.includes(fixture.id)}
      onClick={event => onSelectFixture(fixture.id, visibleIds, event)}
      onContextMenu={event => onContextMenu(event, selectedIds.includes(fixture.id) ? [...selectedIds] : [fixture.id])}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${selectedIds.includes(fixture.id) ? 'bg-cyan-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
      <Lightbulb size={13} className="shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{fixture.name}</span>
        {!stage.profiles.some(profile => profile.id === fixture.profileId) && <span className="block text-amber-300">⚠ Profile不明</span>}
      </span>
    </button>
  </li>;

  return <ul aria-label="灯体の階層" className="space-y-0.5">
    {groups.map(group => {
      const expanded = !collapsed.has(group.id);
      const ids = group.fixtures.map(fixture => fixture.id);
      const selected = ids.every(id => selectedIds.includes(id));
      const partial = !selected && ids.some(id => selectedIds.includes(id));
      return <li key={group.id}>
        <div className={`flex items-center rounded ${selected ? 'bg-cyan-800 text-white' : 'bg-slate-900 text-cyan-200'}`}
          onContextMenu={event => onContextMenu(event, ids)}>
          <button type="button" aria-label={`${group.name}を${expanded ? '折りたたむ' : '展開'}`} aria-expanded={expanded}
            onClick={() => setCollapsed(current => {
              const next = new Set(current);
              if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
              return next;
            })}
            className="shrink-0 rounded p-1.5 hover:bg-slate-700">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button type="button" title={group.name} aria-pressed={selected}
            onClick={event => onSelect(event.ctrlKey || event.metaKey
              ? selected ? selectedIds.filter(id => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])]
              : ids)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1.5 pr-2 text-left text-xs hover:bg-slate-700">
            <Folder size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
            {partial && <span title="一部の灯体を選択中" aria-label="一部選択" className="text-cyan-300">−</span>}
            <span className="shrink-0 text-[10px] opacity-70">{ids.length}台</span>
          </button>
        </div>
        {expanded && <ul aria-label={`${group.name}の灯体`} className="ml-3 space-y-0.5 border-l border-slate-700 py-0.5 pl-2">
          {group.fixtures.map(fixtureRow)}
        </ul>}
      </li>;
    })}
    {ungrouped.map(fixtureRow)}
  </ul>;
}
