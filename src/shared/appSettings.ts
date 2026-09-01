/**
 * アプリ設定（Project ファイルではなく **アプリ自体**に永続化する設定）。
 *
 * 出力系（Art-Net / OpenDMX）とリモート操作サーバーの設定は「その PC / その現場」に
 * 紐づくもので、Project（演目データ）と一緒に配ると別マシンで壊れる。
 * そのため Project からは切り離し、userData 配下の settings.json に保存する。
 * 実ファイル I/O は main の AppSettingsStore が担当し、このモジュールは純粋に保つ。
 */

import {
  defaultArtnetSettings,
  defaultOpenDmxSettings,
  type ArtnetSettings,
  type OpenDmxSettings,
} from './types';
import { clampInt, isObject, num, str } from './normalize';

/** リモート操作サーバーの待受ポート既定値。 */
export const DEFAULT_REMOTE_PORT = 3939;

/** 現在のアプリ設定フォーマットのバージョン。 */
export const APP_SETTINGS_VERSION = 1;

/** リモート操作サーバー（スマホ等）の永続設定。 */
export interface RemoteSettings {
  /** 起動時に自動で listen するか。 */
  enabled: boolean;
  /** 待受ポート。 */
  port: number;
  /**
   * 接続 PIN（4 桁）。空文字は未生成で、起動時に RemoteServer が採番して保存する。
   * 永続化することで、再起動しても同じ PIN でスマホから入り直せる。
   */
  pin: string;
}

/** アプリ自体に保存する設定の全体。 */
export interface AppSettings {
  version: number;
  artnet: ArtnetSettings;
  openDmx: OpenDmxSettings;
  remote: RemoteSettings;
}

/** リモート設定の既定値（既定は無効・PIN 未生成）。 */
export function defaultRemoteSettings(): RemoteSettings {
  return { enabled: false, port: DEFAULT_REMOTE_PORT, pin: '' };
}

/** 新規アプリ設定の初期値。 */
export function createDefaultAppSettings(): AppSettings {
  return {
    version: APP_SETTINGS_VERSION,
    artnet: defaultArtnetSettings(),
    openDmx: defaultOpenDmxSettings(),
    remote: defaultRemoteSettings(),
  };
}

/** Art-Net 設定を現行スキーマへ正規化する。 */
export function normalizeArtnet(raw: unknown): ArtnetSettings {
  const def = defaultArtnetSettings();
  if (!isObject(raw)) return def;
  return {
    // enabled が無い旧データは既定値（無効）へ。接続は明示的に有効化させる。
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled,
    targetIp: str(raw.targetIp, def.targetIp),
    universe: clampInt(num(raw.universe, def.universe), 0, 15),
    net: clampInt(num(raw.net, def.net), 0, 127),
    subnet: clampInt(num(raw.subnet, def.subnet), 0, 15),
    refreshRateHz: clampInt(num(raw.refreshRateHz, def.refreshRateHz), 1, 60),
  };
}

/**
 * OpenDMX 設定を現行スキーマへ正規化する。
 * `kind` は後から足したフィールドなので、無ければ従来どおりの `'opendmx'` に倒す。
 */
export function normalizeOpenDmx(raw: unknown): OpenDmxSettings {
  const def = defaultOpenDmxSettings();
  if (!isObject(raw)) return def;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled,
    portPath: str(raw.portPath, def.portPath),
    kind: raw.kind === 'pico' ? 'pico' : def.kind,
  };
}

/**
 * リモート設定を現行スキーマへ正規化する。
 * PIN は 4 桁数字のみ採用（それ以外は未生成扱い＝起動時に採番し直す）。
 * ポートは範囲外なら既定値へ戻す（クランプすると 1 番など使えない値になりうるため）。
 */
export function normalizeRemote(raw: unknown): RemoteSettings {
  const def = defaultRemoteSettings();
  if (!isObject(raw)) return def;
  const pin = str(raw.pin, def.pin);
  const port = Math.round(num(raw.port, def.port));
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled,
    port: port >= 1024 && port <= 65535 ? port : def.port,
    pin: /^\d{4}$/.test(pin) ? pin : def.pin,
  };
}

/** 任意のオブジェクトを現行スキーマの AppSettings へ正規化する。 */
export function migrateAppSettings(raw: unknown): AppSettings {
  if (!isObject(raw)) return createDefaultAppSettings();
  return {
    version: APP_SETTINGS_VERSION,
    artnet: normalizeArtnet(raw.artnet),
    openDmx: normalizeOpenDmx(raw.openDmx),
    remote: normalizeRemote(raw.remote),
  };
}

/** アプリ設定を整形 JSON 文字列へ。 */
export function serializeAppSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2);
}

/** JSON 文字列をアプリ設定へ。壊れた入力は既定値へフォールバックする（起動を止めない）。 */
export function deserializeAppSettings(text: string): AppSettings {
  try {
    return migrateAppSettings(JSON.parse(text) as unknown);
  } catch {
    return createDefaultAppSettings();
  }
}
