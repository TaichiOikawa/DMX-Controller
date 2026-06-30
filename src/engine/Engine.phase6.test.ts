import { describe, it, expect } from 'vitest';
import { Engine } from './Engine';
import {
  createDefaultProject,
  type ActionButton,
  type Cue,
  type Project,
  type SequenceEntry,
} from '../shared/types';

function cue(id: string, values: Record<number, number>, fadeInMs = 0): Cue {
  return { id, values, fadeInMs };
}
const cueEntry = (c: Cue): SequenceEntry => ({ kind: 'cue', cue: c });

function projectWithSequence(sequence: SequenceEntry[]): Project {
  const p = createDefaultProject();
  p.shows = [{ id: 'show1', name: 'Show 1', sequence }];
  return p;
}

function makeEngine() {
  const clock = { now: 0 };
  const engine = new Engine({ send: () => {}, nowFn: () => clock.now });
  return { engine, clock };
}

describe('busking / release (§6.1/6.2)', () => {
  it('a touched fader busks and overrides the cue in show mode (can go below)', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }))]));
    engine.loadShow('show1');
    engine.setMode('show'); // busking-on-touch は Show モードの挙動
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200);

    engine.setFader(0, 50); // busking, below cue
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);
  });

  it('releaseCapture returns the channel to the cue value', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }))]));
    engine.loadShow('show1');
    engine.setMode('show');
    engine.go();
    engine.setFader(0, 50);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);

    engine.releaseCapture([0]);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200); // back to cue (faderLive ignored)
  });

  it('GO releases busking for channels the new cue specifies (§6.2)', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([cueEntry(cue('c0', { 0: 100 })), cueEntry(cue('c1', { 0: 200 }))]),
    );
    engine.loadShow('show1');
    engine.setMode('show');
    engine.go();
    engine.setFader(0, 50);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);

    engine.go(); // cue1 includes ch0 -> busking released
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200);
  });

  it('addCue inserts an empty cue and selects it; edits write into it (incl zeros)', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.loadShow('show1');
    engine.addCue('show1'); // 空 CUE を追加 + 自動選択
    const empty = engine.getProject().shows[0].sequence[0];
    expect(empty.kind).toBe('cue');
    if (empty.kind === 'cue') expect(empty.cue.values).toEqual({});
    expect(engine.getState().playback?.mainIndex).toBe(0); // 自動選択された

    // EDIT × CUE 選択中: フェーダー操作が選択 CUE へリアルタイム書き込み。
    engine.setFader(5, 0);
    engine.setFader(6, 100);
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values).toEqual({ 5: 0, 6: 100 });
  });
});

describe('channel / bank labels', () => {
  it('sets, clears, and undoes a channel label', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));

    engine.setChannelLabel(0, 'Front R');
    expect(engine.getProject().channelLabels).toEqual({ 0: 'Front R' });

    engine.setBankLabel(2, 'バック列');
    expect(engine.getProject().bankLabels).toEqual({ 2: 'バック列' });

    engine.setChannelLabel(0, ''); // 空で削除
    expect(engine.getProject().channelLabels).toEqual({});

    engine.undo(); // 削除を取り消す
    expect(engine.getProject().channelLabels).toEqual({ 0: 'Front R' });
  });

  it('is blocked in show mode', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.setMode('show');
    engine.setChannelLabel(0, 'nope');
    expect(engine.getProject().channelLabels).toBeUndefined();
  });
});

describe('RGB fixtures', () => {
  it('adds, updates, deletes, and undoes fixtures', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));

    engine.addFixture({ name: 'Par L', r: 0, g: 1, b: 2 });
    const fixtures = engine.getProject().fixtures;
    expect(fixtures).toHaveLength(1);
    expect(fixtures?.[0]).toMatchObject({ name: 'Par L', r: 0, g: 1, b: 2 });
    const id = fixtures![0].id;

    engine.updateFixture(id, { g: 5, name: 'Par R' });
    expect(engine.getProject().fixtures?.[0]).toMatchObject({ name: 'Par R', r: 0, g: 5, b: 2 });

    engine.deleteFixture(id);
    expect(engine.getProject().fixtures).toBeUndefined();

    engine.undo(); // 削除を取り消す
    expect(engine.getProject().fixtures).toHaveLength(1);
  });

  it('is blocked in show mode', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.setMode('show');
    engine.addFixture({ r: 0, g: 1, b: 2 });
    expect(engine.getProject().fixtures).toBeUndefined();
  });
});

