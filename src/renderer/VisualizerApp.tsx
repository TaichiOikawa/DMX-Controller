import {
  Box,
  Camera,
  Copy,
  Library,
  Plus,
  Redo2,
  Settings2,
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
} from 'react';
import {
  UNIVERSE_SIZE,
  createDefaultStageLayout,
  type DmxParameterBinding,
  type Project,
  type StageLayout,
  type VisualizerFixture,
  type VisualizerFixtureProfile,
  type VisualizerParameter,
} from '../shared/types';
import type { EngineStateSnapshot } from '../shared/ipc';
import type { VisualizerProfileLibrary } from '../shared/visualizerProfiles';
import { copyVisualizerProfile } from '../shared/visualizerProfiles';
import {
  evaluateVisualizerFixture,
  isVisualizerStartChannelValid,
} from '../shared/visualizer';
import {
  addProjectVisualizerProfile,
  addVisualizerFixture,
  deleteProjectVisualizerProfile,
  deleteVisualizerFixture,
  duplicateVisualizerFixture,
  profileUsageCount,
  replaceProjectVisualizerProfile,
} from '../shared/visualizerEditing';
import {
  StageScene,
  type CameraPreset,
  type StageSceneHandle,
} from './components/visualizer/StageScene';

const PARAMETERS: VisualizerParameter[] = [
  'dimmer',
  'red',
  'green',
  'blue',
  'pan',
  'tilt',
  'zoom',
];

