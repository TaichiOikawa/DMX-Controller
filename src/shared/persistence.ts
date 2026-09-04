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
  createDefaultStageLayout,
  createDefaultStaticFixtureParameters,
  type ActionButton,
  type ActionStep,
  type ArtnetSettings,
  type OpenDmxSettings,
  type Cue,
  type Folder,
  type Group,
  type Project,
  type RgbFixture,
  type DmxParameterBinding,
  type StageLayout,
  type StaticFixtureParameters,
  type Vector3,
  type VisualizerFixture,
  type VisualizerFixtureProfile,
  type VisualizerParameter,
  type SequenceEntry,
  type Setlist,
  type SetlistEntry,
  type Show,
  type Timeline,
  type TimelinePoint,
  type AudioTrack,
  type AudioClip,
} from './types';
import { normalizeArtnet, normalizeOpenDmx } from './appSettings';
import { clampInt, isObject, num, str } from './normalize';

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
  const validShowIds = new Set(project.shows.map((s) => s.id));
  const setlists = normalizeSetlists(raw.setlists, validShowIds);
  if (setlists.length > 0) project.setlists = setlists;
  if (folders.length > 0) project.folders = folders;
  const channelLabels = normalizeLabels(raw.channelLabels, UNIVERSE_SIZE);
  if (channelLabels) project.channelLabels = channelLabels;
  const bankLabels = normalizeLabels(raw.bankLabels, UNIVERSE_SIZE / 32);
  if (bankLabels) project.bankLabels = bankLabels;
  const fixtures = normalizeFixtures(raw.fixtures);
  if (fixtures) project.fixtures = fixtures;
  project.stageLayout = normalizeStageLayout(raw.stageLayout);
  return project;
}

const VISUALIZER_PARAMETERS: VisualizerParameter[] = [
  'dimmer',
  'red',
  'green',
  'blue',
  'pan',
  'tilt',
  'zoom',
];

/** v1 Project や不正な値を、安全な空の Stage Layout へ移行する。 */
export function normalizeStageLayout(raw: unknown): StageLayout {
  const def = createDefaultStageLayout();
  if (!isObject(raw)) return def;

  const profiles = normalizeVisualizerProfiles(raw.profiles);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  return {
    widthM: positiveNumber(raw.widthM, def.widthM),
    depthM: positiveNumber(raw.depthM, def.depthM),
    heightM: positiveNumber(raw.heightM, def.heightM),
    profiles,
    fixtures: normalizeVisualizerFixtures(raw.fixtures, profilesById),
  };
}

export function normalizeVisualizerProfiles(raw: unknown): VisualizerFixtureProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualizerFixtureProfile[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isObject(item)) continue;
    const id = str(item.id, fallbackId()).trim() || fallbackId();
    if (ids.has(id)) continue;
    ids.add(id);
    const panRangeDeg = normalizeRange(item.panRangeDeg, -270, 270);
    const tiltRangeDeg = normalizeRange(item.tiltRangeDeg, -135, 135);
    const zoomRangeDeg = normalizeRange(item.zoomRangeDeg, 5, 45);
    out.push({
      id,
      name: str(item.name, '3D Fixture Profile').trim() || '3D Fixture Profile',
      bindings: normalizeBindings(item.bindings),
      panRangeDeg,
      tiltRangeDeg,
      zoomRangeDeg,
      defaultStaticParameters: normalizeStaticParameters(
        item.defaultStaticParameters,
        panRangeDeg,
        tiltRangeDeg,
        zoomRangeDeg,
      ),
    });
  }
  return out;
}

