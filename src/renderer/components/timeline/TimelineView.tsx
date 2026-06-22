/**
 * Timeline タブ本体（§5.5・内部タイムコード）。
 * リファレンス（DMX-TimelineController）の横スクロール・トラックビューを、本プロジェクトの
 * 「GO点モデル」に合わせて再構成したもの:
 *   - ルーラー / 赤プレイヘッド / ズーム
 *   - GO ポイントをマーカー表示（クリック=シーク・ドラッグ=移動・✕=削除）
 *   - WaveSurfer 音声波形＋プレイヘッド同期再生（実再生はストアの <audio>）
 *
 * トランスポート（再生/シーク/停止）と音声クロックはストアが所有する。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDmxStore } from '../../store';
import { TimeRuler } from './TimeRuler';
import { Playhead } from './Playhead';
import { GoMarkers } from './GoMarkers';
import { AudioTrack } from './AudioTrack';
import { timeToPx, formatTimecode } from './utils';

function mimeFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop();
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/*';
  }
}

export function TimelineView() {
  const project = useDmxStore((s) => s.project);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const transport = useDmxStore((s) => s.transport);
  const play = useDmxStore((s) => s.transportPlay);
  const pause = useDmxStore((s) => s.transportPause);
  const stop = useDmxStore((s) => s.transportStop);
  const seek = useDmxStore((s) => s.transportSeek);
  const loadAudio = useDmxStore((s) => s.loadAudio);
  const unloadAudio = useDmxStore((s) => s.unloadAudio);
  const editable = useDmxStore((s) => s.mode === 'edit');

  const [zoom, setZoom] = useState(1);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMs, setAudioMs] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const show = project?.shows.find((s) => s.id === activeShowId) ?? null;
  const points = show?.timeline?.points ?? [];
  const filePath = show?.audio?.filePath ?? null;
  const loaded = show !== null;
  const scale = useMemo(() => ({ zoom }), [zoom]);
  const durationMs = Math.max(transport.durationMs, audioMs);

  // 音声ファイルが設定されたらバイト列を取得して Blob URL 化、ストアの <audio> へ読み込む。
  // setState は非同期コールバックと cleanup でのみ呼ぶ（同期 setState によるカスケード再描画を回避）。
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (filePath) {
      window.dmx.readAudioFile(filePath).then((res) => {
        if (cancelled || !res.ok || !res.data) return;
        const url = URL.createObjectURL(new Blob([res.data], { type: mimeFor(filePath) }));
        createdUrl = url;
        setAudioUrl(url);
        loadAudio(url);
      });
    }
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setAudioUrl(null);
      setAudioMs(0);
      unloadAudio();
    };
  }, [filePath, loadAudio, unloadAudio]);

  // 再生中、プレイヘッドが表示域の右端を超えたら追従スクロール。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !transport.playing) return;
    const headPx = timeToPx(transport.playheadMs, scale);
    const right = el.scrollLeft + el.clientWidth;
    if (headPx > right - 80 || headPx < el.scrollLeft) {
      el.scrollLeft = Math.max(0, headPx - el.clientWidth * 0.5);
    }
  }, [transport.playheadMs, transport.playing, scale]);

  const contentWidth = timeToPx(durationMs, scale);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* トランスポート行 */}
      <div className="flex items-center gap-3 rounded-lg bg-neutral-900/60 px-3 py-2 ring-1 ring-neutral-800">
        <div className="flex items-center gap-1">
          {transport.playing ? (
            <button
              onClick={pause}
              disabled={!loaded}
              className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-amber-300 hover:bg-neutral-700 disabled:opacity-40"
              title="一時停止"
            >
              ⏸
            </button>
          ) : (
            <button
              onClick={play}
              disabled={!loaded}
              className="rounded bg-emerald-700 px-2.5 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-40"
              title="再生"
            >
              ▶
            </button>
          )}
          <button
            onClick={stop}
            disabled={!loaded}
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
            title="停止（先頭へ）"
          >
            ⏹
          </button>
        </div>

        <span className="font-mono text-xs text-neutral-200">{formatTimecode(transport.playheadMs)}</span>
        <span className="font-mono text-[10px] text-neutral-500">/ {formatTimecode(durationMs)}</span>

        <button
          onClick={() => activeShowId && window.dmx.addTimelinePoint(activeShowId, transport.playheadMs)}
          disabled={!editable}
          className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-amber-300 hover:bg-neutral-700 disabled:opacity-40"
          title="現在位置に GO ポイントを追加"
        >
          ＋GO点
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* 音声 */}
          <button
            onClick={() => activeShowId && window.dmx.pickShowAudio(activeShowId)}
            disabled={!loaded}
            className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-emerald-300 hover:bg-neutral-700 disabled:opacity-40"
            title="音声ファイルを選択"
          >
            🎵 音声
          </button>
          {filePath && (
            <button
              onClick={() => activeShowId && window.dmx.clearShowAudio(activeShowId)}
              className="rounded px-1.5 py-1 text-[11px] text-neutral-500 hover:text-red-400"
              title="音声を解除"
            >
              ✕
            </button>
          )}
          {/* ズーム */}
          <span className="text-[10px] text-neutral-500">zoom</span>
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-28 accent-sky-500"
          />
        </div>
      </div>

      {/* トラックビュー（横スクロール） */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-lg bg-neutral-900/60 ring-1 ring-neutral-800">
        <div className="relative" style={{ width: contentWidth, minWidth: '100%' }}>
          <TimeRuler durationMs={durationMs} scale={scale} onSeek={seek} playing={transport.playing} />

          {/* GO トラック */}
          <div className="relative h-8 border-b border-neutral-800 bg-neutral-900/40">
            {!loaded && (
              <span className="absolute left-2 top-1.5 text-[11px] text-neutral-600">
                Show を読み込むと GO 点を編集できます
              </span>
            )}
            <GoMarkers
              showId={activeShowId ?? ''}
              points={points}
              durationMs={durationMs}
              scale={scale}
              editable={editable}
              onSeek={seek}
            />
          </div>

          {/* 音声トラック */}
          <div className="p-1">
            <AudioTrack audioUrl={audioUrl} scale={scale} onDurationMs={setAudioMs} />
          </div>

          {/* プレイヘッド（全高オーバーレイ） */}
          <Playhead playheadMs={transport.playheadMs} durationMs={durationMs} scale={scale} onSeek={seek} />
        </div>
      </div>
    </div>
  );
}
