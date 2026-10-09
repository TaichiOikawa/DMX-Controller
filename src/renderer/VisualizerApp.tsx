import {
  Box,
  Camera,
  Library,
  Move3D,
  Rotate3D,
  Plus,
  Redo2,
  Settings,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DragEvent,
} from 'react';
import {
  UNIVERSE_SIZE,
  createDefaultStageLayout,
  genId,
  type DmxParameterBinding,
  type Project,
  type StageLayout,
  type VisualizerFixture,
  type VisualizerFixtureProfile,
  type VisualizerParameter,
} from '../shared/types';
import type { EngineStateSnapshot } from '../shared/ipc';
import {
  createInitialVisualizerProfiles,
  evaluateVisualizerFixture,
  isVisualizerStartChannelValid,
  maxVisualizerBindingOffset,
} from '../shared/visualizer';
import {
  addProjectVisualizerProfile,
  addVisualizerFixture,
  deleteProjectVisualizerProfile,
  deleteVisualizerFixture,
  profileUsageCount,
  replaceProjectVisualizerProfile,
} from '../shared/visualizerEditing';
import {
  StageScene,
  FIXTURE_MOVE_SNAP_M,
  FIXTURE_ROTATE_SNAP_DEG,
  type CameraPreset,
  type StageSceneHandle,
} from './components/visualizer/StageScene';
import { NumberField } from './components/visualizer/NumberField';
import { loadRenderQuality, normalizeRenderQuality, saveRenderQuality, type RenderQuality } from './components/visualizer/renderQuality';
import { NumberGestureContext } from './components/visualizer/NumberGestureContext';
import { createStageGesture } from './components/visualizer/stageGesture';
import { duplicateSelectedFixtures, editSelectedFixtureVector, patchSelectedFixtureDmx } from './components/visualizer/multiSelection';
import { ProfileContextMenu } from './components/visualizer/ProfileContextMenu';
import { arrangeSelectedFixtures, selectFixtureFromList, setSelectedFixtureParameter, transformSelectedFixtures } from './components/visualizer/multiSelection';
import { FixtureArrangementMenu } from './components/visualizer/FixtureArrangementMenu';
import { FixtureHierarchy } from './components/visualizer/FixtureHierarchy';
import { expandFixtureGroups, groupFixtures, ungroupFixtures } from '../shared/fixtureGroups';

const PARAMETERS: VisualizerParameter[] = [
  'dimmer',
  'red',
  'green',
  'blue',
  'strobe',
  'pan',
  'tilt',
  'zoom',
];

const PARAMETER_LABELS: Record<VisualizerParameter, string> = {
  dimmer: 'Dimmer',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  strobe: 'Strobe',
  pan: 'Pan',
  tilt: 'Tilt',
  zoom: 'Zoom',
};

const EMPTY_ENGINE_STATE: Pick<
  EngineStateSnapshot,
  'canStageLayoutUndo' | 'canStageLayoutRedo'
> = { canStageLayoutUndo: false, canStageLayoutRedo: false };

