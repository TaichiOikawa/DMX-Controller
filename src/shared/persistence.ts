/**
 * Project の永続化（§10）。JSON 文字列との相互変換とバージョンマイグレーション。
 *
 * fs には触れない（純粋・テスト可能）。実ファイル I/O は main/engineHost が担当する。
 * 不正・欠落フィールドはデフォルト値で補完し、読込で落ちないようにする。
 */

import {
  PROJECT_VERSION,
  UNIVERSE_SIZE,
  createDefaultProject,
  defaultArtnetSettings,
  type ActionButton,
  type ArtnetSettings,
  type Cue,
  type Folder,
  type Group,
  type Project,
  type RgbFixture,
  type SequenceEntry,
  type Show,
} from './types';

/** Project を整形 JSON 文字列へ。 */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** JSON 文字列を Project へ。壊れた入力は throw（呼び出し側で握る）。 */
export function deserializeProject(text: string): Project {
  const raw = JSON.parse(text) as unknown;
  return migrateProject(raw);
}

// ===== Show 単体の書き出し / 読み込み（.dmxshow） =====

/** .dmxshow ファイルの種別マーカー。 */
const SHOW_EXPORT_KIND = 'dmxshow';
/** Show 単体エクスポートのフォーマットバージョン。 */
export const SHOW_EXPORT_VERSION = 1;

/**
 * 単一 Show を .dmxshow 文字列へ。folderId は読込先と無関係なので落とす。
 * channelLabels を渡すと、Show が使う ch のラベルのみ sourceLabels（表示専用）として同梱する。
 */
export function serializeShow(show: Show, channelLabels?: Record<number, string>): string {
  const rest: Show = { ...show };
  delete rest.folderId; // 読込先と無関係なので落とす
  const out: {
    kind: string;
    version: number;
    show: Show;
    sourceLabels?: Record<number, string>;
  } = {
    kind: SHOW_EXPORT_KIND,
    version: SHOW_EXPORT_VERSION,
    show: rest,
  };
  if (channelLabels) {
    const labels: Record<number, string> = {};
    let any = false;
    for (const ch of collectShowChannels(show)) {
      const name = channelLabels[ch];
      if (typeof name === 'string' && name.trim()) {
        labels[ch] = name.trim();
        any = true;
      }
    }
    if (any) out.sourceLabels = labels;
  }
  return JSON.stringify(out, null, 2);
}

/**
 * Show の CUE 歌詞をマスター順のテキスト（歌詞シート）へ書き出す。
 * 歌詞のある CUE のみを「番号<TAB>歌詞」で列挙する（番号は Timeline と同じ "1" / "2.1" 形式）。
 * 歌詞が一つも無ければ見出しと注記のみを返す。
 */
export function serializeLyrics(show: Show): string {
  const lines: string[] = [];
  const push = (no: string, cue: Cue) => {
    const lyrics = cue.lyrics?.trim();
    if (lyrics) lines.push(`${no}\t${lyrics}`);
  };
  show.sequence.forEach((entry, m) => {
    if (entry.kind === 'cue') {
      push(`${m + 1}`, entry.cue);
    } else {
      entry.group.cues.forEach((c, j) => push(`${m + 1}.${j + 1}`, c));
    }
  });
  const header = `# ${show.name || 'Show'} 歌詞`;
  if (lines.length === 0) return `${header}\n\n（歌詞が登録された CUE はありません）\n`;
  return `${header}\n\n${lines.join('\n')}\n`;
}

/** .dmxshow 文字列を Show + 参考ラベルへ。種別不正・壊れた入力は throw。 */
export function deserializeShow(text: string): {
  show: Show;
  sourceLabels?: Record<number, string>;
} {
  const raw = JSON.parse(text) as unknown;
  if (!isObject(raw) || raw.kind !== SHOW_EXPORT_KIND || !isObject(raw.show)) {
    throw new Error('Show ファイルとして認識できません（kind 不正）。');
  }
  // 読込先のフォルダ体系は別物なので folderId は除去（空集合を渡す）。
  const show = normalizeShow(raw.show, new Set<string>());
  const sourceLabels = normalizeLabels(raw.sourceLabels, UNIVERSE_SIZE);
  return sourceLabels ? { show, sourceLabels } : { show };
}