function normalizeBindings(raw: unknown): Partial<Record<VisualizerParameter, DmxParameterBinding>> {
  if (!isObject(raw)) return {};
  const out: Partial<Record<VisualizerParameter, DmxParameterBinding>> = {};
  for (const parameter of VISUALIZER_PARAMETERS) {
    const binding = raw[parameter];
    if (!isObject(binding)) continue;
    const coarseOffset = offsetOrNull(binding.coarseOffset);
    if (coarseOffset === null) continue;
    if (binding.resolution === '8bit') {
      out[parameter] = { resolution: '8bit', coarseOffset };
    } else if (binding.resolution === '16bit') {
      const fineOffset = offsetOrNull(binding.fineOffset);
      if (fineOffset !== null) out[parameter] = { resolution: '16bit', coarseOffset, fineOffset };
    }
  }
  return out;
}

function normalizeVisualizerFixtures(
  raw: unknown,
  profilesById: Map<string, VisualizerFixtureProfile>,
): VisualizerFixture[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualizerFixture[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.profileId !== 'string') continue;
    const profile = profilesById.get(item.profileId);
    if (!profile) continue;
    const id = str(item.id, fallbackId()).trim() || fallbackId();
    if (ids.has(id)) continue;
    const startChannel = optionalStartChannel(item.startChannel, profile);
    // startChannel が明示されているのに不正なら、誤ったCHを静的灯体として救済しない。
    if (item.startChannel !== undefined && startChannel === undefined) continue;
    const fixture: VisualizerFixture = {
      id,
      name: str(item.name, profile.name).trim() || profile.name,
      profileId: profile.id,
      positionM: normalizeVector3(item.positionM),
      mountRotationDeg: normalizeVector3(item.mountRotationDeg),
      staticParameters: normalizeStaticParameters(
        item.staticParameters,
        profile.panRangeDeg,
        profile.tiltRangeDeg,
        profile.zoomRangeDeg,
        profile.defaultStaticParameters,
      ),
    };
    if (startChannel !== undefined) fixture.startChannel = startChannel;
    ids.add(id);
    out.push(fixture);
  }
  return out;
}

function optionalStartChannel(
  raw: unknown,
  profile: VisualizerFixtureProfile,
): number | undefined {
  if (raw === undefined) return undefined;
  const start = channelOrNull(raw);
  if (start === null) return undefined;
  let maxOffset = -1;
  for (const binding of Object.values(profile.bindings)) {
    maxOffset = Math.max(
      maxOffset,
      binding.coarseOffset,
      binding.resolution === '16bit' ? binding.fineOffset : -1,
    );
  }
  return start + maxOffset < UNIVERSE_SIZE ? start : undefined;
}

function normalizeVector3(raw: unknown): Vector3 {
  if (!isObject(raw)) return { x: 0, y: 0, z: 0 };
  return { x: num(raw.x, 0), y: num(raw.y, 0), z: num(raw.z, 0) };
}

function normalizeRange(raw: unknown, defaultMin: number, defaultMax: number) {
  if (!isObject(raw)) return { min: defaultMin, max: defaultMax };
  return { min: num(raw.min, defaultMin), max: num(raw.max, defaultMax) };
}

function normalizeStaticParameters(
  raw: unknown,
  panRange: { min: number; max: number },
  tiltRange: { min: number; max: number },
  zoomRange: { min: number; max: number },
  fallback = createDefaultStaticFixtureParameters(),
): StaticFixtureParameters {
  const value = isObject(raw) ? raw : {};
  return {
    dimmer: clampNumber(num(value.dimmer, fallback.dimmer), 0, 1),
    red: clampNumber(num(value.red, fallback.red), 0, 1),
    green: clampNumber(num(value.green, fallback.green), 0, 1),
    blue: clampNumber(num(value.blue, fallback.blue), 0, 1),
    pan: clampToRange(num(value.pan, fallback.pan), panRange),
    tilt: clampToRange(num(value.tilt, fallback.tilt), tiltRange),
    zoom: clampToRange(num(value.zoom, fallback.zoom), zoomRange),
  };
}

function positiveNumber(raw: unknown, fallback: number): number {
  const value = num(raw, fallback);
  return value > 0 ? value : fallback;
}

function offsetOrNull(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < UNIVERSE_SIZE
    ? raw
    : null;
}

