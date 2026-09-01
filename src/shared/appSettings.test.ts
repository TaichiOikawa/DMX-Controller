import { describe, it, expect } from 'vitest';
import {
  APP_SETTINGS_VERSION,
  DEFAULT_REMOTE_PORT,
  createDefaultAppSettings,
  deserializeAppSettings,
  migrateAppSettings,
  serializeAppSettings,
} from './appSettings';

describe('appSettings', () => {
  it('starts with Art-Net off / OpenDMX off / remote off', () => {
    const s = createDefaultAppSettings();
    expect(s.version).toBe(APP_SETTINGS_VERSION);
    expect(s.artnet.enabled).toBe(false);
    expect(s.openDmx).toEqual({ enabled: false, portPath: '', kind: 'opendmx' });
    expect(s.remote).toEqual({ enabled: false, port: DEFAULT_REMOTE_PORT, pin: '' });
  });

  it('round-trips through JSON', () => {
    const s = createDefaultAppSettings();
    s.artnet.targetIp = '192.168.0.30';
    s.openDmx = { enabled: true, portPath: 'COM7', kind: 'pico' };
    s.remote = { enabled: true, port: 4040, pin: '0421' };
    expect(deserializeAppSettings(serializeAppSettings(s))).toEqual(s);
  });

  it('falls back to defaults for missing / malformed fields', () => {
    const def = createDefaultAppSettings();
    expect(migrateAppSettings({})).toEqual(def);
    expect(migrateAppSettings(null)).toEqual(def);
    expect(deserializeAppSettings('not json')).toEqual(def);
    const s = migrateAppSettings({
      artnet: { universe: 99, refreshRateHz: 0, targetIp: 7 },
      openDmx: { enabled: 'yes', portPath: 42 },
      remote: { enabled: 1, port: 0, pin: 'abcd' },
    });
    expect(s.artnet.universe).toBe(15); // 0-15 へクランプ
    expect(s.artnet.refreshRateHz).toBe(1); // 1-60 へクランプ
    expect(s.artnet.targetIp).toBe(def.artnet.targetIp);
    expect(s.openDmx).toEqual(def.openDmx);
    expect(s.remote).toEqual(def.remote);
  });

  it('kind の無い旧 settings.json は opendmx 扱いにする', () => {
    // 後から足したフィールドなので、既存ユーザーの挙動を変えてはいけない。
    const s = migrateAppSettings({ openDmx: { enabled: true, portPath: 'COM3' } });
    expect(s.openDmx).toEqual({ enabled: true, portPath: 'COM3', kind: 'opendmx' });
    // 知らない値も opendmx へ倒す。
    expect(migrateAppSettings({ openDmx: { kind: 'ftdi' } }).openDmx.kind).toBe('opendmx');
    expect(migrateAppSettings({ openDmx: { kind: 'pico' } }).openDmx.kind).toBe('pico');
  });

  it('keeps only a 4-digit PIN', () => {
    expect(migrateAppSettings({ remote: { pin: '0007' } }).remote.pin).toBe('0007');
    expect(migrateAppSettings({ remote: { pin: '12345' } }).remote.pin).toBe('');
  });
});