describe('holdFade', () => {
  it('freezes the running fade at its current value', () => {
    const { engine, clock } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }, 1000))]));
    engine.loadShow('show1');

    clock.now = 0;
    engine.go(); // 0 -> 200 over 1000ms
    engine.tick(0);
    clock.now = 500;
    engine.tick(500);
    expect(engine.getOutput()[0]).toBe(100); // halfway

    engine.holdFade();
    clock.now = 2000;
    engine.tick(2000);
    expect(engine.getOutput()[0]).toBe(100); // held, did not complete to 200
    expect(engine.getState().playback?.fading).toBe(false);
  });
});

describe('undo / redo', () => {
  it('reverts and reapplies an addCue', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.loadShow('show1');
    expect(engine.getState().canUndo).toBe(false);

    engine.addCue('show1');
    expect(engine.getProject().shows[0].sequence).toHaveLength(1);
    expect(engine.getState().canUndo).toBe(true);

    engine.undo();
    expect(engine.getProject().shows[0].sequence).toHaveLength(0);
    expect(engine.getState().canRedo).toBe(true);

    engine.redo();
    expect(engine.getProject().shows[0].sequence).toHaveLength(1);
  });

  it('reverts a cue rename', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.updateCue('c1', { name: 'before' });
    engine.updateCue('c1', { name: 'after' });

    engine.undo();
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.name).toBe('before');
  });

  it('is blocked in show mode', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.addCue('show1');
    engine.setMode('show');
    engine.undo();
    expect(engine.getProject().shows[0].sequence).toHaveLength(1); // 変化なし
  });

  it('clears history when a project is loaded', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.addCue('show1');
    expect(engine.getState().canUndo).toBe(true);

    engine.loadProject(projectWithSequence([]));
    expect(engine.getState().canUndo).toBe(false);
  });
});

describe('updateCue name / lyrics', () => {
  it('updateCue sets name and lyrics on the cue', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }))]));
    engine.updateCue('c1', { name: 'サビ赤', lyrics: '君の名を呼ぶ' });
    const entry = engine.getProject().shows[0].sequence[0];
    expect(entry.kind).toBe('cue');
    if (entry.kind === 'cue') {
      expect(entry.cue.name).toBe('サビ赤');
      expect(entry.cue.lyrics).toBe('君の名を呼ぶ');
    }
  });
});

describe('renameShow', () => {
  it('renames a show, falls back to a default for blank, and undoes', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    expect(engine.getProject().shows[0].name).toBe('Show 1');

    engine.renameShow('show1', '本番A');
    expect(engine.getProject().shows[0].name).toBe('本番A');

    engine.renameShow('show1', '   '); // 空 -> 既定名へ
    expect(engine.getProject().shows[0].name).toBe('Show 1');

    engine.undo(); // 既定名化を取り消す
    expect(engine.getProject().shows[0].name).toBe('本番A');
  });

  it('is blocked in show mode', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.setMode('show');
    engine.renameShow('show1', 'nope');
    expect(engine.getProject().shows[0].name).toBe('Show 1');
  });
});

describe('deleteCueChannel', () => {
  it('removes a channel from the current cue and drops it live; undo restores', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200, 1: 100 }))]));
    engine.loadShow('show1');
    engine.go(); // current = c1
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200);

    engine.deleteCueChannel('c1', 0);
    engine.tick(0);
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values).toEqual({ 1: 100 });
    expect(engine.getOutput()[0]).toBe(0); // 削除 ch は 0 へフォールバック
    expect(engine.getOutput()[1]).toBe(100); // 他 ch は不変

    engine.undo();
    const e2 = engine.getProject().shows[0].sequence[0];
    if (e2.kind === 'cue') expect(e2.cue.values).toEqual({ 0: 200, 1: 100 });
  });

  it('is a no-op for an absent channel and blocked in show mode', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }))]));
    engine.deleteCueChannel('c1', 5); // 存在しない ch -> 何もしない
    expect(engine.getState().canUndo).toBe(false);

    engine.setMode('show');
    engine.deleteCueChannel('c1', 0); // show モードは編集不可
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values).toEqual({ 0: 200 });
  });
});