function clampToRange(value: number, range: { min: number; max: number }): number {
  return clampNumber(value, Math.min(range.min, range.max), Math.max(range.min, range.max));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

/**
 * Project の settings を正規化する。
 * 出力系（artnet / openDmx）はアプリ設定へ移したので、旧ファイルに残っていても捨てる
 * （移行は {@link extractLegacyOutputSettings} 経由でアプリ設定側が一度だけ拾う）。
 */
function normalizeSettings(raw: unknown): Project['settings'] {
  const def = createDefaultProject().settings;
  if (!isObject(raw)) return def;
  return {
    universeCount: clampInt(num(raw.universeCount, def.universeCount), 1, 8),
    releaseFadeMs: Math.max(0, num(raw.releaseFadeMs, def.releaseFadeMs)),
  };
}

/**
 * 旧フォーマットの Project JSON に残っている出力設定（settings.artnet / settings.openDmx）を取り出す。
 * v1.x では Project に保存していたので、アプリ設定が未作成のときだけ一度だけ引き継ぐために使う。
 * 該当フィールドが無ければ undefined。
 */
export function extractLegacyOutputSettings(text: string): {
  artnet?: ArtnetSettings;
  openDmx?: OpenDmxSettings;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isObject(raw) || !isObject(raw.settings)) return {};
  const out: { artnet?: ArtnetSettings; openDmx?: OpenDmxSettings } = {};
  if (isObject(raw.settings.artnet)) out.artnet = normalizeArtnet(raw.settings.artnet);
  if (isObject(raw.settings.openDmx)) out.openDmx = normalizeOpenDmx(raw.settings.openDmx);
  return out;
}

function normalizeFaders(raw: unknown): number[] {
  const out = new Array(UNIVERSE_SIZE).fill(0);
  if (Array.isArray(raw)) {
    for (let i = 0; i < UNIVERSE_SIZE; i++) out[i] = clampInt(num(raw[i], 0), 0, 255);
  }
  return out;
}

function normalizeActions(raw: unknown): ActionButton[] {
  if (!Array.isArray(raw)) return [];
  return (raw.filter(isObject) as Record<string, unknown>[]).map(normalizeAction);
}

/**
 * Action を正規化する。steps が欠落・不正でも空配列へ倒し、
 * Engine 側（applyActionLook / editCurrentAction）が steps 前提で落ちないようにする。
 */
function normalizeAction(raw: Record<string, unknown>): ActionButton {
  const action: ActionButton = {
    id: str(raw.id, fallbackId()),
    steps: Array.isArray(raw.steps)
      ? (raw.steps.filter(isObject) as Record<string, unknown>[]).map(normalizeActionStep)
      : [],
  };
  if (typeof raw.name === 'string') action.name = raw.name;
  return action;
}

function normalizeActionStep(raw: Record<string, unknown>): ActionStep {
  const step: ActionStep = {
    values: normalizeValues(raw.values),
    fadeInMs: Math.max(0, num(raw.fadeInMs, 0)),
  };
  if (raw.holdMs !== undefined) step.holdMs = Math.max(0, num(raw.holdMs, 0));
  return step;
}

/** フォルダ配列を正規化する（id/name のみ）。 */
function normalizeFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return [];
  return (raw.filter(isObject) as Record<string, unknown>[]).map((f) => ({
    id: str(f.id, fallbackId()),
    name: str(f.name, 'フォルダ'),
  }));
}

/**
 * セットリスト配列を正規化する。存在しない Show を指すエントリは捨てる（ダングリング除去）。
 * 空になった Setlist は残す（Show ツリーが空 Show を残すのと同じ思想）。
 */
function normalizeSetlists(raw: unknown, validShowIds: Set<string>): Setlist[] {
  if (!Array.isArray(raw)) return [];
  return (raw.filter(isObject) as Record<string, unknown>[]).map((s) =>
    normalizeSetlist(s, validShowIds),
  );
}

