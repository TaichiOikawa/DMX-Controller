/**
 * アプリ設定（Art-Net / OpenDMX / リモート操作）のファイル永続化。
 *
 * 保存先は userData/settings.json（Windows なら %APPDATA%/<app>/settings.json）。
 * Project ファイルとは独立で、どの Project を開いても・開かなくても同じ設定が効く。
 *
 * 書き込みは短時間の連続更新（IP 入力中など）を束ねるためデバウンスし、
 * アプリ終了時は取りこぼさないよう同期書き出しで締める。
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  createDefaultAppSettings,
  deserializeAppSettings,
  serializeAppSettings,
  type AppSettings,
  type RemoteSettings,
} from '../shared/appSettings';
import type { ArtnetSettings, OpenDmxSettings } from '../shared/types';

/** 連続更新を束ねる書き込み遅延（ms）。 */
const SAVE_DEBOUNCE_MS = 400;

export class AppSettingsStore {
  private readonly filePath: string;
  private settings: AppSettings;
  /** 起動時にファイルが存在したか。false のとき旧 Project からの一度きりの移行を許す。 */
  private readonly existedAtStartup: boolean;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 未書き出しの変更があるか（flush で同期書き出しするか判定）。 */
  private pending = false;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath('userData'), 'settings.json');
    let existed = false;
    let settings = createDefaultAppSettings();
    try {
      const text = fs.readFileSync(this.filePath, 'utf-8');
      settings = deserializeAppSettings(text);
      existed = true;
    } catch {
      // 初回起動 / 読めない → 既定値で始める（次の保存でファイルが作られる）。
    }
    this.settings = settings;
    this.existedAtStartup = existed;
  }

  /** 現在のアプリ設定（コピー）。 */
  get(): AppSettings {
    return {
      version: this.settings.version,
      artnet: { ...this.settings.artnet },
      openDmx: { ...this.settings.openDmx },
      remote: { ...this.settings.remote },
    };
  }

  getArtnet(): ArtnetSettings {
    return { ...this.settings.artnet };
  }

  getOpenDmx(): OpenDmxSettings {
    return { ...this.settings.openDmx };
  }

  getRemote(): RemoteSettings {
    return { ...this.settings.remote };
  }

  /** 起動時に設定ファイルが無かった（= このアプリでの初回起動）か。 */
  isFirstRun(): boolean {
    return !this.existedAtStartup;
  }

  setArtnet(artnet: ArtnetSettings): void {
    this.settings.artnet = { ...artnet };
    this.scheduleSave();
  }

  setOpenDmx(openDmx: OpenDmxSettings): void {
    this.settings.openDmx = { ...openDmx };
    this.scheduleSave();
  }

  setRemote(patch: Partial<RemoteSettings>): void {
    this.settings.remote = { ...this.settings.remote, ...patch };
    this.scheduleSave();
  }

  /** 遅延書き込みを予約する（既存の予約があれば張り替え）。 */
  private scheduleSave(): void {
    this.pending = true;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.write();
    }, SAVE_DEBOUNCE_MS);
  }

  /** 予約済みの書き込みを即座に確定する（アプリ終了時に呼ぶ）。 */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.pending) this.write();
  }

  /** 同期書き出し。失敗しても致命的ではないのでログのみ。 */
  private write(): void {
    this.pending = false;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, serializeAppSettings(this.settings), 'utf-8');
    } catch (e) {
      console.error('[appSettings] save failed:', e);
    }
  }
}
