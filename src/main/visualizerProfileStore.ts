/** userData/visualizer-fixture-profiles.json に保存する端末共通プロファイルライブラリ。 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  createDefaultVisualizerProfileLibrary,
  deserializeVisualizerProfileLibrary,
  serializeVisualizerProfileLibrary,
  type VisualizerProfileLibrary,
} from '../shared/visualizerProfiles';

export class VisualizerProfileStore {
  private readonly filePath: string;
  private library: VisualizerProfileLibrary;

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.join(app.getPath('userData'), 'visualizer-fixture-profiles.json');
    try {
      this.library = deserializeVisualizerProfileLibrary(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      this.library = createDefaultVisualizerProfileLibrary();
    }
  }

  /** 呼び出し側の変更が保存中のライブラリへ波及しないディープコピーを返す。 */
  get(): VisualizerProfileLibrary {
    return structuredClone(this.library);
  }

  /** ライブラリ全体を検証済みコピーへ置換し、直ちに保存する。 */
  set(library: VisualizerProfileLibrary): VisualizerProfileLibrary {
    this.library = deserializeVisualizerProfileLibrary(serializeVisualizerProfileLibrary(library));
    this.write();
    return this.get();
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, serializeVisualizerProfileLibrary(this.library), 'utf-8');
    } catch (error) {
      console.error('[visualizerProfiles] save failed:', error);
    }
  }
}
