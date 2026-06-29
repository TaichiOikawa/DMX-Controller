/**
 * 出力（audiooutput）デバイス一覧を提供するフック。
 * デバイス「名」を露出するにはメディア権限が要るため、起動時に一度 getUserMedia を裏で叩いて即解放し、
 * その後 enumerateDevices で audiooutput を取得する。デバイスの抜き差し（devicechange）にも追従する。
 * 既定デバイスは deviceId='' の擬似エントリ「既定デバイス」として先頭に置く。
 */

import { useEffect, useState } from 'react';

export interface AudioOutputDevice {
  /** '' = OS 既定。 */
  deviceId: string;
  label: string;
}

const DEFAULT_DEVICE: AudioOutputDevice = { deviceId: '', label: '既定デバイス' };

export function useAudioOutputDevices(): AudioOutputDevice[] {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([DEFAULT_DEVICE]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const outs = list
          .filter((d) => d.kind === 'audiooutput')
          // 'default' / 'communications' は実デバイスの別名なので除外（先頭の既定エントリで代替）。
          .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `出力 ${i + 1}` }));
        setDevices([DEFAULT_DEVICE, ...outs]);
      } catch {
        // 列挙不可は無視（既定のみ）。
      }
    };

    // 名前解放のためマイク権限を一度だけ取得→即停止（best-effort）。
    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {})
      .finally(() => void refresh());

    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
    };
  }, []);

  return devices;
}