describe('GROUP auto-follow (Delay)', () => {
  function child(id: string, v: number, followMs?: number): Cue {
    const c: Cue = { id, values: { 0: v }, fadeInMs: 0 };
    if (followMs !== undefined) c.followMs = followMs;
    return c;
  }
  function groupEntry(id: string, cues: Cue[], loop = false): SequenceEntry {
    return { kind: 'group', group: { id, name: id, cues, loop } };
  }

  it('auto-advances through group children by followMs in show mode', () => {
    const { engine, clock } = makeEngine();
    engine.loadProject(
      projectWithSequence([
        groupEntry('g', [child('c1', 10, 1000), child('c2', 20, 1000), child('c3', 30)]),
      ]),
    );
    engine.loadShow('show1');
    engine.setMode('show');
    clock.now = 0;
    engine.go(); // GROUP に入る -> c1 (sub 0)
    engine.tick(0);
    expect(engine.getState().playback?.subIndex).toBe(0);
    expect(engine.getOutput()[0]).toBe(10);

    clock.now = 1000;
    engine.tick(1000); // c1 の followMs 経過 -> c2 へ自動送り
    expect(engine.getState().playback?.subIndex).toBe(1);
    expect(engine.getOutput()[0]).toBe(20);

    clock.now = 2000;
    engine.tick(2000); // c2 -> c3
    expect(engine.getState().playback?.subIndex).toBe(2);
    expect(engine.getOutput()[0]).toBe(30);

    clock.now = 9000;
    engine.tick(9000); // c3 は followMs 無し -> 末尾で停止
    expect(engine.getState().playback?.subIndex).toBe(2);
  });

  it('does not auto-advance in edit mode', () => {
    const { engine, clock } = makeEngine();
    engine.loadProject(projectWithSequence([groupEntry('g', [child('c1', 10, 500), child('c2', 20)])]));
    engine.loadShow('show1'); // 既定 edit モード
    clock.now = 0;
    engine.go();
    engine.tick(0);
    clock.now = 2000;
    engine.tick(2000);
    expect(engine.getState().playback?.subIndex).toBe(0); // 進まない
  });

  it('loops back to the first child at the end when loop is on', () => {
    const { engine, clock } = makeEngine();
    engine.loadProject(
      projectWithSequence([groupEntry('g', [child('c1', 10, 1000), child('c2', 20, 1000)], true)]),
    );
    engine.loadShow('show1');
    engine.setMode('show');
    clock.now = 0;
    engine.go();
    engine.tick(0);

    clock.now = 1000;
    engine.tick(1000); // c1 -> c2
    expect(engine.getState().playback?.subIndex).toBe(1);

    clock.now = 2000;
    engine.tick(2000); // c2 末尾 & loop -> c1 へ戻る
    expect(engine.getState().playback?.subIndex).toBe(0);
    expect(engine.getOutput()[0]).toBe(10);
  });

  it('updateCue sets and clears followMs', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([groupEntry('g', [child('c1', 10)])]));
    engine.updateCue('c1', { followMs: 1500 });
    let g = engine.getProject().shows[0].sequence[0];
    if (g.kind === 'group') expect(g.group.cues[0].followMs).toBe(1500);

    engine.updateCue('c1', { followMs: null }); // OFF
    g = engine.getProject().shows[0].sequence[0];
    if (g.kind === 'group') expect(g.group.cues[0].followMs).toBeUndefined();
  });
});

describe('deselectCue', () => {
  it('returns the playhead to un-started and drops show output', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }))]));
    engine.loadShow('show1');
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200);
    expect(engine.getState().playback?.mainIndex).toBe(0);

    engine.deselectCue();
    engine.tick(0);
    expect(engine.getState().playback?.mainIndex).toBe(-1); // 未 GO へ
    expect(engine.getOutput()[0]).toBe(0); // show 層は非アクティブ
  });
});

function actionButton(values: Record<number, number>): ActionButton {
  return { id: 'act', name: 'A', steps: [{ values, fadeInMs: 0, holdMs: 1000 }] };
}