function normalizeSetlist(raw: Record<string, unknown>, validShowIds: Set<string>): Setlist {
  const entries: SetlistEntry[] = [];
  if (Array.isArray(raw.entries)) {
    for (const e of raw.entries) {
      if (!isObject(e)) continue;
      const showId = str(e.showId, '');
      if (!showId || !validShowIds.has(showId)) continue; // ダングリング除去
      entries.push({ id: str(e.id, fallbackId()), showId });
    }
  }
  return {
    id: str(raw.id, fallbackId()),
    name: str(raw.name, 'Setlist'),
    entries,
  };
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
    if (typeof raw.audio.volume === 'number') {
      show.audio.volume = clampInt(raw.audio.volume * 100, 0, 100) / 100;
    }
    if (raw.audio.muted === true) show.audio.muted = true;
    if (raw.audio.solo === true) show.audio.solo = true;
    if (typeof raw.audio.outputDeviceId === 'string') {
      show.audio.outputDeviceId = raw.audio.outputDeviceId;
    }
  }
  if (isObject(raw.timeline)) {
    show.timeline = normalizeTimeline(raw.timeline);
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

/**
 * Timeline を正規化する。points は従来どおり温存し、追加オーディオトラック（audioTracks）を検証・補修する。
 * トラック本数の補完（ensureAudioTracks）は編集時にエンジン側で行うため、ここでは存在分のみ整える。
 */
function normalizeTimeline(raw: Record<string, unknown>): Timeline {
  const points = Array.isArray(raw.points)
    ? (raw.points.filter(isObject) as Record<string, unknown>[])
        .map(normalizeTimelinePoint)
        .filter((p): p is TimelinePoint => p !== null)
        .sort((a, b) => a.timecodeMs - b.timecodeMs) // エンジン側の昇順不変条件に合わせる
    : [];
  const timeline: Timeline = { points };
  if (Array.isArray(raw.audioTracks)) {
    timeline.audioTracks = (raw.audioTracks.filter(isObject) as Record<string, unknown>[]).map(
      normalizeAudioTrack,
    );
  }
  return timeline;
}

/** GO ポイントを正規化する。時刻が数値でないポイントは位置が定まらないので捨てる（null）。 */
function normalizeTimelinePoint(raw: Record<string, unknown>): TimelinePoint | null {
  if (typeof raw.timecodeMs !== 'number' || !Number.isFinite(raw.timecodeMs)) return null;
  const point: TimelinePoint = {
    // id の無い旧フォーマットには代替 id を振る（保存時に永続化される）。
    id: str(raw.id, fallbackId()),
    timecodeMs: Math.max(0, Math.round(raw.timecodeMs)),
    type: 'go',
  };
  if (typeof raw.cueId === 'string' && raw.cueId) point.cueId = raw.cueId;
  if (typeof raw.groupId === 'string' && raw.groupId) point.groupId = raw.groupId;
  return point;
}

function normalizeAudioTrack(raw: Record<string, unknown>): AudioTrack {
  const clips = Array.isArray(raw.clips)
    ? (raw.clips.filter(isObject) as Record<string, unknown>[])
        .map(normalizeAudioClip)
        .filter((c): c is AudioClip => c !== null)
    : [];
  const track: AudioTrack = {
    id: str(raw.id, fallbackId()),
    clips,
    volume: clampInt(num(raw.volume, 1) * 100, 0, 100) / 100,
    muted: raw.muted === true,
    solo: raw.solo === true,
  };
  if (typeof raw.name === 'string') track.name = raw.name;
  if (typeof raw.outputDeviceId === 'string') track.outputDeviceId = raw.outputDeviceId;
  return track;
}

function normalizeAudioClip(raw: Record<string, unknown>): AudioClip | null {
  const filePath = str(raw.filePath, '');
  if (!filePath) return null;
  return {
    id: str(raw.id, fallbackId()),
    filePath,
    startMs: Math.max(0, num(raw.startMs, 0)),
    durationMs: Math.max(0, num(raw.durationMs, 0)),
  };
}

let idCounter = 0;
function fallbackId(): string {
  return `imported-${++idCounter}`;
}
