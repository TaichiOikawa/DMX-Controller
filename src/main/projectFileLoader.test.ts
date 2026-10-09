import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject, PROJECT_VERSION } from '../shared/types';
import { loadProjectFile } from './projectFileLoader';

describe('loadProjectFile', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmx-upgrade-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it.each([1, undefined])('旧形式 %s は通知して別ファイルを開き、元の内容と音声参照を保持する', async (version) => {
    const source = path.join(dir, 'show.dmxproj');
    const raw = { ...createDefaultProject(), version, shows: [
      { id: 's1', name: 'Song', sequence: [], audio: { filePath: 'audio/song.wav' } },
    ] };
    const original = JSON.stringify(raw);
    await fs.writeFile(source, original);
    const notify = vi.fn(async () => {
      expect(await fs.readdir(dir)).toEqual(['show.dmxproj']);
    });
    const result = await loadProjectFile(source, notify);
    expect(notify).toHaveBeenCalledOnce();
    expect(result.filePath).toBe(path.join(dir, `show_v${PROJECT_VERSION}.dmxproj`));
    expect(await fs.readFile(source, 'utf-8')).toBe(original);
    const saved = JSON.parse(await fs.readFile(result.filePath, 'utf-8'));
    expect(saved.version).toBe(PROJECT_VERSION);
    expect(saved.shows[0].audio.filePath).toBe('audio/song.wav');
    expect(result.project.shows[0].audio?.filePath).toBe(path.join(dir, 'audio/song.wav'));
    await fs.writeFile(result.filePath, 'subsequent save');
    expect(await fs.readFile(source, 'utf-8')).toBe(original);
  });

  it('既存の変換済みファイルを上書きせず連番で作成する', async () => {
    const source = path.join(dir, 'show.json');
    await fs.writeFile(source, JSON.stringify({ version: 1 }));
    const existing = path.join(dir, `show_v${PROJECT_VERSION}.dmxproj`);
    await fs.writeFile(existing, 'keep');
    const result = await loadProjectFile(source, async () => {});
    expect(result.filePath).toBe(path.join(dir, `show_v${PROJECT_VERSION}_1.dmxproj`));
    expect(await fs.readFile(existing, 'utf-8')).toBe('keep');
  });

  it('現行形式では通知もコピー作成もしない', async () => {
    const source = path.join(dir, 'current.dmxproj');
    await fs.writeFile(source, JSON.stringify(createDefaultProject()));
    const notify = vi.fn();
    expect((await loadProjectFile(source, notify)).filePath).toBe(source);
    expect(notify).not.toHaveBeenCalled();
    expect(await fs.readdir(dir)).toEqual(['current.dmxproj']);
  });

  it('不正JSONでは通知もコピー作成もしない', async () => {
    const source = path.join(dir, 'broken.dmxproj');
    await fs.writeFile(source, '{broken');
    const notify = vi.fn();
    await expect(loadProjectFile(source, notify)).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
    expect(await fs.readFile(source, 'utf-8')).toBe('{broken');
  });

  it('作成エラーでは読込に失敗し、元ファイルを保持する', async () => {
    const source = path.join(dir, 'show.dmxproj');
    const original = JSON.stringify({ version: 1 });
    await fs.writeFile(source, original);
    const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(loadProjectFile(source, async () => {})).rejects.toThrow('disk full');
      expect(await fs.readFile(source, 'utf-8')).toBe(original);
    } finally {
      write.mockRestore();
    }
  });
});
