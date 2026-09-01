import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { projectPathFromArgv } from './openFileArgs';

const cwd = path.resolve('work');

describe('projectPathFromArgv', () => {
  it('パッケージ版は argv[0]（exe）の次から見る', () => {
    const argv = ['C:/Apps/DMX Console.exe', 'C:/shows/live.dmxproj'];
    expect(projectPathFromArgv(argv, cwd, true)).toBe(path.resolve('C:/shows/live.dmxproj'));
  });

  it('開発時は argv[1]（アプリのパス）を読み飛ばす', () => {
    const argv = ['electron', '.', 'live.dmxproj'];
    expect(projectPathFromArgv(argv, cwd, false)).toBe(path.join(cwd, 'live.dmxproj'));
  });

  it('相対パスは渡された作業ディレクトリ基準で解決する', () => {
    const argv = ['app.exe', 'shows/live.dmxproj'];
    expect(projectPathFromArgv(argv, cwd, true)).toBe(path.join(cwd, 'shows', 'live.dmxproj'));
  });

  it('スイッチ（- 始まり）は無視する', () => {
    const argv = ['app.exe', '--allow-file-access', '--foo=bar.dmxproj', 'live.dmxproj'];
    expect(projectPathFromArgv(argv, cwd, true)).toBe(path.join(cwd, 'live.dmxproj'));
  });

  it('.json も Project として受け付ける（開くダイアログと同じ）', () => {
    expect(projectPathFromArgv(['app.exe', 'a.JSON'], cwd, true)).toBe(path.join(cwd, 'a.JSON'));
  });

  it('対象外の引数しかなければ null', () => {
    expect(projectPathFromArgv(['app.exe', 'note.txt', 'a.dmxshow'], cwd, true)).toBeNull();
    expect(projectPathFromArgv(['app.exe'], cwd, true)).toBeNull();
  });
});
