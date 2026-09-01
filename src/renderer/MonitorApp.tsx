/**
 * 音量モニター（別ウィンドウ #monitor のルート）。
 *
 * メインウィンドウの Web Audio グラフ（store.ts）の analyser から算出された
 * ミックス済み出力レベルを IPC（onAudioLevels）で受け取り、ステレオの
 * ピーク + RMS メーター（dB スケール・ピークホールド・クリップ表示）を描画する。
 * メインとは別 renderer コンテキストなので AudioContext は共有できず、レベル値のみ購読する。
 */

import { Volume2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AudioLevels } from '../shared/ipc';

const MIN_DB = -60;

/** 振幅(0..1) を dB 経由でメーター充填率(0..1) へ変換。 */
function ampToFrac(amp: number): number {
  if (amp <= 0) return 0;
  const db = 20 * Math.log10(amp);
  if (db <= MIN_DB) return 0;
  if (db >= 0) return 1;
  return (db - MIN_DB) / -MIN_DB;
}

interface ChannelDisp {
  rms: number;
  peak: number;
  hold: number;
  holdAt: number;
}

export function MonitorApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<AudioLevels>({ peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 });

  useEffect(() => {
    const off = window.dmx.onAudioLevels((lv) => {
      levelsRef.current = lv;
    });

    const L: ChannelDisp = { rms: 0, peak: 0, hold: 0, holdAt: 0 };
    const R: ChannelDisp = { rms: 0, peak: 0, hold: 0, holdAt: 0 };
    let raf = 0;

    const stepChannel = (d: ChannelDisp, rmsAmp: number, peakAmp: number, now: number): void => {
      const rms = ampToFrac(rmsAmp);
      const peak = ampToFrac(peakAmp);
      // RMS は上りは速く・下りはゆっくり（バリスティクス風）。
      d.rms = rms > d.rms ? rms : d.rms + (rms - d.rms) * 0.3;
      // ピークは即時上昇・緩やかに減衰。
      d.peak = peak > d.peak ? peak : d.peak * 0.9;
      // ピークホールド：最大値を一定時間保持してから落とす。
      if (peak >= d.hold) {
        d.hold = peak;
        d.holdAt = now;
      } else if (now - d.holdAt > 1200) {
        d.hold = Math.max(0, d.hold - 0.01);
      }
    };

    const draw = (): void => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const now = performance.now();
        const lv = levelsRef.current;
        stepChannel(L, lv.rmsL, lv.peakL, now);
        stepChannel(R, lv.rmsR, lv.peakR, now);

        ctx.clearRect(0, 0, w, h);

        const padTop = 18;
        const padBottom = 16;
        const meterH = h - padTop - padBottom;
        const gap = 8;
        const labelW = 20;
        const barW = (w - labelW - gap) / 2;

        // dB 目盛り。数値は左のラベル列に置き、目盛り線はバー上へ引く
        // （幅を詰めてもバーに数字が重ならないように）。
        ctx.font = '9px monospace';
        ctx.fillStyle = '#525252';
        ctx.textAlign = 'right';
        for (const db of [0, -6, -12, -24, -48]) {
          const frac = (db - MIN_DB) / -MIN_DB;
          const y = padTop + (1 - frac) * meterH;
          ctx.fillText(`${db}`, labelW - 3, y + 3);
          ctx.strokeStyle = '#262626';
          ctx.beginPath();
          ctx.moveTo(labelW, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        const drawBar = (x: number, d: ChannelDisp, name: string): void => {
          // 背景。
          ctx.fillStyle = '#171717';
          ctx.fillRect(x, padTop, barW, meterH);

          // RMS 充填（緑→黄→赤のグラデーション）。
          const grad = ctx.createLinearGradient(0, padTop + meterH, 0, padTop);
          grad.addColorStop(0, '#22c55e');
          grad.addColorStop(0.7, '#22c55e');
          grad.addColorStop(0.85, '#eab308');
          grad.addColorStop(1, '#ef4444');
          ctx.fillStyle = grad;
          const fillH = d.rms * meterH;
          ctx.fillRect(x, padTop + meterH - fillH, barW, fillH);

          // ピーク（細い縦位置インジケータ）。
          if (d.peak > 0) {
            const py = padTop + (1 - d.peak) * meterH;
            ctx.fillStyle = '#a3e635';
            ctx.fillRect(x, py - 1, barW, 2);
          }
          // ピークホールド線。
          if (d.hold > 0) {
            const hy = padTop + (1 - d.hold) * meterH;
            ctx.fillStyle = d.hold >= 0.999 ? '#ef4444' : '#fafafa';
            ctx.fillRect(x, hy - 1, barW, 2);
          }

          // クリップ表示（0 dBFS 到達）。
          ctx.fillStyle = d.hold >= 0.999 ? '#ef4444' : '#3f3f46';
          ctx.fillRect(x, padTop - 6, barW, 4);

          // チャンネル名。
          ctx.fillStyle = '#a1a1aa';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(name, x + barW / 2, h - 4);
        };

        drawBar(labelW, L, 'L');
        drawBar(labelW + barW + gap, R, 'R');
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 px-2 py-2 text-xs font-semibold text-sky-400">
        <Volume2 size={14} /> 音量モニター
      </header>
      <div className="min-h-0 flex-1 px-2 py-3">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
      <footer className="shrink-0 border-t border-neutral-800 px-2 py-1.5 text-[10px] leading-tight text-neutral-500">
        ミックス出力 / dBFS
      </footer>
    </div>
  );
}