describe('Action 発火（look を programmer へ取り込んで保持）', () => {
  it('actionDown は look をフェーダーへ確定し、解除されず保持される（オーバーライドではない）', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([]);
    p.actions = [actionButton({ 0: 255 })];
    engine.loadProject(p);
    engine.actionDown('act');
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(255);
    expect(engine.getProject().faders[0]).toBe(255);

    engine.tick(1000); // 時間が経っても解除されず保持される。
    expect(engine.getOutput()[0]).toBe(255);
  });

  it('SHOW モードでは busking で CUE を上書きして保持する', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c1', { 0: 100 }))]);
    p.actions = [actionButton({ 0: 255 })];
    engine.loadProject(p);
    engine.loadShow('show1');
    engine.setMode('show');
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(100); // cue

    engine.actionDown('act');
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(255); // フェーダー(busking)が cue を上書きして保持
    expect(engine.getState().busking[0]).toBe(true);

    engine.tick(1000);
    expect(engine.getOutput()[0]).toBe(255); // 保持し続ける
  });

  it('actionDown with fadeMs fades the look in over time (no show)', () => {
    const { engine, clock } = makeEngine();
    const p = projectWithSequence([]);
    p.actions = [actionButton({ 0: 200 })];
    engine.loadProject(p);
    clock.now = 0;
    engine.actionDown('act', 1000); // 0 -> 200 over 1000ms
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(0); // 起点（現在出力）

    clock.now = 500;
    engine.tick(500);
    expect(engine.getOutput()[0]).toBe(100); // 中間

    clock.now = 1000;
    engine.tick(1000);
    expect(engine.getOutput()[0]).toBe(200); // 完了して保持
    clock.now = 2000;
    engine.tick(2000);
    expect(engine.getOutput()[0]).toBe(200);
  });

  it('fade crossfades from the current cue value in SHOW (busking)', () => {
    const { engine, clock } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c1', { 0: 100 }))]);
    p.actions = [actionButton({ 0: 200 })];
    engine.loadProject(p);
    engine.loadShow('show1');
    engine.setMode('show');
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(100); // cue

    clock.now = 0;
    engine.actionDown('act', 1000);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(100); // 現在の cue 値を起点に開始（段差なし）

    clock.now = 500;
    engine.tick(500);
    expect(engine.getOutput()[0]).toBe(150); // 100 -> 200 の中間

    clock.now = 1000;
    engine.tick(1000);
    expect(engine.getOutput()[0]).toBe(200);
    expect(engine.getState().busking[0]).toBe(true);
  });
});

describe('Action authoring (global / overwrite)', () => {
  it('addAction creates an empty, selected Action; faders then write its look (no show)', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([])); // 未 loadShow（解放中）
    engine.addAction('A1');
    const id = engine.getProject().actions[0].id;
    expect(engine.getProject().actions[0].steps[0].values).toEqual({}); // 空 look
    expect(engine.getState().editingActionId).toBe(id); // 追加と同時に編集対象へ

    // CUE 編集と同じく、フェーダー操作が選択中 Action の look へ書き込まれる。
    engine.setFader(0, 100);
    engine.setFader(5, 200);
    expect(engine.getProject().actions[0].steps[0].values).toEqual({ 0: 100, 5: 200 });

    // 0 にするとその ch は look から外れる。
    engine.setFader(0, 0);
    expect(engine.getProject().actions[0].steps[0].values).toEqual({ 5: 200 });
  });

  it('selecting a cue deselects the editing Action (faders go back to the cue)', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 10 }))]));
    engine.loadShow('show1');
    engine.addAction('A1');
    expect(engine.getState().editingActionId).not.toBeNull();
    engine.goTo(0, 0); // CUE 選択
    expect(engine.getState().editingActionId).toBeNull();

    // フェーダーは Action ではなく CUE へ書き込まれる。
    engine.setFader(3, 77);
    expect(engine.getProject().actions[0].steps[0].values).toEqual({}); // Action は不変
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values[3]).toBe(77);
  });

  it('deleting the editing Action clears the selection', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.addAction('A1');
    const id = engine.getProject().actions[0].id;
    engine.deleteAction(id);
    expect(engine.getState().editingActionId).toBeNull();
  });

  it('captureAction loads the look into faders + busking (show loaded) and deselects the cue', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c1', { 0: 100 }))]);
    p.actions = [actionButton({ 5: 200 })];
    engine.loadProject(p);
    engine.loadShow('show1');
    engine.goTo(0, 0); // CUE 選択
    engine.captureAction('act');
    expect(engine.getState().playback?.mainIndex).toBe(-1); // CUE 選択解除
    expect(engine.getProject().faders[5]).toBe(200); // programmer へ取り込み
    expect(engine.getState().busking[5]).toBe(true); // busking で保持
  });

  it('captureAction without a show writes faders only (no busking)', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([]);
    p.actions = [actionButton({ 3: 150 })];
    engine.loadProject(p);
    engine.captureAction('act');
    expect(engine.getProject().faders[3]).toBe(150);
    expect(engine.getState().busking[3]).toBe(false);
  });

  it('overwriteAction re-captures faders into step 0, even in SHOW mode', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([]);
    p.actions = [actionButton({ 0: 50 })];
    engine.loadProject(p);
    engine.loadShow('show1');
    engine.setMode('show'); // SHOW 中でも上書きできる
    engine.setFader(3, 200);
    engine.overwriteAction('act');
    expect(engine.getProject().actions[0].steps[0].values).toEqual({ 3: 200 });
  });

  it('overwriteAction creates step 0 for an action with no steps', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([]);
    p.actions = [{ id: 'act', name: 'A', steps: [] }];
    engine.loadProject(p);
    engine.setFader(1, 80);
    engine.overwriteAction('act');
    expect(engine.getProject().actions[0].steps).toHaveLength(1);
    expect(engine.getProject().actions[0].steps[0].values).toEqual({ 1: 80 });
  });
});

