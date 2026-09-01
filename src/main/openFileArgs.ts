/**
 * ファイル関連付け（.dmxproj のダブルクリック）で渡される引数の解析。
 *
 * Windows / Linux は「開くファイル」がコマンドライン引数として渡る（macOS は open-file イベント）。
 * electron に依存させず単体テストできるよう main/index.ts から切り出している。
 */

import path from 'node:path';

/** Project として開ける拡張子（EngineHost の「開く」ダイアログの filters と揃える）。 */
const PROJECT_EXT = /\.(dmxproj|json)$/i;

/**
 * コマンドライン引数から開くべき Project のパスを取り出す。
 *
 * @param argv    プロセスの argv（second-instance で渡るものも同形式）
 * @param cwd     相対パス解決の基準（second-instance では起動側の作業ディレクトリ）
 * @param isPackaged パッケージ版は argv[0] が exe のみ、開発時は argv[1] がアプリのパスなので読み飛ばす
 */
export function projectPathFromArgv(
  argv: string[],
  cwd: string,
  isPackaged: boolean,
): string | null {
  for (const arg of argv.slice(isPackaged ? 1 : 2)) {
    if (arg.startsWith('-')) continue; // Chromium/Electron のスイッチ
    if (PROJECT_EXT.test(arg)) return path.resolve(cwd, arg);
  }
  return null;
}
