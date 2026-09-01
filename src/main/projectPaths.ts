/**
 * Project の音声ファイルパスを「ディスク境界」で相対 ⇄ 絶対変換する純粋関数群。
 *
 * 方針（§ポータブル化）:
 *  - メモリ上（Engine / renderer / Undo-Redo / dirty 判定）は**常に絶対パス**で扱う。
 *  - 保存時のみ、音声が **プロジェクトファイルの配下**にあれば相対パス（POSIX 区切り）へ。
 *  - 読込直後のみ、相対パスを基準ディレクトリで絶対化して戻す。
 *
 * これにより、プロジェクトと音声を一緒に別環境へ移しても再リンク不要でアクセスできる。
 * `node:path` を使うため main 側に置く（shared/persistence は renderer でも import されるため）。
 */

import path from 'node:path';
import type { Project } from '../shared/types';

/**
 * 絶対パスが projectDir 配下なら POSIX 区切りの相対パスへ、そうでなければそのまま返す。
 * 既に相対の場合も変更しない（呼び出し側で絶対のみ渡す想定だが安全側に倒す）。
 */
function toPortablePath(filePath: string, projectDir: string): string {
  if (!path.isAbsolute(filePath)) return filePath;
  const rel = path.relative(projectDir, filePath);
  // 配下でない（親へ遡る / 別ドライブで絶対のまま）なら絶対パスを維持する。
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return filePath;
  return rel.split(path.sep).join('/');
}

/**
 * 保存用に、配下の音声パスを相対化した Project の**コピー**を返す。
 * ライブ Project（Engine.getProject() のライブ参照）は変更しない。
 * 書き換えが必要な Show だけ新規生成する（最小コピー）。
 */
export function toPortableProject(project: Project, projectDir: string): Project {
  const shows = project.shows.map((show) => {
    // メイン音声。
    let nextAudio = show.audio;
    if (show.audio?.filePath) {
      const portable = toPortablePath(show.audio.filePath, projectDir);
      if (portable !== show.audio.filePath) nextAudio = { ...show.audio, filePath: portable };
    }

    // 追加トラックのクリップ。
    let tracksChanged = false;
    const tracks = show.timeline?.audioTracks;
    let nextTracks = tracks;
    if (tracks) {
      nextTracks = tracks.map((track) => {
        let clipsChanged = false;
        const nextClips = track.clips.map((clip) => {
          const portable = toPortablePath(clip.filePath, projectDir);
          if (portable === clip.filePath) return clip;
          clipsChanged = true;
          return { ...clip, filePath: portable };
        });
        if (!clipsChanged) return track;
        tracksChanged = true;
        return { ...track, clips: nextClips };
      });
    }

    if (nextAudio === show.audio && !tracksChanged) return show;
    const next = { ...show };
    if (nextAudio !== show.audio) next.audio = nextAudio;
    if (tracksChanged && show.timeline) next.timeline = { ...show.timeline, audioTracks: nextTracks };
    return next;
  });
  return { ...project, shows };
}

/**
 * 読込直後の Project（共有されていない）を **in-place** で絶対化する。
 * 相対パスは projectDir 基準で解決、絶対パスはそのまま。
 */
export function resolveProjectAudioPaths(project: Project, projectDir: string): void {
  for (const show of project.shows) {
    const filePath = show.audio?.filePath;
    if (show.audio && filePath && !path.isAbsolute(filePath)) {
      // filePath 以外（volume/muted/solo/outputDeviceId）は保持したまま絶対化する。
      show.audio = { ...show.audio, filePath: path.resolve(projectDir, filePath) };
    }
    const tracks = show.timeline?.audioTracks;
    if (tracks) {
      for (const track of tracks) {
        for (const clip of track.clips) {
          if (!path.isAbsolute(clip.filePath)) {
            clip.filePath = path.resolve(projectDir, clip.filePath);
          }
        }
      }
    }
  }
}
