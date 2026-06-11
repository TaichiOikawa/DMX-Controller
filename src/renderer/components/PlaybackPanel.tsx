/**
 * 再生パネル（§5.2/§5.3）。読込中 Show のマスター列を縦1本で表示する。
 * 単一の GO で先頭から順送り。GROUP エントリは子 CUE をインデント表示し、
 * GO で中を順送りする。各行クリックで goTo（頭出し・ループ脱出）。
 */

import { useState } from 'react';
import type { Cue, SequenceEntry } from '../../shared/types';
import { useDmxStore } from '../store';

export function PlaybackPanel() {
  const project = useDmxStore((s) => s.project);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const playback = useDmxStore((s) => s.playback);

  const activeShow = project?.shows.find((s) => s.id === activeShowId) ?? null;

  if (!activeShow) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-lg bg-neutral-900/40 text-sm text-neutral-600 ring-1 ring-neutral-800">
        <p>Show が読み込まれていません</p>
        <p className="mt-1 text-xs">上のバーで Show を選んで「読込」してください</p>
      </div>
    );
  }

  const showId = activeShow.id;
  const seq = activeShow.sequence;
  const curMain = playback?.mainIndex ?? -1;
  const curSub = playback?.subIndex ?? 0;
  const fading = playback?.fading ?? false;

  return (
    <div className="flex h-full flex-col gap-2">
      {/* グローバル操作 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.dmx.go()}
          className="rounded bg-emerald-600 px-8 py-2 text-base font-bold text-white shadow hover:bg-emerald-500"
          title="マスター列を次へ"
        >
          GO
        </button>
        <span className="text-sm text-neutral-400">{activeShow.name}</span>
        <button
          onClick={() => window.dmx.recordCue(showId)}
          className="ml-auto rounded bg-neutral-800 px-3 py-1.5 text-xs text-amber-300 hover:bg-neutral-700"
          title="現在のフェーダー（非ゼロ）から CUE をマスター列末尾に記録"
        >
          ● Record CUE
        </button>
        <button
          onClick={() => window.dmx.addGroupEntry(showId)}
          className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-sky-300 hover:bg-neutral-700"
        >
          ＋ GROUP
        </button>
      </div>

      {/* マスター列 */}
      <div className="flex-1 overflow-y-auto rounded-lg bg-neutral-900/60 p-2 ring-1 ring-neutral-800">
        {seq.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-neutral-600">
            まだ空です。フェーダーを動かして「Record CUE」で記録してください。
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {seq.map((entry, i) => (
              <EntryRow
                key={entryId(entry)}
                showId={showId}
                entry={entry}
                index={i}
                lastIndex={seq.length - 1}
                curMain={curMain}
                curSub={curSub}
                fading={fading}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function entryId(entry: SequenceEntry): string {
  return entry.kind === 'cue' ? entry.cue.id : entry.group.id;
}

interface EntryRowProps {
  showId: string;
  entry: SequenceEntry;
  index: number;
  lastIndex: number;
  curMain: number;
  curSub: number;
  fading: boolean;
}

function EntryRow({ showId, entry, index, lastIndex, curMain, curSub, fading }: EntryRowProps) {
  const moveUp = () => window.dmx.moveEntry(showId, entryId(entry), index - 1);
  const moveDown = () => window.dmx.moveEntry(showId, entryId(entry), index + 1);
  const del = () => window.dmx.deleteEntry(showId, entryId(entry));

  if (entry.kind === 'cue') {
    const current = curMain === index;
    return (
      <li>
        <CueRow
          no={`${index + 1}`}
          cue={entry.cue}
          current={current}
          fading={current && fading}
          onClick={() => window.dmx.goTo(index, 0)}
          onMoveUp={index > 0 ? moveUp : undefined}
          onMoveDown={index < lastIndex ? moveDown : undefined}
          onDelete={del}
        />
      </li>
    );
  }

  // GROUP エントリ
  const g = entry.group;
  return (
    <li className="rounded bg-neutral-800/30 ring-1 ring-neutral-800">
      {/* GROUP ヘッダ */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="w-6 text-right font-mono text-xs text-neutral-500">{index + 1}</span>
        <span className="text-xs font-semibold text-sky-300">▣ {g.name ?? 'Group'}</span>
        <button
          onClick={() => window.dmx.setGroupLoop(g.id, !g.loop)}
          className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
            g.loop ? 'bg-sky-700 text-white' : 'bg-neutral-800 text-neutral-500'
          }`}
          title="GROUP 内ループ"
        >
          LOOP
        </button>
        <span className="text-[10px] text-neutral-600">{g.cues.length} CUE</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => window.dmx.recordCue(showId, { targetGroupId: g.id })}
            className="rounded px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-neutral-700"
            title="現在のフェーダーから、この GROUP に子 CUE を追加"
          >
            ＋CUE
          </button>
          <MoveButtons onUp={index > 0 ? moveUp : undefined} onDown={index < lastIndex ? moveDown : undefined} />
          <DeleteButton onClick={del} title="GROUP 削除" />
        </div>
      </div>

      {/* 子 CUE */}
      {g.cues.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-neutral-800 py-1 pl-6 pr-1">
          {g.cues.map((cue, j) => {
            const current = curMain === index && curSub === j;
            return (
              <li key={cue.id}>
                <CueRow
                  no={`${index + 1}.${j + 1}`}
                  cue={cue}
                  current={current}
                  fading={current && fading}
                  onClick={() => window.dmx.goTo(index, j)}
                  onMoveUp={j > 0 ? () => window.dmx.moveCueInGroup(g.id, cue.id, j - 1) : undefined}
                  onMoveDown={
                    j < g.cues.length - 1
                      ? () => window.dmx.moveCueInGroup(g.id, cue.id, j + 1)
                      : undefined
                  }
                  onDelete={() => window.dmx.deleteCueFromGroup(g.id, cue.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

interface CueRowProps {
  no: string;
  cue: Cue;
  current: boolean;
  fading: boolean;
  onClick: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
}

function CueRow({ no, cue, current, fading, onClick, onMoveUp, onMoveDown, onDelete }: CueRowProps) {
  const channelCount = Object.keys(cue.values).length;
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs ${
        current
          ? fading
            ? 'bg-amber-700/40 ring-1 ring-amber-500'
            : 'bg-sky-800/50 ring-1 ring-sky-600'
          : 'bg-neutral-800/40 hover:bg-neutral-800'
      }`}
    >
      <span className="w-8 text-right font-mono text-neutral-500">{no}</span>
      <span className="flex-1 truncate text-neutral-200">
        {cue.name ?? 'Cue'}
        <span className="ml-1 text-[10px] text-neutral-500">{channelCount}ch</span>
      </span>
      <FadeField cueId={cue.id} fadeInMs={cue.fadeInMs} />
      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5">
        <MoveButtons onUp={onMoveUp} onDown={onMoveDown} />
        <DeleteButton onClick={onDelete} title="CUE 削除" />
      </div>
    </div>
  );
}

function FadeField({ cueId, fadeInMs }: { cueId: string; fadeInMs: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const n = Math.max(0, Math.round(Number(draft)));
    if (Number.isFinite(n)) window.dmx.updateCue(cueId, { fadeInMs: n });
    setEditing(false);
  };

  return editing ? (
    <input
      autoFocus
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-14 rounded bg-neutral-900 text-center font-mono text-[11px] text-neutral-100 outline-none ring-1 ring-sky-500"
    />
  ) : (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setDraft(String(fadeInMs));
        setEditing(true);
      }}
      className="rounded px-1 font-mono text-[11px] text-neutral-400 hover:bg-neutral-700"
      title="フェード時間 (ms)"
    >
      {fadeInMs}ms
    </button>
  );
}

function MoveButtons({ onUp, onDown }: { onUp?: () => void; onDown?: () => void }) {
  return (
    <>
      <button
        onClick={onUp}
        disabled={!onUp}
        className="rounded px-1 text-neutral-500 hover:bg-neutral-700 disabled:opacity-20"
        title="上へ"
      >
        ▲
      </button>
      <button
        onClick={onDown}
        disabled={!onDown}
        className="rounded px-1 text-neutral-500 hover:bg-neutral-700 disabled:opacity-20"
        title="下へ"
      >
        ▼
      </button>
    </>
  );
}

function DeleteButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      className="rounded px-1 text-neutral-600 hover:bg-red-900/50 hover:text-red-300"
      title={title}
    >
      ✕
    </button>
  );
}
