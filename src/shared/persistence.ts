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
  type Group,
  type Project,
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

/**
 * 任意のオブジェクトを現行スキーマの Project に正規化する。
 * 旧バージョンのマイグレーション枠もここに集約する（現状 v1 のみ）。
 */
export function migrateProject(raw: unknown): Project {
  const def = createDefaultProject();
  if (!isObject(raw)) return def;

  // 将来: const version = num(raw.version, 0); if (version < N) { ...移行... }

  const project: Project = {
    version: PROJECT_VERSION,
    name: str(raw.name, def.name),
    settings: normalizeSettings(raw.settings),
    faders: normalizeFaders(raw.faders),
    actions: normalizeActions(raw.actions),
    shows: normalizeShows(raw.shows),
  };
  const channelLabels = normalizeLabels(raw.channelLabels, UNIVERSE_SIZE);
  if (channelLabels) project.channelLabels = channelLabels;
  const bankLabels = normalizeLabels(raw.bankLabels, UNIVERSE_SIZE / 32);
  if (bankLabels) project.bankLabels = bankLabels;
  return project;
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

function normalizeShows(raw: unknown): Show[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map(normalizeShow);
}

function normalizeShow(raw: Record<string, unknown>): Show {
  const show: Show = {
    id: str(raw.id, fallbackId()),
    name: str(raw.name, 'Show'),
    sequence: normalizeSequence(raw),
  };
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
