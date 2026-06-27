import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createDefaultProject, type Project, type Show } from '../shared/types';
import { resolveProjectAudioPaths, toPortableProject } from './projectPaths';

/** 実行プラットフォームの絶対パスを基準に最小 Project を組む。 */
function projectWithAudio(filePath: string | undefined): Project {
  const show: Show = { id: 's1', name: 'Act 1', sequence: [] };
  if (filePath) show.audio = { filePath };
  const p = createDefaultProject();
  p.shows = [show];
  return p;
}

const projectDir = path.resolve('proj', 'songs');

describe('toPortableProject', () => {
  it('配下の絶対パスを POSIX 区切りの相対パスへ変換する', () => {
    const abs = path.join(projectDir, 'audio', 'a.mp3');
    const out = toPortableProject(projectWithAudio(abs), projectDir);
    expect(out.shows[0].audio?.filePath).toBe('audio/a.mp3');
  });

  it('配下でない絶対パスは絶対のまま維持する', () => {
    const abs = path.resolve(projectDir, '..', 'elsewhere', 'b.mp3');
    const out = toPortableProject(projectWithAudio(abs), projectDir);
    expect(out.shows[0].audio?.filePath).toBe(abs);
  });

  it('ライブ Project を変更しない（音声ありの Show は新規生成）', () => {
    const abs = path.join(projectDir, 'a.mp3');
    const p = projectWithAudio(abs);
    const out = toPortableProject(p, projectDir);
    expect(p.shows[0].audio?.filePath).toBe(abs); // 元は不変
    expect(out.shows[0]).not.toBe(p.shows[0]); // 書き換え分は別オブジェクト
  });

  it('audio 未設定の Show は同一参照のまま返す', () => {
    const p = projectWithAudio(undefined);
    const out = toPortableProject(p, projectDir);
    expect(out.shows[0]).toBe(p.shows[0]);
  });
});

describe('resolveProjectAudioPaths', () => {
  it('相対パスを projectDir 基準で絶対化する', () => {
    const p = projectWithAudio('audio/a.mp3');
    resolveProjectAudioPaths(p, projectDir);
    expect(p.shows[0].audio?.filePath).toBe(path.join(projectDir, 'audio', 'a.mp3'));
  });

  it('絶対パスはそのまま', () => {
    const abs = path.join(projectDir, 'audio', 'a.mp3');
    const p = projectWithAudio(abs);
    resolveProjectAudioPaths(p, projectDir);
    expect(p.shows[0].audio?.filePath).toBe(abs);
  });
});

describe('相対 ⇄ 絶対 の往復', () => {
  it('配下の絶対パスは toPortable → resolve で元に戻る', () => {
    const abs = path.join(projectDir, 'audio', 'a.mp3');
    const portable = toPortableProject(projectWithAudio(abs), projectDir);
    resolveProjectAudioPaths(portable, projectDir);
    expect(portable.shows[0].audio?.filePath).toBe(abs);
  });
});

/** 追加トラックに1クリップを持つ Show を組む。 */
function projectWithClip(filePath: string): Project {
  const show: Show = {
    id: 's1',
    name: 'Act 1',
    sequence: [],
    timeline: {
      points: [],
      audioTracks: [
        { id: 't1', clips: [{ id: 'c1', filePath, startMs: 0, durationMs: 1000 }], volume: 1, muted: false, solo: false },
      ],
    },
  };
  const p = createDefaultProject();
  p.shows = [show];
  return p;
}

describe('追加トラックのクリップパス', () => {
  it('配下の絶対パスを相対化し、resolve で絶対へ戻す', () => {
    const abs = path.join(projectDir, 'clips', 'c.wav');
    const portable = toPortableProject(projectWithClip(abs), projectDir);
    expect(portable.shows[0].timeline?.audioTracks?.[0].clips[0].filePath).toBe('clips/c.wav');
    resolveProjectAudioPaths(portable, projectDir);
    expect(portable.shows[0].timeline?.audioTracks?.[0].clips[0].filePath).toBe(abs);
  });

  it('クリップ書き換え時もライブ Project を変更しない', () => {
    const abs = path.join(projectDir, 'clips', 'c.wav');
    const p = projectWithClip(abs);
    const out = toPortableProject(p, projectDir);
    expect(p.shows[0].timeline?.audioTracks?.[0].clips[0].filePath).toBe(abs); // 元は不変
    expect(out.shows[0]).not.toBe(p.shows[0]);
  });
});