/** Show が制御する ch（全 CUE・GROUP 子 CUE の values キー）の和集合を昇順で返す。 */
export function collectShowChannels(show: Show): number[] {
  const set = new Set<number>();
  const add = (values: Record<number, number>) => {
    for (const k of Object.keys(values)) set.add(Number(k));
  };
  for (const entry of show.sequence) {
    if (entry.kind === 'cue') add(entry.cue.values);
    else for (const cue of entry.group.cues) add(cue.values);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Show をディープクローンし、全 CUE の values の ch キーを map で付け替える純関数。
 * map に無い ch は据え置き。同一の先 ch へ衝突したら後勝ち。範囲外（0..511 外）は除外。
 */
export function remapShowChannels(show: Show, map: Record<number, number>): Show {
  const clone = structuredClone(show);
  const remap = (values: Record<number, number>): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(values)) {
      const src = Number(k);
      const dst = map[src] ?? src;
      if (Number.isInteger(dst) && dst >= 0 && dst < UNIVERSE_SIZE) out[dst] = v;
    }
    return out;
  };
  for (const entry of clone.sequence) {
    if (entry.kind === 'cue') entry.cue.values = remap(entry.cue.values);
    else for (const cue of entry.group.cues) cue.values = remap(cue.values);
  }
  return clone;
}

/**
 * 任意のオブジェクトを現行スキーマの Project に正規化する。
 * 旧バージョンのマイグレーション枠もここに集約する（現状 v1 のみ）。
 */
export function migrateProject(raw: unknown): Project {
  const def = createDefaultProject();
  if (!isObject(raw)) return def;

  // 将来: const version = num(raw.version, 0); if (version < N) { ...移行... }

  const folders = normalizeFolders(raw.folders);
  const validFolderIds = new Set(folders.map((f) => f.id));
  const project: Project = {
    version: PROJECT_VERSION,
    name: str(raw.name, def.name),
    settings: normalizeSettings(raw.settings),
    faders: normalizeFaders(raw.faders),
    actions: normalizeActions(raw.actions),
    shows: normalizeShows(raw.shows, validFolderIds),
  };
  if (folders.length > 0) project.folders = folders;
  const channelLabels = normalizeLabels(raw.channelLabels, UNIVERSE_SIZE);
  if (channelLabels) project.channelLabels = channelLabels;
  const bankLabels = normalizeLabels(raw.bankLabels, UNIVERSE_SIZE / 32);
  if (bankLabels) project.bankLabels = bankLabels;
  const fixtures = normalizeFixtures(raw.fixtures);
  if (fixtures) project.fixtures = fixtures;
  return project;
}

/** RGB フィクスチャ配列を正規化する。r/g/b が範囲内の要素のみ採用、空なら undefined。 */
function normalizeFixtures(raw: unknown): RgbFixture[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RgbFixture[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const r = channelOrNull(item.r);
    const g = channelOrNull(item.g);
    const b = channelOrNull(item.b);
    if (r === null || g === null || b === null) continue;
    const fx: RgbFixture = { id: str(item.id, fallbackId()), r, g, b };
    if (typeof item.name === 'string' && item.name.trim()) fx.name = item.name.trim();
    out.push(fx);
  }
  return out.length > 0 ? out : undefined;
}

/** ch を整数かつ 0..UNIVERSE_SIZE-1 に検証する（外れたら null）。 */
function channelOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= UNIVERSE_SIZE) return null;
  return v;
}

/** index->文字列のラベル辞書を正規化する。範囲外/空は捨て、空なら undefined。 */
function normalizeLabels(raw: unknown, count: number): Record<number, string> | undefined {
  if (!isObject(raw)) return undefined;
  const out: Record<number, string> = {};
  let any = false;
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    out[i] = t;
    any = true;
  }
  return any ? out : undefined;
}

function normalizeSettings(raw: unknown): Project['settings'] {
  const def = createDefaultProject().settings;
  if (!isObject(raw)) return def;
  return {
    universeCount: clampInt(num(raw.universeCount, def.universeCount), 1, 8),
    artnet: normalizeArtnet(raw.artnet),
    releaseFadeMs: Math.max(0, num(raw.releaseFadeMs, def.releaseFadeMs)),
  };
}

function normalizeArtnet(raw: unknown): ArtnetSettings {
  const def = defaultArtnetSettings();
  if (!isObject(raw)) return def;
  return {
    targetIp: str(raw.targetIp, def.targetIp),
    universe: clampInt(num(raw.universe, def.universe), 0, 15),
    net: clampInt(num(raw.net, def.net), 0, 127),
    subnet: clampInt(num(raw.subnet, def.subnet), 0, 15),
    refreshRateHz: clampInt(num(raw.refreshRateHz, def.refreshRateHz), 1, 60),
  };
}