describe('Timeline auto-GO (§5.5, internal timecode)', () => {
  it('fires GO when the playhead crosses points', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c0', { 0: 10 })), cueEntry(cue('c1', { 0: 20 }))]);
    p.shows[0].timeline = {
      points: [
        { timecodeMs: 1000, type: 'go' },
        { timecodeMs: 2000, type: 'go' },
      ],
    };
    engine.loadProject(p);
    engine.loadShow('show1');

    engine.reportAudioPlayhead(500);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(0); // not started

    engine.reportAudioPlayhead(1000); // cross point 0 -> GO -> cue0
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);

    engine.reportAudioPlayhead(2500); // cross point 1 -> GO -> cue1
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(20);
  });

  it('jumps to a linked cue (goTo) instead of sequential GO', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([
      cueEntry(cue('c0', { 0: 10 })),
      cueEntry(cue('c1', { 0: 20 })),
      cueEntry(cue('c2', { 0: 30 })),
    ]);
    // 1点目で c2 へ直接頭出し（順送りなら c0 のはず）。
    p.shows[0].timeline = { points: [{ timecodeMs: 1000, type: 'go', cueId: 'c2' }] };
    engine.loadProject(p);
    engine.loadShow('show1');

    engine.reportAudioPlayhead(1000); // cross -> goTo c2
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(30);
    expect(engine.getState().playback?.mainIndex).toBe(2);
  });

  it('falls back to sequential GO when the linked cue was deleted', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c0', { 0: 10 }))]);
    p.shows[0].timeline = { points: [{ timecodeMs: 1000, type: 'go', cueId: 'missing' }] };
    engine.loadProject(p);
    engine.loadShow('show1');

    engine.reportAudioPlayhead(1000); // cueId 不在 -> 順送り go() -> c0
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);
  });

  it('setTimelinePointCue links and unlinks a point', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c0', { 0: 10 }))]);
    p.shows[0].timeline = { points: [{ timecodeMs: 1000, type: 'go' }] };
    engine.loadProject(p);

    engine.setTimelinePointCue('show1', 0, 'c0');
    expect(engine.getProject().shows[0].timeline!.points[0].cueId).toBe('c0');

    engine.setTimelinePointCue('show1', 0, undefined);
    expect(engine.getProject().shows[0].timeline!.points[0].cueId).toBeUndefined();
  });

  it('updateTimelinePoint moves a point and keeps points sorted', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c0', { 0: 10 }))]);
    p.shows[0].timeline = {
      points: [
        { timecodeMs: 1000, type: 'go' },
        { timecodeMs: 2000, type: 'go' },
      ],
    };
    engine.loadProject(p);

    // 先頭(1000)を 3000 へ移動 -> 並べ替えで [2000, 3000] になる。
    engine.updateTimelinePoint('show1', 0, 3000);
    const pts = engine.getProject().shows[0].timeline!.points;
    expect(pts.map((x) => x.timecodeMs)).toEqual([2000, 3000]);
  });

  it('setShowAudio / clearShowAudio set and remove the audio path', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));

    engine.setShowAudio('show1', '/abs/path/song.mp3');
    expect(engine.getProject().shows[0].audio?.filePath).toBe('/abs/path/song.mp3');

    engine.clearShowAudio('show1');
    expect(engine.getProject().shows[0].audio).toBeUndefined();
  });

  it('seek backward does not re-fire', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c0', { 0: 10 }))]);
    p.shows[0].timeline = { points: [{ timecodeMs: 1000, type: 'go' }] };
    engine.loadProject(p);
    engine.loadShow('show1');

    engine.reportAudioPlayhead(1500); // fires once -> cue0
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);

    engine.timelineSeek(0); // reset baseline
    engine.reportAudioPlayhead(500); // 1000 not crossed (500 < 1000)
    // mainIndex stays 0; no extra GO (would be no-op at end anyway)
    expect(engine.getState().playback?.mainIndex).toBe(0);
  });
});
