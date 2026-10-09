import fs from 'node:fs/promises';
import path from 'node:path';
import { deserializeProject, serializeProject } from '../shared/persistence';
import { PROJECT_VERSION } from '../shared/types';
import { resolveProjectAudioPaths } from './projectPaths';

/** 旧形式は必ず別ファイルに保存してから開く。作成失敗時は元ファイルに触れない。 */
export async function loadProjectFile(
  sourcePath: string,
  notifyUpgrade: () => Promise<void>,
) {
  const text = await fs.readFile(sourcePath, 'utf-8');
  const raw: unknown = JSON.parse(text);
  const project = deserializeProject(text);
  const version = raw && typeof raw === 'object' && 'version' in raw
    ? raw.version : 0;
  let filePath = sourcePath;
  if (typeof version === 'number' && version < PROJECT_VERSION) {
    await notifyUpgrade();
    const parsed = path.parse(sourcePath);
    const serialized = serializeProject(project);
    for (let index = 0; ; index++) {
      const suffix = index === 0 ? '' : `_${index}`;
      const candidate = path.join(parsed.dir, `${parsed.name}_v${PROJECT_VERSION}${suffix}.dmxproj`);
      try {
        // 排他的な新規作成で、既存ファイルや同時実行による上書きを防ぐ。
        await fs.writeFile(candidate, serialized, { encoding: 'utf-8', flag: 'wx' });
        filePath = candidate;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
    }
  }
  // コピーは同じフォルダーに置くため、相対音声パスの基準も変わらない。
  resolveProjectAudioPaths(project, path.dirname(filePath));
  return { project, filePath, originalText: text };
}
