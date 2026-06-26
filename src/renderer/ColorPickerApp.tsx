/**
 * RGB カラーピッカー（別ウィンドウ #picker のルート）。
 *
 * メインウィンドウとは別の renderer コンテキスト（ストアも別）なので、
 * エンジンからの project（フィクスチャ定義）と outputFrame（実出力値）を直接購読する。
 * スウォッチの色は「実際の出力(output)」を基準に表示し、選んだ色は
 * window.dmx.setFader で R/G/B チャンネルへ反映する（メイン側と同じ経路）。
 */

import { Palette } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hexToRgb, rgbToHex } from './color';
import type { Project, RgbFixture } from '../shared/types';
import { UNIVERSE_SIZE } from '../shared/types';

export function ColorPickerApp() {
  const [fixtures, setFixtures] = useState<RgbFixture[]>([]);
  const [output, setOutput] = useState<number[]>(() => new Array(UNIVERSE_SIZE).fill(0));
  // 全体一括設定用の選択色（ローカル状態。各フィクスチャの色はバラバラになり得るため独立して保持）。
  const [allHex, setAllHex] = useState('#ffffff');

  useEffect(() => {
    const applyProject = (p: Project) => setFixtures(p.fixtures ?? []);
    const offProject = window.dmx.onProject(applyProject);
    const offFrame = window.dmx.onOutputFrame((frame) => setOutput(frame));
    // 初期フィクスチャを取得して反映（フレームは購読後すぐ届く）。
    window.dmx.getProject().then(applyProject);
    return () => {
      offProject();
      offFrame();
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 px-3 py-2 text-xs font-semibold text-sky-400">
        <Palette size={14} /> RGB ピッカー
      </header>

      {fixtures.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-neutral-500">
          フィクスチャ未登録です。メインウィンドウの環境設定で RGB フィクスチャを追加してください。
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-900/40 px-3 py-2">
            <input
              type="color"
              value={allHex}
              onChange={(e) => {
                const nextHex = e.target.value;
                setAllHex(nextHex);
                const { r, g, b } = hexToRgb(nextHex);
                for (const fx of fixtures) {
                  window.dmx.setFader(fx.r, r);
                  window.dmx.setFader(fx.g, g);
                  window.dmx.setFader(fx.b, b);
                }
              }}
              className="h-10 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
              title="全フィクスチャの色を一括設定"
            />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-xs font-semibold text-neutral-200">全体一括</span>
              <span className="font-mono text-[9px] uppercase text-neutral-600">{allHex}</span>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-3">
          {fixtures.map((fx) => {
            const hex = rgbToHex(output[fx.r] ?? 0, output[fx.g] ?? 0, output[fx.b] ?? 0);
            const apply = (nextHex: string) => {
              const { r, g, b } = hexToRgb(nextHex);
              window.dmx.setFader(fx.r, r);
              window.dmx.setFader(fx.g, g);
              window.dmx.setFader(fx.b, b);
            };
            return (
              <div
                key={fx.id}
                className="flex items-center gap-2 rounded-lg bg-neutral-900/60 p-2 ring-1 ring-neutral-800"
              >
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => apply(e.target.value)}
                  className="h-10 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  title={`${fx.name ?? 'Fixture'} の色を選択（R:CH${fx.r + 1} G:CH${fx.g + 1} B:CH${fx.b + 1}）`}
                />
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-xs text-neutral-200">{fx.name ?? 'Fixture'}</span>
                  <span className="font-mono text-[9px] text-neutral-500">
                    {fx.r + 1}/{fx.g + 1}/{fx.b + 1}
                  </span>
                  <span className="font-mono text-[9px] uppercase text-neutral-600">{hex}</span>
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}
    </div>
  );
}
