/**
 * 再生パネル（§5.2/§5.3）。読込中 Show のマスター列を縦1本で表示する。
 * 単一の GO で先頭から順送り。GROUP エントリは子 CUE をインデント表示し、
 * GO で中を順送りする。各行クリックで goTo（頭出し・ループ脱出）。
 */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Copy,
  FastForward,
  GripVertical,
  Music,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Cue, SequenceEntry } from "../../shared/types";
import { useDmxStore } from "../store";

/**
 * ドラッグ並び替えの共有ハンドラ。
 * scope は 'top'（マスター列）か group.id（GROUP 内の子 CUE）。同 scope 内のみ並び替え可。
 */
interface Dnd {
  scope: string | null;
  overKey: string | null;
  /** 挿入位置（ホバー行の前 / 後ろ）。線＋矢印の表示位置に使う。 */
  overPos: "before" | "after" | null;
  start: (scope: string, id: string, fromIndex: number) => void;
  over: (scope: string, key: string, e: React.DragEvent) => void;
  drop: (scope: string, targetIndex: number, e: React.DragEvent) => void;
  end: () => void;
}

export function PlaybackPanel() {
  const project = useDmxStore((s) => s.project);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const playback = useDmxStore((s) => s.playback);
  const deselectCue = useDmxStore((s) => s.deselectCue);
  const editable = useDmxStore((s) => s.mode === "edit");
  // ドラッグ並び替え状態（同 scope 内のみ）。フック規則のため早期 return より前で宣言。
  const [dragging, setDragging] = useState<{
    scope: string;
    id: string;
    fromIndex: number;
  } | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<"before" | "after" | null>(null);
  // CUE が移動したら、現在行（data-current）をスクロール表示する。
  const listRef = useRef<HTMLDivElement>(null);
  const curMainPos = playback?.mainIndex ?? -1;
  const curSubPos = playback?.subIndex ?? 0;
  useEffect(() => {
    if (curMainPos < 0) return;
    const el = listRef.current?.querySelector('[data-current="true"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [curMainPos, curSubPos]);

  const activeShow = project?.shows.find((s) => s.id === activeShowId) ?? null;

  if (!activeShow) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-lg bg-neutral-900/40 text-sm text-neutral-600 ring-1 ring-neutral-800">
        <p>Show が読み込まれていません</p>
        <p className="mt-1 text-xs">
          上のバーで Show を選んで「読込」してください
        </p>
      </div>
    );
  }

  const showId = activeShow.id;
  const seq = activeShow.sequence;
  const curMain = playback?.mainIndex ?? -1;
  const dnd: Dnd = {
    scope: dragging?.scope ?? null,
    overKey,
    overPos,
    start: (scope, id, fromIndex) => setDragging({ scope, id, fromIndex }),
    over: (scope, key, e) => {
      if (!dragging || dragging.scope !== scope) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      // カーソルが行の上半分なら前へ、下半分なら後ろへ挿入。
      const rect = e.currentTarget.getBoundingClientRect();
      const pos: "before" | "after" =
        e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (overKey !== key) setOverKey(key);
      if (overPos !== pos) setOverPos(pos);
    },
    drop: (scope, targetIndex, e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragging && dragging.scope === scope) {
        // 挿入したいスロット（元配列基準）→ 自身を抜いた後の最終インデックスへ変換。
        const slot = overPos === "after" ? targetIndex + 1 : targetIndex;
        const toIndex = slot > dragging.fromIndex ? slot - 1 : slot;
        if (scope === "top") window.dmx.moveEntry(showId, dragging.id, toIndex);
        else window.dmx.moveCueInGroup(scope, dragging.id, toIndex);
      }
      setDragging(null);
      setOverKey(null);
      setOverPos(null);
    },
    end: () => {
      setDragging(null);
      setOverKey(null);
      setOverPos(null);
    },
  };
  const curSub = playback?.subIndex ?? 0;
  const fading = playback?.fading ?? false;
  const fadeProgress = playback?.fadeProgress ?? 1;
  const fadeRemainingMs = playback?.fadeRemainingMs ?? 0;

  return (
    <div className="flex h-full flex-col gap-2">
      {/* グローバル操作 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.dmx.goBack()}
          className="inline-flex items-center gap-1 rounded bg-neutral-700 px-4 py-2 text-base font-bold text-neutral-100 shadow hover:bg-neutral-600"
          title="マスター列を1つ戻す（←/Backspace）"
        >
          <ChevronLeft size={18} /> BACK
        </button>
        <button
          onClick={() => window.dmx.go()}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-8 py-2 text-base font-bold text-white shadow hover:bg-emerald-500"
          title="マスター列を次へ（Space/→）"
        >
          GO <Play size={18} fill="currentColor" />
        </button>
        <button
          onClick={() => window.dmx.holdFade()}
          disabled={!fading}
          className="inline-flex items-center gap-1 rounded bg-amber-700 px-4 py-2 text-base font-bold text-white shadow hover:bg-amber-600 disabled:opacity-30"
          title="進行中のフェードを現在値で停止（HOLD）"
        >
          <Pause size={16} fill="currentColor" /> HOLD
        </button>
        <button
          onClick={deselectCue}
          disabled={curMain < 0}
          className="inline-flex items-center gap-1 rounded bg-neutral-700 px-3 py-2 text-sm font-bold text-neutral-100 shadow hover:bg-neutral-600 disabled:opacity-30"
          title="CUE の選択を解除（プレイヘッドを未 GO に戻す）"
        >
          <X size={15} /> 選択解除
        </button>
        <span className="text-[10px] text-neutral-600">
          Space/→: GO ／ ←/Backspace: 戻る
        </span>
        <span className="ml-1 text-sm text-neutral-400">{activeShow.name}</span>
        <button
          onClick={() => window.dmx.recordCue(showId)}
          disabled={!editable}
          className="ml-auto inline-flex items-center gap-1 rounded bg-neutral-800 px-3 py-1.5 text-xs text-amber-300 hover:bg-neutral-700 disabled:opacity-40"
          title="現在のキャプチャから CUE をマスター列末尾に記録"
        >
          <Circle size={11} fill="currentColor" className="text-red-500" />{" "}
          Record CUE
        </button>
        <button
          onClick={() => window.dmx.addGroupEntry(showId)}
          disabled={!editable}
          className="inline-flex items-center gap-1 rounded bg-neutral-800 px-3 py-1.5 text-xs text-sky-300 hover:bg-neutral-700 disabled:opacity-40"
        >
          <Plus size={13} /> GROUP
        </button>
      </div>

      {/* マスター列 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto rounded-lg bg-neutral-900/60 p-2 ring-1 ring-neutral-800"
      >
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
                fadeProgress={fadeProgress}
                fadeRemainingMs={fadeRemainingMs}
                dnd={dnd}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function entryId(entry: SequenceEntry): string {
  return entry.kind === "cue" ? entry.cue.id : entry.group.id;
}

interface EntryRowProps {
  showId: string;
  entry: SequenceEntry;
  index: number;
  lastIndex: number;
  curMain: number;
  curSub: number;
  fading: boolean;
  fadeProgress: number;
  fadeRemainingMs: number;
  dnd: Dnd;
}

function EntryRow({
  showId,
  entry,
  index,
  lastIndex,
  curMain,
  curSub,
  fading,
  fadeProgress,
  fadeRemainingMs,
  dnd,
}: EntryRowProps) {
  const editable = useDmxStore((s) => s.mode === "edit");
  const moveUp = () => window.dmx.moveEntry(showId, entryId(entry), index - 1);
  const moveDown = () =>
    window.dmx.moveEntry(showId, entryId(entry), index + 1);
  const del = () => {
    if (entry.kind === "cue") {
      window.dmx.deleteEntry(showId, entryId(entry));
      return;
    }
    const msg = `GROUP「${entry.group.name ?? "Group"}」を削除しますか？\n（中の子 CUE もすべて削除されます）`;
    if (window.confirm(msg)) window.dmx.deleteEntry(showId, entryId(entry));
  };

  if (entry.kind === "cue") {
    const current = curMain === index;
    return (
      <li>
        <CueRow
          no={`${index + 1}`}
          cue={entry.cue}
          current={current}
          fading={current && fading}
          fadeProgress={fadeProgress}
          fadeRemainingMs={fadeRemainingMs}
          editable={editable}
          dnd={dnd}
          scope="top"
          dndIndex={index}
          dndId={entry.cue.id}
          onClick={() => window.dmx.goTo(index, 0)}
          onMoveUp={editable && index > 0 ? moveUp : undefined}
          onMoveDown={editable && index < lastIndex ? moveDown : undefined}
          onDelete={del}
          onDuplicate={() => window.dmx.duplicateEntry(showId, entry.cue.id)}
          onInsertBelow={() =>
            window.dmx.recordCue(showId, { atIndex: index + 1 })
          }
        />
      </li>
    );
  }

  // GROUP エントリ
  const g = entry.group;
  const groupOver = dnd.scope === "top" && dnd.overKey === `top:${g.id}`;
  return (
    <li
      className="relative rounded bg-neutral-800/30 ring-1 ring-neutral-800"
      onDragOver={(e) => dnd.over("top", `top:${g.id}`, e)}
      onDrop={(e) => dnd.drop("top", index, e)}
    >
      {groupOver && dnd.overPos && <DropIndicator pos={dnd.overPos} />}
      {/* GROUP ヘッダ */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Grip
          scope="top"
          id={g.id}
          index={index}
          dnd={dnd}
          editable={editable}
        />
        <span className="w-6 text-right font-mono text-xs text-neutral-500">
          {index + 1}
        </span>
        <span className="text-xs font-semibold text-sky-300">
          ▣ {g.name ?? "Group"}
        </span>
        <button
          onClick={() => window.dmx.setGroupLoop(g.id, !g.loop)}
          disabled={!editable}
          className={`rounded px-1.5 py-0.5 text-[10px] font-mono disabled:opacity-50 ${
            g.loop ? "bg-sky-700 text-white" : "bg-neutral-800 text-neutral-500"
          }`}
          title="GROUP 内ループ"
        >
          LOOP
        </button>
        <span className="text-[10px] text-neutral-600">
          {g.cues.length} CUE
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {editable && (
            <button
              onClick={() =>
                window.dmx.recordCue(showId, { targetGroupId: g.id })
              }
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-neutral-700"
              title="現在のキャプチャから、この GROUP に子 CUE を追加"
            >
              <Plus size={11} /> CUE
            </button>
          )}
          <MoveButtons
            onUp={editable && index > 0 ? moveUp : undefined}
            onDown={editable && index < lastIndex ? moveDown : undefined}
          />
          {editable && (
            <button
              onClick={() => window.dmx.duplicateEntry(showId, g.id)}
              className="inline-flex items-center rounded px-1 text-neutral-400 hover:bg-neutral-700"
              title="この GROUP を複製して直下に挿入"
            >
              <Copy size={12} />
            </button>
          )}
          {editable && <DeleteButton onClick={del} title="GROUP 削除" />}
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
                  fadeProgress={fadeProgress}
                  fadeRemainingMs={fadeRemainingMs}
                  editable={editable}
                  inGroup
                  dnd={dnd}
                  scope={g.id}
                  dndIndex={j}
                  dndId={cue.id}
                  onClick={() => window.dmx.goTo(index, j)}
                  onMoveUp={
                    editable && j > 0
                      ? () => window.dmx.moveCueInGroup(g.id, cue.id, j - 1)
                      : undefined
                  }
                  onMoveDown={
                    editable && j < g.cues.length - 1
                      ? () => window.dmx.moveCueInGroup(g.id, cue.id, j + 1)
                      : undefined
                  }
                  onDelete={() => window.dmx.deleteCueFromGroup(g.id, cue.id)}
                  onDuplicate={() =>
                    window.dmx.duplicateCueInGroup(g.id, cue.id)
                  }
                  onInsertBelow={() =>
                    window.dmx.recordCue(showId, {
                      targetGroupId: g.id,
                      atIndex: j + 1,
                    })
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* GROUP 外（マスター列）の直下に CUE を追加 */}
      {editable && (
        <div className="border-t border-neutral-800 px-2">
          <button
            onClick={() => window.dmx.recordCue(showId, { atIndex: index + 1 })}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-neutral-700"
            title="現在のキャプチャから、この GROUP の外（直下）に CUE を追加"
          >
            <Plus size={11} /> CUE
          </button>
        </div>
      )}
    </li>
  );
}

interface CueRowProps {
  no: string;
  cue: Cue;
  current: boolean;
  fading: boolean;
  fadeProgress: number;
  fadeRemainingMs: number;
  editable: boolean;
  /** GROUP の子 CUE か（自動送り Delay 欄を表示）。 */
  inGroup?: boolean;
  dnd: Dnd;
  scope: string;
  dndIndex: number;
  dndId: string;
  onClick: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onInsertBelow?: () => void;
}

function CueRow({
  no,
  cue,
  current,
  fading,
  fadeProgress,
  fadeRemainingMs,
  editable,
  inGroup,
  dnd,
  scope,
  dndIndex,
  dndId,
  onClick,
  onMoveUp,
  onMoveDown,
  onDelete,
  onDuplicate,
  onInsertBelow,
}: CueRowProps) {
  const channelCount = Object.keys(cue.values).length;
  const showLyric = editable || (cue.lyrics?.trim().length ?? 0) > 0;
  const overKey = `${scope}:${dndId}`;
  const over = dnd.scope === scope && dnd.overKey === overKey;
  const base = current
    ? fading
      ? "bg-amber-700/40"
      : "bg-sky-800/50"
    : "bg-neutral-800/40 hover:bg-neutral-800";
  const ring = current
    ? fading
      ? "ring-1 ring-amber-500"
      : "ring-1 ring-sky-600"
    : "";
  return (
    <div
      data-current={current || undefined}
      onClick={onClick}
      onDragOver={(e) => dnd.over(scope, overKey, e)}
      onDrop={(e) => dnd.drop(scope, dndIndex, e)}
      className={`relative flex cursor-pointer flex-col gap-0.5 rounded px-2 py-1 text-xs ${base} ${ring}`}
    >
      {over && dnd.overPos && <DropIndicator pos={dnd.overPos} />}
      <div className="flex items-center gap-1.5">
        <Grip
          scope={scope}
          id={dndId}
          index={dndIndex}
          dnd={dnd}
          editable={editable}
        />
        <span className="w-8 text-right font-mono text-neutral-500">{no}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <NameField cueId={cue.id} name={cue.name} editable={editable} />
          <span className="shrink-0 text-[10px] text-neutral-500">
            {channelCount}ch
          </span>
        </div>
        <FadeFields cue={cue} editable={editable} />
        {inGroup && <FollowField cue={cue} editable={editable} />}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-0.5"
        >
          <MoveButtons onUp={onMoveUp} onDown={onMoveDown} />
          {editable && onInsertBelow && (
            <button
              onClick={onInsertBelow}
              className="inline-flex items-center rounded px-1 text-amber-300/80 hover:bg-neutral-700"
              title="現在のキャプチャから、この直下に CUE を挿入"
            >
              <Plus size={13} />
            </button>
          )}
          {editable && onDuplicate && (
            <button
              onClick={onDuplicate}
              className="inline-flex items-center rounded px-1 text-neutral-400 hover:bg-neutral-700"
              title="この CUE を複製して直下に挿入"
            >
              <Copy size={12} />
            </button>
          )}
          {editable && <DeleteButton onClick={onDelete} title="CUE 削除" />}
        </div>
      </div>
      {showLyric && (
        <div className="flex items-center gap-1 pl-9">
          <Music size={11} className="shrink-0 text-neutral-600" />
          <LyricField cueId={cue.id} lyrics={cue.lyrics} editable={editable} />
        </div>
      )}
      {fading && (
        <div
          className="flex items-center gap-2 pl-9"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-700">
            <div
              className="h-full bg-amber-400 transition-[width] duration-200 ease-linear"
              style={{ width: `${Math.round(fadeProgress * 100)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] text-amber-300">
            {(fadeRemainingMs / 1000).toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  );
}

function NameField({
  cueId,
  name,
  editable,
}: {
  cueId: string;
  name?: string;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    window.dmx.updateCue(cueId, { name: draft.trim() });
    setEditing(false);
  };

  if (!editable) {
    return (
      <span className="truncate text-neutral-200">
        {name?.trim() ? name : "Cue"}
      </span>
    );
  }

  return editing ? (
    <input
      autoFocus
      value={draft}
      placeholder="CUE 名"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="min-w-0 flex-1 rounded bg-neutral-900 px-1 text-neutral-100 outline-none ring-1 ring-sky-500"
    />
  ) : (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setDraft(name ?? "");
        setEditing(true);
      }}
      className="min-w-0 truncate rounded px-1 text-left text-neutral-200 hover:bg-neutral-700"
      title="CUE 名を編集"
    >
      {name?.trim() ? name : <span className="text-neutral-500">名前なし</span>}
    </button>
  );
}

function LyricField({
  cueId,
  lyrics,
  editable,
}: {
  cueId: string;
  lyrics?: string;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    window.dmx.updateCue(cueId, { lyrics: draft });
    setEditing(false);
  };

  if (!editable) {
    return (
      <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-400">
        {lyrics}
      </span>
    );
  }

  return editing ? (
    <input
      autoFocus
      value={draft}
      placeholder="歌詞を入力"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="min-w-0 flex-1 rounded bg-neutral-900 px-1 text-[11px] text-neutral-100 outline-none ring-1 ring-sky-500"
    />
  ) : (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setDraft(lyrics ?? "");
        setEditing(true);
      }}
      className="min-w-0 flex-1 truncate rounded px-1 text-left text-[11px] text-neutral-400 hover:bg-neutral-700"
      title="歌詞を編集"
    >
      {lyrics?.trim() ? (
        lyrics
      ) : (
        <span className="text-neutral-600">歌詞を入力</span>
      )}
    </button>
  );
}

/** CUE のフェード/ディレイ時間（In / Out / Delay）をまとめて編集する。 */
function FadeFields({ cue, editable }: { cue: Cue; editable: boolean }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex shrink-0 items-center gap-0.5"
    >
      <MsField
        label="In"
        value={cue.fadeInMs}
        editable={editable}
        title="フェードイン時間 (ms)"
        onCommit={(ms) => window.dmx.updateCue(cue.id, { fadeInMs: ms })}
      />
      <MsField
        label="Out"
        value={cue.fadeOutMs}
        fallback={cue.fadeInMs}
        editable={editable}
        title="フェードアウト時間 (ms・空欄で In と同じに戻す)"
        onCommit={(ms) => window.dmx.updateCue(cue.id, { fadeOutMs: ms })}
        onClear={() => window.dmx.updateCue(cue.id, { fadeOutMs: null })}
      />
      <MsField
        label="Dly"
        value={cue.delayMs}
        fallback={0}
        editable={editable}
        title="ディレイ時間 (ms)"
        onCommit={(ms) => window.dmx.updateCue(cue.id, { delayMs: ms })}
      />
    </div>
  );
}

/**
 * GROUP 子 CUE の自動送り Delay（ms）。未設定=OFF（手動 GO 待ち）。
 * 設定すると SHOW モードでこの CUE を発火してから followMs 後に次の子 CUE へ自動で進む。
 */
function FollowField({ cue, editable }: { cue: Cue; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const has = cue.followMs !== undefined;

  const commit = () => {
    const t = draft.trim();
    if (t === "") {
      window.dmx.updateCue(cue.id, { followMs: null }); // OFF（自動送り解除）
    } else {
      const ms = Math.max(0, Math.round(Number(t)));
      if (Number.isFinite(ms)) window.dmx.updateCue(cue.id, { followMs: ms });
    }
    setEditing(false);
  };

  if (!editable) {
    if (!has) return null; // 本番表示では未設定（手動）は省略
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 px-0.5 font-mono text-[10px] text-emerald-400"
        title={`自動送り: ${cue.followMs}ms 後に次の子 CUE へ`}
      >
        <FastForward size={10} fill="currentColor" />
        {cue.followMs}
      </span>
    );
  }

  return editing ? (
    <input
      autoFocus
      inputMode="numeric"
      value={draft}
      placeholder="OFF"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-12 shrink-0 rounded bg-neutral-900 text-center font-mono text-[10px] text-neutral-100 outline-none ring-1 ring-emerald-500"
    />
  ) : (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setDraft(has ? String(cue.followMs) : "");
        setEditing(true);
      }}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 font-mono text-[10px] hover:bg-neutral-700 ${
        has ? "text-emerald-400" : "text-neutral-600"
      }`}
      title="自動送り Delay (ms)。次の子 CUE へ自動で進む。空欄で OFF（手動 GO）"
    >
      <FastForward size={10} fill="currentColor" />
      {has ? cue.followMs : "OFF"}
    </button>
  );
}

/**
 * ms 値をインライン編集する小フィールド。
 * value が未設定のとき: 編集モードでは fallback を淡色で表示、本番表示では非表示。
 */
function MsField({
  label,
  value,
  fallback,
  editable,
  title,
  onCommit,
  onClear,
}: {
  label: string;
  value: number | undefined;
  fallback?: number;
  editable: boolean;
  title: string;
  onCommit: (ms: number) => void;
  /** 指定時、空欄 commit で「未設定」へ戻す（fallback に従う）。 */
  onClear?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = value ?? fallback ?? 0;
  const isDefault = value === undefined;

  const commit = () => {
    if (onClear && draft.trim() === "") {
      onClear();
      setEditing(false);
      return;
    }
    const n = Math.max(0, Math.round(Number(draft)));
    if (Number.isFinite(n)) onCommit(n);
    setEditing(false);
  };

  if (!editable) {
    if (isDefault) return null; // 既定（In と同じ / 0）の項目は本番表示で省略
    return (
      <span
        className="px-0.5 font-mono text-[10px] text-neutral-500"
        title={title}
      >
        {label}
        {shown}
      </span>
    );
  }

  return editing ? (
    <input
      autoFocus
      inputMode="numeric"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-12 rounded bg-neutral-900 text-center font-mono text-[10px] text-neutral-100 outline-none ring-1 ring-sky-500"
    />
  ) : (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setDraft(String(shown));
        setEditing(true);
      }}
      className={`rounded px-1 font-mono text-[10px] hover:bg-neutral-700 ${
        isDefault ? "text-neutral-600" : "text-neutral-300"
      }`}
      title={title}
    >
      {label}
      {shown}
    </button>
  );
}

/**
 * ドロップ先を示す挿入インジケータ（線＋矢印）。
 * ホバー行の前/後ろの境界に水平線を引き、左端の ▶ で挿入位置を示す。
 */
function DropIndicator({ pos }: { pos: "before" | "after" }) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-20 flex items-center ${
        pos === "before" ? "-top-1" : "-bottom-1"
      }`}
    >
      <ChevronRight size={12} className="-ml-1 shrink-0 text-sky-400" />
      <span className="h-0.5 flex-1 rounded-full bg-sky-400 shadow-[0_0_4px_0] shadow-sky-400/70" />
    </div>
  );
}

/** ドラッグ並び替え用のつまみ（編集モードのみ）。 */
function Grip({
  scope,
  id,
  index,
  dnd,
  editable,
}: {
  scope: string;
  id: string;
  index: number;
  dnd: Dnd;
  editable: boolean;
}) {
  if (!editable) return null;
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        dnd.start(scope, id, index);
      }}
      onDragEnd={dnd.end}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex shrink-0 cursor-grab select-none items-center px-0.5 text-neutral-600 hover:text-neutral-300 active:cursor-grabbing"
      title="ドラッグで並び替え"
    >
      <GripVertical size={13} />
    </span>
  );
}

function MoveButtons({
  onUp,
  onDown,
}: {
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <>
      <button
        onClick={onUp}
        disabled={!onUp}
        className="inline-flex items-center rounded px-1 text-neutral-500 hover:bg-neutral-700 disabled:opacity-20"
        title="上へ"
      >
        <ChevronUp size={13} />
      </button>
      <button
        onClick={onDown}
        disabled={!onDown}
        className="inline-flex items-center rounded px-1 text-neutral-500 hover:bg-neutral-700 disabled:opacity-20"
        title="下へ"
      >
        <ChevronDown size={13} />
      </button>
    </>
  );
}

function DeleteButton({
  onClick,
  title,
}: {
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center rounded px-1 text-neutral-600 hover:bg-red-900/50 hover:text-red-300"
      title={title}
    >
      <X size={13} />
    </button>
  );
}