function normalizeFaders(raw: unknown): number[] {
  const out = new Array(UNIVERSE_SIZE).fill(0);
  if (Array.isArray(raw)) {
    for (let i = 0; i < UNIVERSE_SIZE; i++) out[i] = clampInt(num(raw[i], 0), 0, 255);
  }
  return out;
}

function normalizeActions(raw: unknown): ActionButton[] {
  // Action はロードマップ6 で実装。保存されていればそのまま通す（緩く）。
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject) as unknown as ActionButton[];
}

/** フォルダ配列を正規化する（id/name のみ）。 */
function normalizeFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return [];
  return (raw.filter(isObject) as Record<string, unknown>[]).map((f) => ({
    id: str(f.id, fallbackId()),
    name: str(f.name, 'フォルダ'),
  }));
}

function normalizeShows(raw: unknown, validFolderIds: Set<string>): Show[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((s) => normalizeShow(s, validFolderIds));
}

function normalizeShow(raw: Record<string, unknown>, validFolderIds: Set<string>): Show {
  const show: Show = {
    id: str(raw.id, fallbackId()),
    name: str(raw.name, 'Show'),
    sequence: normalizeSequence(raw),
  };
  // 実在するフォルダを参照しているときのみ folderId を保持（ダングリング除去）。
  if (typeof raw.folderId === 'string' && validFolderIds.has(raw.folderId)) {
    show.folderId = raw.folderId;
  }
  if (isObject(raw.audio) && typeof raw.audio.filePath === 'string') {
    show.audio = { filePath: raw.audio.filePath };
  }
  if (isObject(raw.timeline)) {
    // Timeline はロードマップ7。構造はそのまま温存（検証は後続で）。
    show.timeline = raw.timeline as unknown as Show['timeline'];
  }
  return show;
}

/**
 * マスター列を正規化する。
 * 旧形式（並列グループ `groups[]`）が来たら、各 group を GROUP エントリへ変換して
 * マスター列に並べる（後方互換）。
 */
function normalizeSequence(raw: Record<string, unknown>): SequenceEntry[] {
  if (Array.isArray(raw.sequence)) {
    return (raw.sequence.filter(isObject) as Record<string, unknown>[])
      .map(normalizeEntry)
      .filter((e): e is SequenceEntry => e !== null);
  }
  // レガシー: groups[] → 各 group を GROUP エントリへ。
  if (Array.isArray(raw.groups)) {
    return (raw.groups.filter(isObject) as Record<string, unknown>[]).map((g) => ({
      kind: 'group' as const,
      group: normalizeGroup(g),
    }));
  }
  return [];
}

function normalizeEntry(raw: Record<string, unknown>): SequenceEntry | null {
  if (raw.kind === 'group' && isObject(raw.group)) {
    return { kind: 'group', group: normalizeGroup(raw.group) };
  }
  if (raw.kind === 'cue' && isObject(raw.cue)) {
    return { kind: 'cue', cue: normalizeCue(raw.cue) };
  }
  return null;
}

function normalizeGroup(raw: Record<string, unknown>): Group {
  return {
    id: str(raw.id, fallbackId()),
    name: typeof raw.name === 'string' ? raw.name : undefined,
    loop: raw.loop === true,
    cues: Array.isArray(raw.cues)
      ? (raw.cues.filter(isObject) as Record<string, unknown>[]).map(normalizeCue)
      : [],
  };
}

function normalizeCue(raw: Record<string, unknown>): Cue {
  const cue: Cue = {
    id: str(raw.id, fallbackId()),
    name: typeof raw.name === 'string' ? raw.name : undefined,
    lyrics: typeof raw.lyrics === 'string' ? raw.lyrics : undefined,
    values: normalizeValues(raw.values),
    fadeInMs: Math.max(0, num(raw.fadeInMs, 0)),
  };
  if (raw.fadeOutMs !== undefined) cue.fadeOutMs = Math.max(0, num(raw.fadeOutMs, 0));
  if (raw.delayMs !== undefined) cue.delayMs = Math.max(0, num(raw.delayMs, 0));
  if (raw.followMs !== undefined) cue.followMs = Math.max(0, num(raw.followMs, 0));
  return cue;
}

function normalizeValues(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (isObject(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const ch = Number(k);
      if (Number.isInteger(ch) && ch >= 0 && ch < UNIVERSE_SIZE) {
        out[ch] = clampInt(num(v, 0), 0, 255);
      }
    }
  }
  return out;
}

// ===== ヘルパ =====

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

let idCounter = 0;
function fallbackId(): string {
  return `imported-${++idCounter}`;
}