export function VisualizerApp() {
  const [project, setProject] = useState<Project | null>(null);
  const [numericGesture] = useState(() => createStageGesture(
    next => setProject(current => current ? { ...current, stageLayout: next } : current),
    next => window.dmx.setStageLayout(next),
  ));
  const [outputFrame, setOutputFrame] = useState<number[]>(() =>
    new Array(UNIVERSE_SIZE).fill(0),
  );
  const [engineState, setEngineState] = useState(EMPTY_ENGINE_STATE);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const selectedFixtureId = selectedFixtureIds[0] ?? null;
  const selectionAnchor = useRef<string | null>(null);
  const [arrangementMenu, setArrangementMenu] = useState<{ x: number; y: number } | null>(null);
  const closeArrangementMenu = useCallback(() => setArrangementMenu(null), []);
  const selectFixtures = useCallback((ids: string[]) => {
    selectionAnchor.current = ids[0] ?? null;
    setSelectedFixtureIds(ids);
  }, []);
  const setSelectedFixtureId = useCallback((id: string | null) => selectFixtures(id ? [id] : []), [selectFixtures]);
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<'fixtures' | 'scene' | null>(null);
  const profileDragType = 'application/x-dmx-project-profile';
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quality, setQuality] = useState(loadRenderQuality);
  const changeQuality = (next: RenderQuality) => {
    setQuality(next);
    saveRenderQuality(next);
  };
  const [workLight, setWorkLight] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');
  const sceneRef = useRef<StageSceneHandle>(null);
  const webgl = useMemo(() => supportsWebGL(), []);

  useEffect(() => {
    window.dmx.beginStageLayoutEdit();
    const offProject = window.dmx.onProject(setProject);
    const offOutput = window.dmx.onOutputFrame(setOutputFrame);
    const offState = window.dmx.onEngineState(setEngineState);
    void window.dmx.getProject().then(setProject);
    void window.dmx.getEngineState().then(setEngineState);
    return () => {
      offProject();
      offOutput();
      offState();
      window.dmx.endStageLayoutEdit();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (isTextInput(event.target)) {
        return;
      } else if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        window.dmx.stageLayoutUndo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        window.dmx.stageLayoutRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const stage = project?.stageLayout ?? createDefaultStageLayout();
  const numberGesture = useMemo(() => ({ begin: () => numericGesture.begin(stage), finish: numericGesture.finish }), [numericGesture, stage]);
  const selectedFixture =
    stage.fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const selectedFixtures = stage.fixtures.filter(fixture => selectedFixtureIds.includes(fixture.id));
  const selectedGroup = stage.groups?.find(group => group.fixtureIds.length === selectedFixtures.length && group.fixtureIds.every(id => selectedFixtureIds.includes(id)));
  const selectSceneFixtures = useCallback((ids: string[]) => selectFixtures(expandFixtureGroups(stage, ids)), [stage, selectFixtures]);
  const selectSceneFixture = useCallback((id: string | null) => selectSceneFixtures(id ? [id] : []), [selectSceneFixtures]);
  const selectedProfile = selectedFixture
    ? stage.profiles.find((profile) => profile.id === selectedFixture.profileId) ?? null
    : null;

  const commitStage = useCallback(
    (next: StageLayout) => {
      if (next === stage) return;
      numericGesture.update(next);
    },
    [stage, numericGesture],
  );

  const mutateFixture = (id: string, mutate: (fixture: VisualizerFixture) => void) => {
    const next = structuredClone(stage);
    const fixture = next.fixtures.find((item) => item.id === id);
    if (!fixture) return;
    mutate(fixture);
    const profile = next.profiles.find((item) => item.id === fixture.profileId);
    if (!profile || !isVisualizerStartChannelValid(fixture.startChannel, profile)) {
      window.alert('開始CHとプロファイルの使用範囲がCH512以内になるよう設定してください。');
      return;
    }
    commitStage(next);
  };

  const toggleGroup = () => commitStage(selectedGroup ? ungroupFixtures(stage, selectedGroup.id) : groupFixtures(stage, selectedFixtureIds));
  const patchSelectedDmx = (patch: { profileId: string } | { startChannel: number | undefined }) => {
    const next = patchSelectedFixtureDmx(stage, selectedFixtureIds, patch);
    if (!next) {
      window.alert('変更できません。選択中の全灯体に有効なProfileを割り当て、使用範囲がCH512以内になるよう設定してください。');
      return;
    }
    commitStage(next);
  };
  const duplicateFixtures = () => {
    const next = duplicateSelectedFixtures(stage, selectedFixtureIds);
    if (next === stage) return;
    commitStage(next);
    selectFixtures(next.fixtures.slice(stage.fixtures.length).map(fixture => fixture.id));
  };

  const addFixture = (profileId: string, position?: VisualizerFixture['positionM']) => {
    if (stage.fixtures.length >= 170) {
      window.alert('3D Fixtureは最大170台です。');
      return;
    }
    const next = addVisualizerFixture(stage, profileId);
    if (next === stage) {
      window.alert('開始CHとプロファイルの使用範囲がCH512以内になるよう設定してください。');
      return;
    }
    const added = next.fixtures.at(-1);
    if (added && position) added.positionM = position;
    commitStage(next);
    setSelectedFixtureId(next.fixtures.at(-1)?.id ?? null);
  };

  const dragOver = (event: DragEvent<HTMLElement>, target: 'fixtures' | 'scene') => {
    if (!event.dataTransfer.types.includes(profileDragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget(target);
  };
  const dragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
  };
  const dropProfile = (event: DragEvent<HTMLElement>, target: 'fixtures' | 'scene') => {
    event.preventDefault();
    event.stopPropagation();
    setDraggedProfileId(null);
    setDropTarget(null);
    const id = event.dataTransfer.getData(profileDragType);
    if (!stage.profiles.some(profile => profile.id === id)) return;
    const position = target === 'scene' ? sceneRef.current?.getDropPosition(event.clientX, event.clientY) : undefined;
    if (target === 'scene' && !position) {
      window.alert('3D画面の配置位置を取得できません。3D FIXTURESの一覧にドロップしてください。');
      return;
    }
    addFixture(id, position ?? undefined);
  };

  const evaluated =
    selectedFixture && selectedProfile
      ? evaluateVisualizerFixture(selectedProfile, selectedFixture, outputFrame)
      : null;

  return (
    <NumberGestureContext.Provider value={numberGesture}>
    <div className="flex h-screen min-h-0 flex-col bg-[#080b12] text-neutral-100">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/90 px-3 py-2">
        <div className="mr-2 flex items-center gap-2 font-semibold text-cyan-300">
          <Box size={18} /> 3D Fixture Visualizer
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton
            onClick={() => window.dmx.stageLayoutUndo()}
            disabled={!engineState.canStageLayoutUndo}
            title="Stage Layoutを元に戻す (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => window.dmx.stageLayoutRedo()}
            disabled={!engineState.canStageLayoutRedo}
            title="Stage Layoutをやり直す (Ctrl+Y)"
          >
            <Redo2 size={14} />
          </ToolbarButton>
          {(['front', 'top', 'perspective', 'fit'] as CameraPreset[]).map((preset) => (
            <ToolbarButton
              key={preset}
              onClick={() => sceneRef.current?.setCameraPreset(preset)}
              title={`カメラ: ${preset}`}
            >
              <Camera size={13} /> {preset}
            </ToolbarButton>
          ))}
          <label className="flex items-center gap-1 px-2 text-xs text-slate-300">
            <input type="checkbox" checked={workLight} onChange={event => setWorkLight(event.target.checked)} />
            作業灯
          </label>
          <label className="flex items-center gap-1 px-2 text-xs text-slate-300">
            <input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)} />
            床グリッド
          </label>
          <label className="flex items-center gap-1 px-2 text-xs text-slate-300"
            title={`3Dハンドルの移動を${FIXTURE_MOVE_SNAP_M}m、回転を${FIXTURE_ROTATE_SNAP_DEG}°刻みにする`}>
            <input type="checkbox" checked={snapEnabled} onChange={event => setSnapEnabled(event.target.checked)} />
            スナップ
          </label>
          <ToolbarButton onClick={() => setSettingsOpen(true)} title="設定（Ctrl+,）">
            <Settings size={13} /> 設定
          </ToolbarButton>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_300px]"
        onPointerDownCapture={event => {
          if (event.button === 2 && selectedFixtureIds.length > 1) event.stopPropagation();
        }}
        onContextMenu={event => {
          if (selectedFixtureIds.length < 2) return;
          event.preventDefault();
          event.stopPropagation();
          setArrangementMenu({ x: event.clientX, y: event.clientY });
        }}>
        <aside aria-label="Profilesと3D FIXTURES" className="grid min-h-0 grid-rows-[minmax(140px,2fr)_minmax(160px,3fr)] border-r border-slate-800 bg-slate-950/70">
          <section aria-label="プロジェクトProfiles" className="flex min-h-0 flex-col border-b border-slate-700 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-slate-400">Profiles ({stage.profiles.length})</h2>
              <button onClick={() => setProfileManagerOpen(true)} className="rounded bg-slate-800 px-2 py-1 text-[11px] hover:bg-slate-700">管理</button>
            </div>
            <p className="mb-2 text-[10px] text-slate-400">下の一覧または3D画面へドラッグして追加</p>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {stage.profiles.map(profile => (
                <button key={profile.id} draggable={stage.fixtures.length < 170}
                  title={`${profile.name}：ドラッグして灯体を追加`}
                  onDragStart={event => {
                    event.dataTransfer.setData(profileDragType, profile.id);
                    event.dataTransfer.effectAllowed = 'copy';
                    setDraggedProfileId(profile.id);
                  }}
                  onDragEnd={() => { setDraggedProfileId(null); setDropTarget(null); }}
                  className="w-full cursor-grab rounded bg-slate-900 px-2 py-2 text-left text-xs text-slate-300 hover:bg-slate-800 active:cursor-grabbing">
                  <span className="block break-words">{profile.name}</span>
                </button>
              ))}
              {stage.profiles.length === 0 && <p className="text-xs text-slate-500">「管理」からテンプレートを選んで作成してください。</p>}
            </div>
          </section>
          <section aria-label="3D FIXTURES一覧"
            onContextMenu={event => {
              event.preventDefault(); event.stopPropagation();
              if (selectedFixtureIds.length) setArrangementMenu({ x: event.clientX, y: event.clientY });
            }}
            onDragOver={event => dragOver(event, 'fixtures')} onDragLeave={dragLeave} onDrop={event => dropProfile(event, 'fixtures')}
            className={`min-h-0 overflow-y-auto p-3 ${dropTarget === 'fixtures' ? 'bg-cyan-950 ring-2 ring-inset ring-cyan-400' : draggedProfileId ? 'bg-cyan-950/30' : ''}`}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            3D Fixtures ({stage.fixtures.length}/170)
          </h2>
          {draggedProfileId && <p className="mb-2 text-xs text-cyan-300">ここにドロップして灯体を追加</p>}
          <div className="space-y-1">
            <FixtureHierarchy stage={stage} selectedIds={selectedFixtureIds} onSelect={selectFixtures}
              onSelectFixture={(id, visibleIds, event) => {
                const next = selectFixtureFromList(visibleIds, selectedFixtureIds, selectionAnchor.current, id,
                  { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
                selectionAnchor.current = next.anchor;
                setSelectedFixtureIds(next.ids);
              }}
              onContextMenu={(event, ids) => {
                event.preventDefault(); event.stopPropagation();
                selectFixtures(ids);
                setArrangementMenu({ x: event.clientX, y: event.clientY });
              }} />
            {stage.fixtures.length === 0 && (
              <p className="rounded border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
                上のProfilesからここへドラッグして灯体を追加してください。
              </p>
            )}
          </div>
          </section>
        </aside>

        <section aria-label="3D画面" className="relative min-h-0 min-w-0"
          onDragOver={event => dragOver(event, 'scene')} onDragLeave={dragLeave} onDrop={event => dropProfile(event, 'scene')}>
          {draggedProfileId && <div className={`pointer-events-none absolute inset-0 z-10 border-2 ${dropTarget === 'scene' ? 'border-cyan-400 bg-cyan-400/5' : 'border-cyan-800/60'}`}>
            <p className="mx-auto mt-3 w-fit rounded bg-slate-950/90 px-3 py-2 text-xs text-cyan-200">ここにドロップして灯体を配置</p>
          </div>}
          {webgl ? (
            <StageScene
              quality={quality}
              ref={sceneRef}
              stage={stage}
              outputFrame={outputFrame}
              selectedFixtureId={selectedFixtureId}
              selectedFixtureIds={selectedFixtureIds}
              onSelectFixtures={selectSceneFixtures}
              onSelectFixture={selectSceneFixture}
              workLight={workLight}
              showGrid={showGrid}
              snapEnabled={snapEnabled}
              transformMode={transformMode}
              onTransformFixture={(id, transform) => commitStage(transformSelectedFixtures(stage, selectedFixtureIds, id, transform))}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-amber-300">
              WebGLを利用できないため3D表示を開始できません。Profile Managerと数値編集は利用できます。
            </div>
          )}
          {selectedFixture && selectedProfile && webgl && (
            <div className="absolute left-3 top-3 rounded-lg border border-slate-700 bg-slate-950/90 p-2 shadow-lg">
              <div className="flex gap-1" role="group" aria-label="フィクスチャの操作">
                {(['translate', 'rotate'] as const).map(mode => (
                  <button key={mode} type="button" aria-pressed={transformMode === mode}
                    onClick={() => setTransformMode(mode)}
                    className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs ${transformMode === mode ? 'bg-cyan-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                    {mode === 'translate' ? <Move3D size={15} /> : <Rotate3D size={15} />}
                    {mode === 'translate' ? '移動' : '回転'}
                  </button>
                ))}
              </div>
              <p className="mt-2 px-1 text-xs text-slate-400">{transformMode === 'translate' ? '矢印をドラッグして移動' : '円をドラッグして回転'} · X: 赤 / Y: 緑 / Z: 青</p>
              {snapEnabled && <p className="mt-1 px-1 text-xs text-cyan-300">スナップ: {transformMode === 'translate' ? `${FIXTURE_MOVE_SNAP_M}m` : `${FIXTURE_ROTATE_SNAP_DEG}°`}</p>}
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-slate-800 bg-slate-950/70 p-3">
          {selectedFixtureIds.length > 1 ? (
            <div className="space-y-3 text-xs">
              <h2 className="font-semibold text-cyan-300">{selectedFixtureIds.length}台を選択中</h2>
              <p className="text-slate-400">操作ハンドルでまとめて移動・回転できます。回転の中心は先頭の灯体です。一覧ではCtrl＋クリックで追加・解除、Shift＋クリックで範囲選択できます。</p>
              <ul className="space-y-1">{stage.fixtures.filter(fixture => selectedFixtureIds.includes(fixture.id)).map(fixture => <li key={fixture.id}>{fixture.name}</li>)}</ul>
              <ToolbarButton onClick={() => setSelectedFixtureId(null)}>選択解除</ToolbarButton>
              <section className="space-y-2" key={`dmx:${selectedFixtureIds.join(',')}`}>
                <h3 className="font-semibold text-slate-300">DMX（一括編集）</h3>
                <label className="block text-slate-400">Profile
                  <select value={selectedFixtures.every(fixture => fixture.profileId === selectedFixture?.profileId) ? selectedFixture?.profileId : ''}
                    onChange={event => patchSelectedDmx({ profileId: event.target.value })}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100">
                    <option value="" disabled>混在</option>
                    {selectedFixture && !stage.profiles.some(profile => profile.id === selectedFixture.profileId) && <option value={selectedFixture.profileId} disabled>参照先なし</option>}
                    {stage.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
                <NumberField immediate integer label="開始CH（空欄=静的）" min={1} max={512} allowEmpty
                  value={selectedFixtures.every(fixture => fixture.startChannel === selectedFixture?.startChannel) && selectedFixture?.startChannel !== undefined ? selectedFixture.startChannel + 1 : ''}
                  placeholder={selectedFixtures.some(fixture => fixture.startChannel !== selectedFixture?.startChannel) ? '混在' : '静的'}
                  scrubValue={(selectedFixture?.startChannel ?? 0) + 1}
                  onCommit={value => patchSelectedDmx({ startChannel: value === '' ? undefined : value - 1 })} />
                <ToolbarButton onClick={() => patchSelectedDmx({ startChannel: undefined })}>全灯体を静的にする</ToolbarButton>
                <p className="text-[10px] text-slate-400">選択した全灯体に同じProfile・開始CHを設定します。値が異なる場合は「混在」と表示します。</p>
              </section>
              <ToolbarButton onClick={toggleGroup}>{selectedGroup ? 'グループ解除' : 'グループ化'}</ToolbarButton>
              {selectedGroup && <label className="block text-slate-400">グループ名
                <input key={selectedGroup.id} value={selectedGroup.name}
                  onChange={event => commitStage({ ...stage, groups: stage.groups?.map(group => group.id === selectedGroup.id ? { ...group, name: event.target.value } : group) })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100" />
              </label>}
              <p className="text-[10px] text-slate-400">グループは一覧または3D上の灯体をクリックしてまとめて選択できます。個別編集は下の灯体一覧から選択します。</p>
              {(['positionM', 'mountRotationDeg'] as const).map(field => <section key={field}>
                <h3 className="mb-2 font-semibold text-slate-300">{field === 'positionM' ? '位置 (m)' : '設置回転 (deg)'}</h3>
                <div className="grid grid-cols-3 gap-1">
                  {(['x', 'y', 'z'] as const).map(axis => {
                    const first = selectedFixture?.[field][axis] ?? 0;
                    const mixed = selectedFixtures.some(fixture => fixture[field][axis] !== first);
                    return <NumberField key={`${field}:${axis}:${selectedFixtureIds.join(',')}`} immediate label={axis.toUpperCase()}
                      value={mixed ? '' : first} placeholder={mixed ? '混在' : undefined} scrubValue={first} step={field === 'positionM' ? 0.1 : 1}
                      onCommit={(value, edit) => { if (value !== '') commitStage(editSelectedFixtureVector(stage, selectedFixtureIds, field, axis, value, edit?.delta)); }} />;
                  })}
                </div>
              </section>)}
              <p className="text-[10px] text-slate-400">直接入力は全灯体に同じ値を設定。長押しドラッグは各灯体の値に同じ差分を加えます。</p>
              <section key={selectedFixtureIds.join(',')}>
                <h3 className="mb-2 font-semibold text-slate-300">静的パラメータ（一括編集）</h3>
                <p className="mb-2 text-[10px] text-slate-400">変更した項目を選択中の全灯体に即時反映します。混在する値の長押し操作は先頭の灯体の値から開始します。</p>
                <div className="grid grid-cols-2 gap-1">
                  {PARAMETERS.map(parameter => {
                    const first = selectedFixture?.staticParameters[parameter] ?? 0;
                    const mixed = selectedFixtures.some(fixture => fixture.staticParameters[parameter] !== first);
                    return <NumberField immediate key={parameter} label={PARAMETER_LABELS[parameter]}
                      value={mixed ? '' : first} placeholder={mixed ? '混在' : undefined} scrubValue={first}
                      step={parameter === 'dimmer' || ['red', 'green', 'blue'].includes(parameter) ? 0.01 : 1}
                      onCommit={(value, edit) => { if (value !== '') commitStage(setSelectedFixtureParameter(stage, selectedFixtureIds, parameter, value, edit?.delta)); }} />;
                  })}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">長押し＋左右ドラッグで変更 · Shiftで微調整。DMXが割り当てられた項目は受信値が優先されます。</p>
              </section>
            </div>
          ) : selectedFixture && selectedProfile ? (
            <FixtureInspector
              key={selectedFixture.id}
              fixture={selectedFixture}
              profile={selectedProfile}
              profiles={stage.profiles}
              evaluated={evaluated!}
              onMutate={(mutate) => mutateFixture(selectedFixture.id, mutate)}
              onDelete={() => {
                commitStage(deleteVisualizerFixture(stage, selectedFixture.id));
                setSelectedFixtureId(null);
              }}
            />
          ) : selectedFixture ? (
            <div className="space-y-3 text-xs">
              <p role="alert" className="rounded border border-amber-700 bg-amber-950/40 p-3 text-amber-200">
                {selectedFixture.name}: Profile「{selectedFixture.profileId}」が見つかりません。誤った照射を避けるため3D表示を停止しています。
              </p>
              <NumberField immediate integer label="開始CH（空欄=静的）" value={selectedFixture.startChannel === undefined ? '' : selectedFixture.startChannel + 1}
                min={1} max={512} allowEmpty
                onCommit={value => commitStage({ ...stage, fixtures: stage.fixtures.map(fixture => fixture.id === selectedFixture.id ? { ...fixture, startChannel: value === '' ? undefined : value - 1 } : fixture) })} />
              <label className="block">再割当Profile
                <select aria-label="再割当Profile" value="" className="mt-1 w-full rounded bg-slate-900 p-2"
                  onChange={event => mutateFixture(selectedFixture.id, fixture => { fixture.profileId = event.target.value; })}>
                  <option value="" disabled>Profileを選択</option>
                  {stage.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
              {stage.profiles.length === 0 && <p>ProfilesからProject Profileを追加してください。</p>}
              <ToolbarButton title="参照切れ灯体を削除" onClick={() => { commitStage(deleteVisualizerFixture(stage, selectedFixture.id)); setSelectedFixtureId(null); }}>灯体を削除</ToolbarButton>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
              3D Fixtureを選択するとInspectorを表示します。
            </div>
          )}
        </aside>
      </main>

      {arrangementMenu && selectedFixtureIds.length > 0 && <FixtureArrangementMenu
        {...arrangementMenu} count={selectedFixtureIds.length} onClose={closeArrangementMenu}
        onDuplicate={duplicateFixtures} canDuplicate={stage.fixtures.length + selectedFixtures.length <= 170 && selectedFixtures.every(fixture => stage.profiles.some(profile => profile.id === fixture.profileId))}
        onGroup={toggleGroup} grouped={!!selectedGroup}
        onArrange={(axis, mode) => commitStage(arrangeSelectedFixtures(stage, selectedFixtureIds, axis, mode))}
      />}

      {profileManagerOpen && (
        <ProfileManager
          stage={stage}
          onClose={() => setProfileManagerOpen(false)}
          onCommitStage={commitStage}
        />
      )}
      <StageSettingsModal
        quality={quality}
        onQualityChange={changeQuality}
        open={settingsOpen}
        stage={stage}
        onClose={() => setSettingsOpen(false)}
        onCommit={commitStage}
      />
    </div>
    </NumberGestureContext.Provider>
  );
}

function StageSettingsModal({
  quality,
  onQualityChange,
  open,
  stage,
  onClose,
  onCommit,
}: {
  quality: RenderQuality;
  onQualityChange(quality: RenderQuality): void;
  open: boolean;
  stage: StageLayout;
  onClose(): void;
  onCommit(stage: StageLayout): void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex h-[34rem] max-h-[88vh] w-[48rem] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-sky-400">設定</h2>
          <button
            onClick={onClose}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            閉じる
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-40 shrink-0 space-y-1 border-r border-neutral-800 bg-neutral-950/40 p-2">
            <button className="flex w-full items-center gap-2 rounded bg-neutral-800 px-2.5 py-1.5 text-left text-xs font-semibold text-sky-300">
              <Box size={13} className="shrink-0" />
              表示・配置
            </button>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            <div className="space-y-3">
              <div className="space-y-2 border-b border-neutral-700 pb-4">
                <label className="block text-xs font-semibold text-neutral-200">
                  映像品質
                  <select aria-label="映像品質" value={quality}
                    onChange={event => onQualityChange(normalizeRenderQuality(event.target.value))}
                    className="mt-2 block w-full rounded bg-neutral-800 px-3 py-2 text-xs">
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                  </select>
                </label>
                <p className="text-[11px] text-neutral-400">
                  {quality === 'low' ? '従来の画質。描画負荷を抑えます。' : quality === 'medium' ? '滑らかな輪郭に加え、照射の濃淡・距離減衰・柔らかな影と空気中の散乱を表現します。' : '高解像度で光の中心から周辺への拡散を細かく表現し、影のサンプル数を増やします。GPU負荷が高くなります。'}
                  変更は即時反映され、この端末に保存されます。
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-neutral-200">Stage Layout</h3>
                <p className="mt-1 text-[11px] text-neutral-500">
                  舞台の幅、奥行、高さをメートル単位で設定します。
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(['widthM', 'depthM', 'heightM'] as const).map((key) => (
                  <NumberField
                    key={key}
                    label={key === 'widthM' ? '幅 (m)' : key === 'depthM' ? '奥行 (m)' : '高さ (m)'}
                    value={stage[key]}
                    min={0.1}
                    step={0.1}
                    onCommit={(value) => onCommit({ ...stage, [key]: value })}
                  />
                ))}
              </div>
              <div className="space-y-3 border-t border-neutral-700 pt-3">
                <h3 className="text-xs font-semibold">壁・幕・平台・遮蔽物</h3>
                <p className="text-[11px] text-neutral-400">直方体の中心位置と寸法を指定します。薄い形状は不透明な幕や壁、低い形状は平台になります（最大64個）。</p>
                <ToolbarButton title="遮蔽物を追加" disabled={(stage.obstacles?.length ?? 0) >= 64}
                  onClick={() => onCommit({ ...stage, obstacles: [...(stage.obstacles ?? []), { id: genId(), name: `遮蔽物 ${(stage.obstacles?.length ?? 0) + 1}`, positionM: { x: 0, y: 0.5, z: stage.depthM / 2 }, sizeM: { x: 2, y: 1, z: 2 } }] })}>
                  <Plus size={13} /> 遮蔽物を追加
                </ToolbarButton>
                {(stage.obstacles ?? []).map(obstacle => {
                  const update = (next: typeof obstacle) => onCommit({ ...stage, obstacles: stage.obstacles!.map(item => item.id === next.id ? next : item) });
                  return <div key={obstacle.id} className="space-y-2 rounded border border-neutral-700 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="min-w-0 flex-1 text-xs">名前
                        <input aria-label="遮蔽物の名前" defaultValue={obstacle.name} key={obstacle.name}
                          onBlur={event => { const name = event.target.value.trim(); if (name && name !== obstacle.name) update({ ...obstacle, name }); }}
                          className="mt-1 w-full rounded bg-neutral-800 px-2 py-1" />
                      </label>
                      <ToolbarButton title={`${obstacle.name}を削除`} onClick={() => onCommit({ ...stage, obstacles: stage.obstacles!.filter(item => item.id !== obstacle.id) })}><Trash2 size={13} /></ToolbarButton>
                    </div>
                    {(['positionM', 'sizeM'] as const).map(group => <div key={group}>
                      <div className="mb-1 text-xs text-neutral-400">{group === 'positionM' ? '中心位置 (m)' : '寸法 (m)'}</div>
                      <div className="grid grid-cols-3 gap-2">{(['x', 'y', 'z'] as const).map(axis => <NumberField key={axis}
                        label={`${group === 'positionM' ? '中心' : '寸法'} ${axis.toUpperCase()}`} value={obstacle[group][axis]}
                        min={group === 'sizeM' ? 0.01 : undefined} max={group === 'sizeM' ? 1000 : undefined} step={0.1}
                        onCommit={value => update({ ...obstacle, [group]: { ...obstacle[group], [axis]: value } })} />)}</div>
                    </div>)}
                  </div>;
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FixtureInspector({
  fixture,
  profile,
  profiles,
  evaluated,
  onMutate,
  onDelete,
}: {
  fixture: VisualizerFixture;
  profile: VisualizerFixtureProfile;
  profiles: VisualizerFixtureProfile[];
  evaluated: ReturnType<typeof evaluateVisualizerFixture>;
  onMutate(mutate: (fixture: VisualizerFixture) => void): void;
  onDelete(): void;
}) {
  const usedChannels = Object.entries(profile.bindings)
    .flatMap(([parameter, binding]) => {
      if (fixture.startChannel === undefined) return [];
      const channels = [fixture.startChannel + binding.coarseOffset + 1];
      if (binding.resolution === '16bit') channels.push(fixture.startChannel + binding.fineOffset + 1);
      return [`${PARAMETER_LABELS[parameter as VisualizerParameter]}: CH ${channels.join('/')}`];
    })
    .join(', ');

  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-2">
        <h2 className="font-semibold text-cyan-300">Fixture Inspector</h2>
        <label className="block text-slate-400">名前<input value={fixture.name}
          onChange={event => onMutate(f => { f.name = event.target.value; })}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100" /></label>
        <label className="block text-slate-400">
          Profile
          <select
            value={fixture.profileId}
            onChange={(event) =>
              onMutate((f) => {
                f.profileId = event.target.value;
              })
            }
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
          >
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          immediate
          integer
          label="開始CH（空欄=静的）"
          value={fixture.startChannel === undefined ? '' : fixture.startChannel + 1}
          min={1}
          max={512 - Math.max(0, maxVisualizerBindingOffset(profile))}
          onCommit={(value) => onMutate((f) => (f.startChannel = value === '' ? undefined : value - 1))}
          allowEmpty
        />
      </section>

      <VectorFields label="位置 (m)" value={fixture.positionM} onCommit={(key, value) => onMutate((f) => (f.positionM[key] = value))} />
      <VectorFields label="設置回転 (deg)" value={fixture.mountRotationDeg} onCommit={(key, value) => onMutate((f) => (f.mountRotationDeg[key] = value))} />

      <section>
        <h3 className="mb-2 font-semibold text-slate-300">静的パラメータ</h3>
        <div className="grid grid-cols-2 gap-1">
          {PARAMETERS.map((parameter) => (
            <NumberField
              immediate
              key={parameter}
              label={PARAMETER_LABELS[parameter]}
              value={fixture.staticParameters[parameter]}
              step={parameter === 'dimmer' || ['red', 'green', 'blue'].includes(parameter) ? 0.01 : 1}
              onCommit={(value) => onMutate((f) => (f.staticParameters[parameter] = Number(value)))}
            />
          ))}
        </div>
      </section>

      <section className="rounded bg-slate-900 p-2 text-[11px] text-slate-400">
        <div className="mb-1 font-semibold text-slate-300">使用CH</div>
        <div>{usedChannels || 'DMX未割当（静的値）'}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-2 font-mono">
          {PARAMETERS.map((parameter) => (
            <div key={parameter}>
              {PARAMETER_LABELS[parameter]}: {evaluated.parameters[parameter].toFixed(3)}
            </div>
          ))}
        </div>
      </section>
      <button onClick={onDelete} className="flex w-full items-center justify-center gap-1 rounded bg-red-950 px-2 py-1.5 text-red-300 hover:bg-red-900">
        <Trash2 size={13} /> 3D Fixtureを削除
      </button>
    </div>
  );
}

function ProfileManager({
  stage,
  onClose,
  onCommitStage,
}: {
  stage: StageLayout;
  onClose(): void;
  onCommitStage(stage: StageLayout): void;
}) {
  type Action = (stage: StageLayout) => void;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [templates] = useState(createInitialVisualizerProfiles);
  const [creation, setCreation] = useState<{ templateId: string; name: string } | null>(null);
  const [draft, setDraft] = useState<VisualizerFixtureProfile | null>(() =>
    stage.profiles[0] ? structuredClone(stage.profiles[0]) : null,
  );
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(stage.profiles[0] ?? null));
  const [pending, setPending] = useState<{ action: Action } | null>(null);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== savedDraft;

  const select = (profile: VisualizerFixtureProfile | null) => {
    setDraft(profile ? structuredClone(profile) : null);
    setSavedDraft(JSON.stringify(profile));
  };

  const run = (action: Action, save = false) => {
    setError('');
    try {
      let next = stage;
      if (save && draft) {
        next = replaceProjectVisualizerProfile(stage, draft);
        if (next === stage) throw new Error('この変更では使用中灯体のDMX範囲がCH512を超えるか、保存先のプロファイルが存在しません。');
        onCommitStage(next);
        setSavedDraft(JSON.stringify(draft));
      }
      action(next);
      setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存に失敗しました。もう一度お試しください。');
    }
  };

  const request = (action: Action) => {
    if (pending) return;
    setError('');
    if (dirty) setPending({ action });
    else run(action);
  };

  const uniqueName = (name: string, profiles = stage.profiles) => {
    const names = new Set(profiles.map(profile => profile.name));
    let result = name;
    let suffix = 2;
    while (names.has(result)) result = `${name} (${suffix++})`;
    return result;
  };

  const openCreation = () => {
    setError('');
    setCreation({ templateId: templates[0].id, name: uniqueName(templates[0].name) });
  };

  const create = () => {
    if (!creation?.name.trim()) return;
    const template = templates.find(profile => profile.id === creation.templateId);
    request(current => {
      const next = addProjectVisualizerProfile(current, template, uniqueName(creation.name.trim(), current.profiles));
      onCommitStage(next);
      select(next.profiles.at(-1) ?? null);
      setCreation(null);
    });
  };

  const remove = () => {
    if (!draft || !window.confirm(`「${draft.name}」を削除しますか？`)) return;
    request(current => {
      const next = deleteProjectVisualizerProfile(current, draft.id);
      onCommitStage(next);
      select(next.profiles[0] ?? null);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div role="dialog" aria-modal="true" aria-label="Profile Manager" className="relative flex h-[min(860px,94vh)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
        <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <Library size={17} className="text-cyan-300" />
          <h2 className="font-semibold">Profile Manager</h2>
          <button disabled={!!pending || !!creation} onClick={() => request(() => onClose())} className="ml-auto rounded bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700">閉じる</button>
        </header>
        {error && !pending && !creation && <p role="alert" className="bg-red-950 px-4 py-2 text-sm text-red-200">{error}</p>}
        <fieldset disabled={!!pending || !!creation} className="min-h-0 min-w-0 flex-1 overflow-x-auto">
          <div className="grid h-full min-w-[700px] grid-cols-[minmax(460px,2.4fr)_minmax(220px,1fr)]">
            <section aria-label="プロファイル編集" className="flex min-h-0 min-w-0 flex-col">
              {draft ? (
                <>
                  <div className="border-b border-slate-800 px-4 py-3 text-xs">
                    <span className="text-cyan-300">編集・保存先：プロジェクトプロファイル</span>
                    <span role="status" className="ml-3 text-amber-300">{dirty ? '未保存の変更あり' : '保存済み'}</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <ProfileEditor key={draft.id} profile={draft} onChange={setDraft} />
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-slate-800 p-3">
                    <button disabled={!dirty} onClick={() => run(() => {}, true)} className="rounded bg-cyan-700 px-3 py-1.5 text-xs hover:bg-cyan-600 disabled:opacity-40">プロジェクトプロファイルに保存</button>
                    <button disabled={profileUsageCount(stage, draft.id) > 0} onClick={remove} className="rounded bg-red-950 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-40">削除</button>
                  </div>
                </>
              ) : <div className="flex h-full items-center justify-center p-4 text-sm text-slate-500">右の一覧から選択、またはテンプレートから作成してください。</div>}
            </section>
            <aside aria-label="プロジェクトプロファイル一覧" className="flex min-h-0 min-w-0 flex-col border-l border-slate-800 p-3">
              <h3 className="mb-2 text-sm font-semibold">プロジェクトプロファイル</h3>
              <p className="mb-3 text-[11px] text-slate-400">テンプレートから新しいプロファイルを作成</p>
              <button onClick={openCreation} className="mb-3 flex items-center justify-center gap-1 rounded bg-cyan-800 px-2 py-1.5 text-xs hover:bg-cyan-700">
                <Plus size={12} /> 作成
              </button>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {stage.profiles.map(profile => (
                  <button
                    key={profile.id}
                    onContextMenu={event => {
                      event.preventDefault(); event.stopPropagation();
                      setContextMenu({ x: event.clientX, y: event.clientY, id: profile.id });
                    }}
                    onClick={() => {
                      if (draft?.id === profile.id) return;
                      request(current => select(current.profiles.find(item => item.id === profile.id) ?? null));
                    }}
                    aria-pressed={draft?.id === profile.id}
                    title={profile.name}
                    className={`w-full rounded px-2 py-2 text-left text-xs ${draft?.id === profile.id ? 'bg-cyan-800' : 'bg-slate-900 hover:bg-slate-800'}`}
                  >
                    <div className="break-words">{profile.name}</div>
                    <div className="mt-1 text-[10px] text-slate-400">使用中 {profileUsageCount(stage, profile.id)} 台</div>
                  </button>
                ))}
                {stage.profiles.length === 0 && <p className="py-6 text-center text-xs text-slate-500">プロファイルがありません。</p>}
              </div>
            </aside>
          </div>
        </fieldset>
        {contextMenu && <ProfileContextMenu {...contextMenu} onClose={closeContextMenu} onDuplicate={() => {
          const id = contextMenu.id;
          request(current => {
            const profile = current.profiles.find(item => item.id === id);
            if (!profile) return;
            const next = addProjectVisualizerProfile(current, profile, uniqueName(profile.name, current.profiles));
            onCommitStage(next);
            select(next.profiles.at(-1) ?? null);
          });
        }} />}
        {creation && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="profile-create-title" className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-xl">
              <h3 id="profile-create-title" className="mb-4 font-semibold">テンプレートから作成</h3>
              <fieldset disabled={!!pending} className="space-y-4 text-sm">
                <label className="block text-slate-300">
                  テンプレート
                  <select autoFocus value={creation.templateId} onChange={event => {
                    const templateId = event.target.value;
                    const template = templates.find(profile => profile.id === templateId);
                    setCreation({ templateId, name: uniqueName(template?.name ?? 'New 3D Fixture Profile') });
                  }} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-slate-100">
                    {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                    <option value="blank">空のプロファイル（DMX未割当）</option>
                  </select>
                </label>
                <label className="block text-slate-300">
                  プロファイル名
                  <input value={creation.name} onChange={event => setCreation({ ...creation, name: event.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-slate-100" />
                </label>
                <p className="text-xs text-slate-400">選んだテンプレートの設定をコピーして追加します。作成後に自由に編集できます。</p>
                {error && !pending && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="flex gap-2 text-xs">
                  <button disabled={!creation.name.trim()} onClick={create} className="rounded bg-cyan-700 px-3 py-2 hover:bg-cyan-600 disabled:opacity-40">作成して編集</button>
                  <button onClick={() => { setCreation(null); setError(''); }} className="rounded border border-slate-600 px-3 py-2 hover:bg-slate-800">キャンセル</button>
                </div>
              </fieldset>
            </div>
          </div>
        )}
        {pending && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 p-4">
            <div role="alertdialog" aria-modal="true" aria-labelledby="profile-unsaved-title" aria-describedby="profile-unsaved-description" className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-xl">
              <h3 id="profile-unsaved-title" className="font-semibold">未保存の変更があります</h3>
              <p id="profile-unsaved-description" className="my-3 text-sm text-slate-300">「{draft?.name}」の変更をプロジェクトプロファイルに保存して続行しますか？</p>
              {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
              <div className="flex flex-wrap gap-2 text-xs">
                <button onClick={() => run(pending.action, true)} className="rounded bg-cyan-700 px-3 py-2">保存して続行</button>
                <button onClick={() => run(pending.action)} className="rounded bg-slate-700 px-3 py-2">破棄して続行</button>
                <button autoFocus onClick={() => { setPending(null); setError(''); }} className="rounded border border-slate-600 px-3 py-2">キャンセル</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileEditor({ profile, onChange }: { profile: VisualizerFixtureProfile; onChange(profile: VisualizerFixtureProfile): void }) {
  const patch = (mutate: (next: VisualizerFixtureProfile) => void) => {
    const next = structuredClone(profile);
    mutate(next);
    onChange(next);
  };
  return (
    <div className="space-y-4 text-xs">
      <TextField label="Profile名" value={profile.name} onCommit={(name) => patch((next) => (next.name = name))} />
      <div>
        <h3 className="mb-2 font-semibold text-slate-300">DMX Parameter Bindings（Slotは1-based）</h3>
        <div className="grid grid-cols-[90px_100px_90px_90px] gap-1 text-slate-400">
          <span>Parameter</span><span>解像度</span><span>Coarse</span><span>Fine</span>
          {PARAMETERS.map((parameter) => {
            const binding = profile.bindings[parameter];
            return (
              <BindingRow key={parameter} parameter={parameter} binding={binding} onChange={(value) => patch((next) => {
                if (value) next.bindings[parameter] = value;
                else delete next.bindings[parameter];
              })} />
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(['panRangeDeg', 'tiltRangeDeg', 'zoomRangeDeg'] as const).map((key) => (
          <div key={key} className="rounded bg-slate-900 p-2">
            <h3 className="mb-2 font-semibold text-slate-300">{key.replace('RangeDeg', '')} 範囲</h3>
            <div className="grid grid-cols-2 gap-1">
              <NumberField label="Min" value={profile[key].min} onCommit={(value) => patch((next) => (next[key].min = Number(value)))} />
              <NumberField label="Max" value={profile[key].max} onCommit={(value) => patch((next) => (next[key].max = Number(value)))} />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded bg-slate-900 p-2">
        <h3 className="mb-1 font-semibold text-slate-300">Strobe設定</h3>
        <p className="mb-2 text-[10px] text-slate-500">
          開始値未満のDMX値は常時点灯。開始値から255までを1Hz〜最大周波数へ割り当てます。
        </p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="開始値 (DMX)"
            value={profile.strobeSettings.startValue}
            onCommit={(value) =>
              patch(
                (next) =>
                  (next.strobeSettings.startValue = Math.min(
                    255,
                    Math.max(0, Math.round(Number(value))),
                  )),
              )
            }
          />
          <NumberField
            label="最大周波数 (Hz)"
            value={profile.strobeSettings.maxFrequencyHz}
            onCommit={(value) =>
              patch(
                (next) =>
                  (next.strobeSettings.maxFrequencyHz = Math.max(1, Number(value))),
              )
            }
          />
        </div>
      </div>
      <div>
        <h3 className="mb-2 font-semibold text-slate-300">静的初期値</h3>
        <div className="grid grid-cols-4 gap-1">
          {PARAMETERS.map((parameter) => (
            <NumberField key={parameter} label={PARAMETER_LABELS[parameter]} value={profile.defaultStaticParameters[parameter]} onCommit={(value) => patch((next) => (next.defaultStaticParameters[parameter] = Number(value)))} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BindingRow({ parameter, binding, onChange }: { parameter: VisualizerParameter; binding: DmxParameterBinding | undefined; onChange(binding: DmxParameterBinding | undefined): void }) {
  return (
    <>
      <span className="self-center text-slate-300">{PARAMETER_LABELS[parameter]}</span>
      <select
        value={binding?.resolution ?? 'none'}
        onChange={(event) => {
          if (event.target.value === 'none') onChange(undefined);
          else if (event.target.value === '8bit') onChange({ resolution: '8bit', coarseOffset: binding?.coarseOffset ?? 0 });
          else onChange({ resolution: '16bit', coarseOffset: binding?.coarseOffset ?? 0, fineOffset: binding?.resolution === '16bit' ? binding.fineOffset : 1 });
        }}
        className="rounded border border-slate-700 bg-slate-900 px-1 py-1 text-slate-100"
      >
        <option value="none">未割当</option><option value="8bit">8bit</option><option value="16bit">16bit</option>
      </select>
      <NumberField value={binding ? binding.coarseOffset + 1 : ''} min={1} max={512} disabled={!binding} onCommit={(value) => binding && onChange({ ...binding, coarseOffset: Number(value) - 1 })} />
      <NumberField value={binding?.resolution === '16bit' ? binding.fineOffset + 1 : ''} min={1} max={512} disabled={binding?.resolution !== '16bit'} onCommit={(value) => binding?.resolution === '16bit' && onChange({ ...binding, fineOffset: Number(value) - 1 })} />
    </>
  );
}

function VectorFields({ label, value, onCommit }: { label: string; value: { x: number; y: number; z: number }; onCommit(key: 'x' | 'y' | 'z', value: number): void }) {
  return <section><h3 className="mb-2 font-semibold text-slate-300">{label}</h3><div className="grid grid-cols-3 gap-1">{(['x', 'y', 'z'] as const).map((key) => <NumberField immediate key={key} label={key.toUpperCase()} value={value[key]} step={0.1} onCommit={(next) => onCommit(key, Number(next))} />)}</div></section>;
}

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit(value: string): void }) {
  return <label className="block text-slate-400">{label}<input key={value} defaultValue={value} onBlur={(event) => event.currentTarget.value.trim() && onCommit(event.currentTarget.value.trim())} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100" /></label>;
}

function ToolbarButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-35">{children}</button>;
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}
