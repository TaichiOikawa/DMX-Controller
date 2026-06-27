import { describe, it, expect } from 'vitest';
import { Engine } from './Engine';
import { AUDIO_TRACK_COUNT, createDefaultProject, type Project } from '../shared/types';

function projectWithShow(): Project {
  const p = createDefaultProject();
  p.shows = [{ id: 'show1', name: 'Show 1', sequence: [] }];
  return p;
}

function makeEngine() {
  const engine = new Engine({ send: () => {}, nowFn: () => 0 });
  engine.loadProject(projectWithShow());
  engine.loadShow('show1');
  return engine;
}

function tracks(engine: Engine) {
  return engine.getProject().shows[0].timeline?.audioTracks ?? [];
}

describe('追加オーディオトラック / クリップ', () => {
  it('最初のクリップ追加で固定本数のトラックを生成し、開始位置順に並べる', () => {
    const engine = makeEngine();
    engine.addAudioClip('show1', 0, '/a.wav', 2000, 1000);
    engine.addAudioClip('show1', 0, '/b.wav', 500, 1000);

    const t = tracks(engine);
    expect(t).toHaveLength(AUDIO_TRACK_COUNT);
    expect(t[0].clips.map((c) => c.filePath)).toEqual(['/b.wav', '/a.wav']);
    expect(t[0].clips[0].startMs).toBe(500);
    expect(t[0].clips[1].durationMs).toBe(1000);
  });

  it('クリップ追加は負の開始位置を 0 へクランプする', () => {
    const engine = makeEngine();
    engine.addAudioClip('show1', 1, '/a.wav', -100, 500);
    expect(tracks(engine)[1].clips[0].startMs).toBe(0);
  });

  it('moveAudioClip は開始位置を更新して再ソートする', () => {
    const engine = makeEngine();
    engine.addAudioClip('show1', 0, '/a.wav', 0, 1000);
    engine.addAudioClip('show1', 0, '/b.wav', 2000, 1000);
    const aId = tracks(engine)[0].clips.find((c) => c.filePath === '/a.wav')!.id;

    engine.moveAudioClip('show1', 0, aId, 5000);
    const order = tracks(engine)[0].clips.map((c) => c.filePath);
    expect(order).toEqual(['/b.wav', '/a.wav']);
  });

  it('removeAudioClip は対象クリップを削除する', () => {
    const engine = makeEngine();
    engine.addAudioClip('show1', 0, '/a.wav', 0, 1000);
    const id = tracks(engine)[0].clips[0].id;
    engine.removeAudioClip('show1', 0, id);
    expect(tracks(engine)[0].clips).toHaveLength(0);
  });

  it('setAudioTrackProps は音量(0..1クランプ)/ミュート/ソロを反映し、トラックを生成する', () => {
    const engine = makeEngine();
    engine.setAudioTrackProps('show1', 2, { volume: 1.5, muted: true, solo: true });
    const t = tracks(engine)[2];
    expect(t.volume).toBe(1);
    expect(t.muted).toBe(true);
    expect(t.solo).toBe(true);
  });

  it('SHOW モードではクリップ編集を無視する（ミキサー操作は許可）', () => {
    const engine = makeEngine();
    engine.setMode('show');
    engine.addAudioClip('show1', 0, '/a.wav', 0, 1000);
    expect(tracks(engine).every((t) => t.clips.length === 0)).toBe(true);

    // 音量/ミュート/ソロは SHOW 中でも反映される。
    engine.setAudioTrackProps('show1', 0, { volume: 0.5 });
    expect(tracks(engine)[0].volume).toBe(0.5);
  });
});