const PARAMETER_LABELS: Record<VisualizerParameter, string> = {
  dimmer: 'Dimmer',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
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
  const [outputFrame, setOutputFrame] = useState<number[]>(() =>
    new Array(UNIVERSE_SIZE).fill(0),
  );
  const [engineState, setEngineState] = useState(EMPTY_ENGINE_STATE);
  const [library, setLibrary] = useState<VisualizerProfileLibrary | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [createProfileId, setCreateProfileId] = useState('');
  const [createChannel, setCreateChannel] = useState('1');
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const sceneRef = useRef<StageSceneHandle>(null);
  const webgl = useMemo(() => supportsWebGL(), []);

  useEffect(() => {
    window.dmx.beginStageLayoutEdit();
    const offProject = window.dmx.onProject(setProject);
    const offOutput = window.dmx.onOutputFrame(setOutputFrame);
    const offState = window.dmx.onEngineState(setEngineState);
    void window.dmx.getProject().then(setProject);
    void window.dmx.getEngineState().then(setEngineState);
    void window.dmx.getVisualizerProfileLibrary().then(setLibrary);
    return () => {
      offProject();
      offOutput();
      offState();
      window.dmx.endStageLayoutEdit();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTextInput(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
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
  const selectedFixture =
    stage.fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const selectedProfile = selectedFixture
    ? stage.profiles.find((profile) => profile.id === selectedFixture.profileId) ?? null
    : null;

  const effectiveCreateProfileId = createProfileId || stage.profiles[0]?.id || '';

  const commitStage = useCallback(
    (next: StageLayout) => {
      if (next === stage) return;
      setProject((current) => (current ? { ...current, stageLayout: next } : current));
      window.dmx.setStageLayout(next);
    },
    [stage],
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

  const addFixture = () => {
    if (stage.fixtures.length >= 170) {
      window.alert('3D Fixtureは最大170台です。');
      return;
    }
    const uiChannel = createChannel.trim() ? Number(createChannel) - 1 : undefined;
    const next = addVisualizerFixture(stage, effectiveCreateProfileId, uiChannel);
    if (next === stage) {
      window.alert('開始CHとプロファイルの使用範囲がCH512以内になるよう設定してください。');
      return;
    }
    commitStage(next);
    setSelectedFixtureId(next.fixtures.at(-1)?.id ?? null);
  };

  const evaluated =
    selectedFixture && selectedProfile
      ? evaluateVisualizerFixture(selectedProfile, selectedFixture, outputFrame)
      : null;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#080b12] text-neutral-100">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/90 px-3 py-2">
        <div className="mr-2 flex items-center gap-2 font-semibold text-cyan-300">
          <Box size={18} /> 3D Fixture Visualizer
        </div>
        <select
          value={effectiveCreateProfileId}
          onChange={(event) => setCreateProfileId(event.target.value)}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
        >
          {stage.profiles.length === 0 && <option value="">Project Profileなし</option>}
          {stage.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          開始CH
          <input
            value={createChannel}
            onChange={(event) => setCreateChannel(event.target.value)}
            className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-slate-100"
            placeholder="静的"
          />
        </label>
        <ToolbarButton onClick={addFixture} disabled={!effectiveCreateProfileId} title="3D灯体を作成">
          <Plus size={14} /> 追加
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            if (!selectedFixture) return;
            if (stage.fixtures.length >= 170) {
              window.alert('3D Fixtureは最大170台です。');
              return;
            }
            const next = duplicateVisualizerFixture(stage, selectedFixture.id);
            commitStage(next);
            setSelectedFixtureId(next.fixtures.at(-1)?.id ?? null);
          }}
          disabled={!selectedFixture}
          title="選択中の3D灯体を複製"
        >
          <Copy size={14} /> 複製
        </ToolbarButton>
        <ToolbarButton onClick={() => setProfileManagerOpen(true)} title="Profile Manager">
          <Library size={14} /> Profiles
        </ToolbarButton>
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
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_300px]">
        <aside className="min-h-0 overflow-y-auto border-r border-slate-800 bg-slate-950/70 p-3">
          <StageDimensions stage={stage} commit={commitStage} />
          <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
            3D Fixtures ({stage.fixtures.length}/170)
          </h2>
          <div className="space-y-1">
            {stage.fixtures.map((fixture) => (
              <button
                key={fixture.id}
                onClick={() => setSelectedFixtureId(fixture.id)}
                className={`w-full truncate rounded px-2 py-1.5 text-left text-xs ${
                  fixture.id === selectedFixtureId
                    ? 'bg-cyan-700 text-white'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {fixture.name}
              </button>
            ))}
            {stage.fixtures.length === 0 && (
              <p className="rounded border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
                Project Profileを用意して灯体を追加してください。
              </p>
            )}
          </div>
        </aside>

        <section className="relative min-h-0 min-w-0">
          {webgl ? (
            <StageScene
              ref={sceneRef}
              stage={stage}
              outputFrame={outputFrame}
              selectedFixtureId={selectedFixtureId}
              onSelectFixture={setSelectedFixtureId}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-amber-300">
              WebGLを利用できないため3D表示を開始できません。Profile Managerと数値編集は利用できます。
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-slate-800 bg-slate-950/70 p-3">
          {selectedFixture && selectedProfile ? (
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
          ) : (
            <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
              3D Fixtureを選択するとInspectorを表示します。
            </div>
          )}
        </aside>
      </main>

      {profileManagerOpen && library && (
        <ProfileManager
          stage={stage}
          library={library}
          onClose={() => setProfileManagerOpen(false)}
          onCommitStage={commitStage}
          onSaveLibrary={async (next) => {
            const saved = await window.dmx.setVisualizerProfileLibrary(next);
            setLibrary(saved);
          }}
        />
      )}
    </div>
  );
}

function StageDimensions({ stage, commit }: { stage: StageLayout; commit(stage: StageLayout): void }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Settings2 size={13} /> Stage (m)
      </h2>
      <div className="grid grid-cols-3 gap-1">
        {(['widthM', 'depthM', 'heightM'] as const).map((key) => (
          <NumberField
            key={key}
            label={key === 'widthM' ? '幅' : key === 'depthM' ? '奥行' : '高さ'}
            value={stage[key]}
            min={0.1}
            step={0.1}
            onCommit={(value) => commit({ ...stage, [key]: value })}
          />
        ))}
      </div>
    </section>
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
        <TextField label="名前" value={fixture.name} onCommit={(name) => onMutate((f) => (f.name = name))} />
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
          label="開始CH（空欄=静的）"
          value={fixture.startChannel === undefined ? '' : fixture.startChannel + 1}
          min={1}
          max={512}
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
  library,
  onClose,
  onCommitStage,
  onSaveLibrary,
}: {
  stage: StageLayout;
  library: VisualizerProfileLibrary;
  onClose(): void;
  onCommitStage(stage: StageLayout): void;
  onSaveLibrary(library: VisualizerProfileLibrary): Promise<void>;
}) {
  const [tab, setTab] = useState<'common' | 'project'>('project');
  const profiles = tab === 'common' ? library.profiles : stage.profiles;
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? '');
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? null;
  const [draft, setDraft] = useState<VisualizerFixtureProfile | null>(() =>
    selected ? structuredClone(selected) : null,
  );

  const saveDraft = async () => {
    if (!draft) return;
    if (tab === 'common') {
      await onSaveLibrary({
        ...library,
        profiles: library.profiles.map((profile) => (profile.id === draft.id ? draft : profile)),
      });
    } else {
      const next = replaceProjectVisualizerProfile(stage, draft);
      if (next === stage) {
        window.alert('この変更では使用中灯体のDMX範囲がCH512を超えます。');
      } else onCommitStage(next);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex h-[min(760px,92vh)] w-[min(1050px,94vw)] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
        <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <Library size={17} className="text-cyan-300" />
          <h2 className="font-semibold">Profile Manager</h2>
          <div className="ml-4 flex rounded bg-slate-900 p-0.5 text-xs">
            {(['common', 'project'] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setTab(value);
                  const nextProfiles = value === 'common' ? library.profiles : stage.profiles;
                  const next = nextProfiles[0] ?? null;
                  setSelectedId(next?.id ?? '');
                  setDraft(next ? structuredClone(next) : null);
                }}
                className={`rounded px-3 py-1 ${tab === value ? 'bg-cyan-700 text-white' : 'text-slate-400'}`}
              >
                {value === 'common' ? '共通ライブラリ' : 'Project'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="ml-auto rounded bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700">閉じる</button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr]">
          <aside className="overflow-y-auto border-r border-slate-800 p-3">
            <div className="mb-2 flex gap-1">
              <button
                onClick={() => {
                  if (tab === 'project') {
                    const next = addProjectVisualizerProfile(stage);
                    onCommitStage(next);
                    const added = next.profiles.at(-1) ?? null;
                    setSelectedId(added?.id ?? '');
                    setDraft(added ? structuredClone(added) : null);
                  } else {
                    const base = stage.profiles[0] ?? library.profiles[0];
                    if (!base) return;
                    const copy = copyVisualizerProfile(base, 'New 3D Fixture Profile');
                    void onSaveLibrary({ ...library, profiles: [...library.profiles, copy] });
                    setSelectedId(copy.id);
                    setDraft(structuredClone(copy));
                  }
                }}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-cyan-800 px-2 py-1 text-xs hover:bg-cyan-700"
              >
                <Plus size={12} /> 作成
              </button>
            </div>
            <div className="space-y-1">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => {
                    setSelectedId(profile.id);
                    setDraft(structuredClone(profile));
                  }}
                  className={`w-full rounded px-2 py-2 text-left text-xs ${selected?.id === profile.id ? 'bg-cyan-800' : 'bg-slate-900 hover:bg-slate-800'}`}
                >
                  <div className="truncate">{profile.name}</div>
                  {tab === 'project' && <div className="text-[10px] text-slate-500">使用中 {profileUsageCount(stage, profile.id)} 台</div>}
                </button>
              ))}
            </div>
          </aside>
          <section className="min-h-0 overflow-y-auto p-4">
            {draft ? (
              <>
                <ProfileEditor profile={draft} onChange={setDraft} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => void saveDraft()} className="rounded bg-cyan-700 px-3 py-1.5 text-xs hover:bg-cyan-600">変更を保存</button>
                  {tab === 'common' ? (
                    <>
                      <button
                        onClick={() => onCommitStage(addProjectVisualizerProfile(stage, draft, draft.name))}
                        className="rounded bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700"
                      >
                        Projectへコピー
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm(`共通プロファイル「${draft.name}」を削除しますか？`)) return;
                          const nextProfiles = library.profiles.filter((p) => p.id !== draft.id);
                          const nextSelected = nextProfiles[0] ?? null;
                          setSelectedId(nextSelected?.id ?? null);
                          setDraft(nextSelected ? structuredClone(nextSelected) : null);
                          void onSaveLibrary({ ...library, profiles: nextProfiles });
                        }}
                        className="rounded bg-red-950 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900"
                      >
                        削除
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          const name = window.prompt('共通ライブラリでの別名', `${draft.name} Copy`);
                          if (!name) return;
                          const copy = copyVisualizerProfile(draft, name);
                          void onSaveLibrary({ ...library, profiles: [...library.profiles, copy] });
                        }}
                        className="rounded bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700"
                      >
                        共通へ別名で保存
                      </button>
                      <button
                        disabled={profileUsageCount(stage, draft.id) > 0}
                        onClick={() => {
                          const nextStage = deleteProjectVisualizerProfile(stage, draft.id);
                          const nextSelected = nextStage.profiles[0] ?? null;
                          onCommitStage(nextStage);
                          setSelectedId(nextSelected?.id ?? null);
                          setDraft(nextSelected ? structuredClone(nextSelected) : null);
                        }}
                        className="rounded bg-red-950 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        削除
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">プロファイルがありません。</div>
            )}
          </section>
        </div>
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
  return <section><h3 className="mb-2 font-semibold text-slate-300">{label}</h3><div className="grid grid-cols-3 gap-1">{(['x', 'y', 'z'] as const).map((key) => <NumberField key={key} label={key.toUpperCase()} value={value[key]} step={0.1} onCommit={(next) => onCommit(key, Number(next))} />)}</div></section>;
}

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit(value: string): void }) {
  return <label className="block text-slate-400">{label}<input key={value} defaultValue={value} onBlur={(event) => event.currentTarget.value.trim() && onCommit(event.currentTarget.value.trim())} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100" /></label>;
}

function NumberField({ label, value, onCommit, min, max, step = 1, allowEmpty = false, disabled = false }: { label?: string; value: number | ''; onCommit(value: number | ''): void; min?: number; max?: number; step?: number; allowEmpty?: boolean; disabled?: boolean }) {
  const commit = (element: HTMLInputElement) => {
    const draft = element.value;
    if (allowEmpty && draft.trim() === '') return onCommit('');
    const number = Number(draft);
    if (!Number.isFinite(number)) {
      element.value = String(value);
      return;
    }
    onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number)));
  };
  const input = <input key={String(value)} type="number" defaultValue={String(value)} min={min} max={max} step={step} disabled={disabled} onBlur={(event) => commit(event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-slate-100 disabled:opacity-40" />;
  return label ? <label className="block text-slate-400">{label}{input}</label> : input;
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
