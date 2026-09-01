/**
 * 左サイドの Project / Show ツリー。
 * ファイルシステム風に Project（📁 ルート）→ フォルダ（📂）→ Show（📄）を表示し、
 * 選択・読込・解放・リネーム・新規・フォルダ整理を行う。
 * `sidebarCollapsed` で折りたたみ（FaderBank と同パターン）。並び順は showSort（表示専用）。
 */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileMusic,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ListMusic,
  Plus,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDmxStore, type ShowSort } from '../store';
import { InlineText } from './InlineText';
import {
  fileExportLyrics,
  fileExportShow,
  fileImportShow,
  fileNewProject,
  fileOpenProject,
  fileSaveProjectAs,
} from '../projectFileOps';
import type { Folder, Show } from '../../shared/types';

/** 右クリックメニュー状態（画面座標）。Show / フォルダ / セットリスト用の判別共用体。 */
type CtxMenu =
  | { kind: 'show'; id: string; name: string; folderId?: string; x: number; y: number }
  | { kind: 'folder'; id: string; name: string; x: number; y: number }
  | { kind: 'setlist'; id: string; name: string; x: number; y: number };

/** name でソート（manual は元の順序を保持）。 */
function sortByName<T extends { name: string }>(list: T[], sort: ShowSort): T[] {
  if (sort === 'manual') return list;
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  if (sort === 'name-desc') sorted.reverse();
  return sorted;
}

export function ProjectSidebar() {
  const project = useDmxStore((s) => s.project);
  const selectedShowId = useDmxStore((s) => s.selectedShowId);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const selectShow = useDmxStore((s) => s.selectShow);
  const activeSetlistId = useDmxStore((s) => s.activeSetlistId);
  const selectedSetlistId = useDmxStore((s) => s.selectedSetlistId);
  const selectSetlist = useDmxStore((s) => s.selectSetlist);
  const loadSetlist = useDmxStore((s) => s.loadSetlist);
  const unloadSetlist = useDmxStore((s) => s.unloadSetlist);
  const mode = useDmxStore((s) => s.mode);
  const projectPath = useDmxStore((s) => s.projectPath);
  const collapsed = useDmxStore((s) => s.sidebarCollapsed);
  // 幅は可変レイアウト（App のスプリッタで変更・localStorage 永続化）。
  const width = useDmxStore((s) => s.panelLayout.sidebarWidth);
  const toggleCollapsed = useDmxStore((s) => s.toggleSidebarCollapsed);
  const showSort = useDmxStore((s) => s.showSort);
  const setShowSort = useDmxStore((s) => s.setShowSort);
  const [expanded, setExpanded] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [busy, setBusy] = useState(false);

  const runFileOp = async (op: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await op();
    } finally {
      setBusy(false);
    }
  };

  // メニュー表示中は、外側クリック / スクロール / Esc で閉じる。
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // メニュー項目の onClick より先に閉じないよう次フレームで登録する。
    const id = window.setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('scroll', close, true);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const editable = mode === 'edit';
  const isLoaded = activeShowId !== null;
  const fileName = projectPath ? projectPath.replace(/^.*[\\/]/, '') : '未保存';
  // 保存済みならファイル名を優先表示（project.name は "Untitled" 固定のため使わない）。
  const projectLabel = projectPath ? fileName : project?.name?.trim() || '未保存';

  const shows = project?.shows ?? [];
  const folders = project?.folders ?? [];
  const sortedFolders = sortByName(folders, showSort);
  const rootShows = sortByName(
    shows.filter((s) => !s.folderId || !folders.some((f) => f.id === s.folderId)),
    showSort,
  );

  const toggleFolder = (id: string) =>
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteShow = () => {
    if (menu?.kind !== 'show') return;
    const label = menu.name?.trim() || 'この Show';
    if (window.confirm(`Show「${label}」を削除しますか？（元に戻す: Ctrl+Z で復元できます）`)) {
      window.dmx.deleteShow(menu.id);
    }
    setMenu(null);
  };

  const deleteFolder = () => {
    if (menu?.kind !== 'folder') return;
    const label = menu.name?.trim() || 'このフォルダ';
    if (
      window.confirm(
        `フォルダ「${label}」を削除しますか？中の Show はルート直下へ移動します。（元に戻す: Ctrl+Z）`,
      )
    ) {
      window.dmx.deleteFolder(menu.id);
    }
    setMenu(null);
  };

  const moveToFolder = (folderId: string | null) => {
    if (menu?.kind !== 'show') return;
    window.dmx.setShowFolder(menu.id, folderId);
    setMenu(null);
  };

  const deleteSetlist = () => {
    if (menu?.kind !== 'setlist') return;
    const label = menu.name?.trim() || 'このセットリスト';
    if (window.confirm(`セットリスト「${label}」を削除しますか？（元に戻す: Ctrl+Z）`)) {
      window.dmx.deleteSetlist(menu.id);
    }
    setMenu(null);
  };

  const addShowToSetlist = (setlistId: string) => {
    if (menu?.kind !== 'show') return;
    window.dmx.addToSetlist(setlistId, menu.id);
    setMenu(null);
  };

  const setlists = project?.setlists ?? [];

  // 折りたたみ時は縦帯＋展開ボタンのみ。
  if (collapsed) {
    return (
      <div className="flex h-full w-8 shrink-0 flex-col items-center gap-2 rounded-lg bg-neutral-900/60 py-2 ring-1 ring-neutral-800">
        <button
          onClick={toggleCollapsed}
          className="inline-flex items-center rounded bg-neutral-800 px-1.5 py-1 text-neutral-200 hover:bg-neutral-700"
          title="Project / Show を展開"
        >
          <ChevronRight size={14} />
        </button>
        <span
          className="text-[11px] text-neutral-500 [writing-mode:vertical-rl]"
          title="Project / Show"
        >
          Project
        </span>
      </div>
    );
  }

  /** Show 行（フォルダ内/ルート共通）。indented でフォルダ内のインデントを付ける。 */
  const renderShow = (show: Show, indented: boolean) => {
    const selected = show.id === selectedShowId;
    const active = show.id === activeShowId;
    // セットリスト読込中は、どの Show をロードするかはマスター GO が制御するため
    // サイドバーからの読込／解放を禁止する。
    const setlistActive = activeSetlistId !== null;
    const canLoad = show.id !== activeShowId && !setlistActive;
    return (
      <div
        key={show.id}
        onClick={() => selectShow(show.id)}
        onDoubleClick={() => canLoad && window.dmx.loadShow(show.id)}
        onContextMenu={
          editable
            ? (e) => {
                e.preventDefault();
                selectShow(show.id);
                setMenu({
                  kind: 'show',
                  id: show.id,
                  name: show.name,
                  folderId: show.folderId,
                  x: e.clientX,
                  y: e.clientY,
                });
              }
            : undefined
        }
        className={`group flex items-center gap-1 rounded px-1.5 py-1 ${indented ? 'pl-4' : ''} ${
          active
            ? 'bg-amber-500/15 ring-1 ring-amber-500/50'
            : selected
              ? 'bg-sky-600/30 ring-1 ring-sky-600/50'
              : 'hover:bg-neutral-800'
        }`}
        title={
          setlistActive
            ? 'セットリスト読込中は Show の読込はマスター GO が制御します（右クリックでメニュー）'
            : 'クリックで選択 / ダブルクリックで読込（右クリックでメニュー）'
        }
      >
        <FileMusic size={14} className={active ? 'shrink-0 text-amber-400' : 'shrink-0 text-neutral-500'} />
        {editable ? (
          <InlineText
            value={show.name}
            placeholder="Show 名"
            editable
            onCommit={(v) => window.dmx.renameShow(show.id, v)}
            className="min-w-0 flex-1 truncate px-1 py-0.5 text-left text-neutral-200"
            title="クリックで名前を編集"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-neutral-200">{show.name}</span>
        )}

        {/* 行内アクション（ホバー / アクティブ時に表示）。
            セットリスト読込中は読込／解放をマスター GO に委ねるため出さない。 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {setlistActive ? null : active ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dmx.unloadShow();
              }}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700"
              title="解放"
            >
              解放
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dmx.loadShow(show.id);
              }}
              className="rounded bg-sky-700 px-1.5 py-0.5 text-[10px] text-white opacity-0 hover:bg-sky-600 group-hover:opacity-100"
              title="読込"
            >
              読込
            </button>
          )}
        </div>
      </div>
    );
  };

  /** セットリスト行（読込／解放・リネーム・右クリック削除）。Show 行と同じ体裁。 */
  const renderSetlist = (setlist: { id: string; name: string; entries: unknown[] }) => {
    const selected = setlist.id === selectedSetlistId;
    const active = setlist.id === activeSetlistId;
    return (
      <div
        key={setlist.id}
        onClick={() => selectSetlist(setlist.id)}
        onDoubleClick={() => loadSetlist(setlist.id)}
        onContextMenu={
          editable
            ? (e) => {
                e.preventDefault();
                selectSetlist(setlist.id);
                setMenu({ kind: 'setlist', id: setlist.id, name: setlist.name, x: e.clientX, y: e.clientY });
              }
            : undefined
        }
        className={`group flex items-center gap-1 rounded px-1.5 py-1 ${
          active
            ? 'bg-amber-500/15 ring-1 ring-amber-500/50'
            : selected
              ? 'bg-sky-600/30 ring-1 ring-sky-600/50'
              : 'hover:bg-neutral-800'
        }`}
        title="クリックで選択 / ダブルクリックで読込（右クリックでメニュー）"
      >
        <ListMusic size={14} className={active ? 'shrink-0 text-amber-400' : 'shrink-0 text-neutral-500'} />
        {editable ? (
          <InlineText
            value={setlist.name}
            placeholder="セットリスト名"
            editable
            onCommit={(v) => window.dmx.renameSetlist(setlist.id, v)}
            className="min-w-0 flex-1 truncate px-1 py-0.5 text-left text-neutral-200"
            title="クリックで名前を編集"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-neutral-200">{setlist.name}</span>
        )}
        <span className="shrink-0 text-[10px] text-neutral-600">{setlist.entries.length}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {active ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                unloadSetlist();
              }}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700"
              title="解放"
            >
              解放
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                loadSetlist(setlist.id);
              }}
              className="rounded bg-sky-700 px-1.5 py-0.5 text-[10px] text-white opacity-0 hover:bg-sky-600 group-hover:opacity-100"
              title="読込"
            >
              読込
            </button>
          )}
        </div>
      </div>
    );
  };

  /** フォルダ行＋その配下の Show 群。 */
  const renderFolder = (folder: Folder) => {
    const open = !collapsedFolders.has(folder.id);
    const children = sortByName(
      shows.filter((s) => s.folderId === folder.id),
      showSort,
    );
    return (
      <div key={folder.id}>
        <div
          onClick={() => toggleFolder(folder.id)}
          onContextMenu={
            editable
              ? (e) => {
                  e.preventDefault();
                  setMenu({ kind: 'folder', id: folder.id, name: folder.name, x: e.clientX, y: e.clientY });
                }
              : undefined
          }
          className="flex items-center gap-1 rounded px-1.5 py-1 text-neutral-200 hover:bg-neutral-800"
          title="クリックで開閉（右クリックでメニュー）"
        >
          <span className="flex w-3 justify-center text-neutral-500">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {open ? <FolderOpenIcon size={14} className="shrink-0" /> : <FolderIcon size={14} className="shrink-0" />}
          {editable ? (
            <InlineText
              value={folder.name}
              placeholder="フォルダ名"
              editable
              onCommit={(v) => window.dmx.renameFolder(folder.id, v)}
              className="min-w-0 flex-1 truncate px-1 py-0.5 text-left text-neutral-300"
              title="クリックで名前を編集"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-neutral-300">{folder.name}</span>
          )}
          <span className="shrink-0 text-[10px] text-neutral-600">{children.length}</span>
        </div>
        {open && (
          <div className="space-y-0.5">
            {children.length === 0 ? (
              <div className="px-2 py-1 pl-6 text-[11px] text-neutral-600">（空）</div>
            ) : (
              children.map((s) => renderShow(s, true))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex h-full shrink-0 flex-col rounded-lg bg-neutral-900/60 ring-1 ring-neutral-800"
      style={{ width }}
    >
      {/* ヘッダ */}
      <div className="flex items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
        <button
          onClick={toggleCollapsed}
          className="inline-flex items-center rounded bg-neutral-800 px-1.5 py-1 text-neutral-200 hover:bg-neutral-700"
          title="折りたたむ"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-sky-400">Project / Show</span>
        <select
          value={showSort}
          onChange={(e) => setShowSort(e.target.value as ShowSort)}
          className="ml-auto rounded bg-neutral-800 px-1 py-0.5 text-[11px] text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-700"
          title="並び順"
        >
          <option value="manual">追加順</option>
          <option value="name-asc">名前 ▲</option>
          <option value="name-desc">名前 ▼</option>
        </select>
      </div>

      {/* Project ファイル操作（新規 / 開く / 保存） */}
      <div className="flex items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
        <button
          onClick={() => fileNewProject()}
          disabled={!editable}
          className="flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          title="新規プロジェクト"
        >
          新規
        </button>
        <button
          onClick={() => runFileOp(fileOpenProject)}
          disabled={busy}
          className="flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          title="プロジェクトを開く"
        >
          開く
        </button>
        <button
          onClick={() => runFileOp(fileSaveProjectAs)}
          disabled={busy}
          className="flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          title="名前を付けて保存"
        >
          保存
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2 text-xs">
        {/* Project ルート */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-neutral-200 hover:bg-neutral-800"
          title={projectLabel}
        >
          <span className="flex w-3 justify-center text-neutral-500">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <FolderIcon size={14} className="shrink-0" />
          <span className="truncate font-medium">{projectLabel}</span>
        </button>

        {/* フォルダ / Show 一覧 */}
        {expanded && (
          <div className="mt-0.5 space-y-0.5 pl-3">
            {folders.length === 0 && shows.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-neutral-600">（Show なし）</div>
            )}

            {/* フォルダ（その配下の Show を内包） */}
            {sortedFolders.map(renderFolder)}

            {/* ルート直下の Show */}
            {rootShows.map((s) => renderShow(s, false))}

            {editable && (
              <>
                <div className="mt-1 flex gap-1">
                  <button
                    onClick={() => window.dmx.newShow()}
                    className="flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-sky-300 hover:bg-neutral-800"
                    title="Show を追加"
                  >
                    <Plus size={12} /> Show
                  </button>
                  <button
                    onClick={() => window.dmx.addFolder()}
                    className="flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-neutral-300 hover:bg-neutral-800"
                    title="フォルダを追加"
                  >
                    <Plus size={12} /> フォルダ
                  </button>
                </div>
                <button
                  onClick={() => runFileOp(fileImportShow)}
                  disabled={busy}
                  className="mt-0.5 flex w-full items-center justify-center gap-1 rounded px-1.5 py-1 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                  title="Show をファイルから読み込み（パッチ）"
                >
                  <Upload size={12} /> Show 読込
                </button>
              </>
            )}
          </div>
        )}

        {/* セットリスト（Show を束ねる上位の再生リスト） */}
        <div className="mt-3 flex items-center gap-1 px-1.5 text-[11px] font-semibold text-sky-400">
          <ListMusic size={13} className="shrink-0" /> セットリスト
        </div>
        <div className="mt-0.5 space-y-0.5 pl-3">
          {setlists.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-neutral-600">（セットリストなし）</div>
          )}
          {sortByName(setlists, showSort).map(renderSetlist)}
          {editable && (
            <button
              onClick={() => window.dmx.createSetlist()}
              className="mt-0.5 flex w-full items-center justify-center gap-1 rounded px-1.5 py-1 text-sky-300 hover:bg-neutral-800"
              title="セットリストを追加"
            >
              <Plus size={12} /> セットリスト
            </button>
          )}
        </div>
      </div>

      {/* フッタ: ロード状態 */}
      <div className="border-t border-neutral-800 px-2 py-1.5 text-[11px] text-neutral-500">
        {isLoaded ? (
          <span className="inline-flex items-center gap-1 text-amber-400">
            <Circle size={9} fill="currentColor" /> ロード中
          </span>
        ) : (
          <span>Show 未読込（直接出力）</span>
        )}
      </div>

      {/* 右クリックメニュー */}
      {menu && (
        <div
          className="fixed z-50 min-w-32 overflow-hidden rounded-md bg-neutral-800 py-1 text-xs shadow-lg ring-1 ring-neutral-700"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === 'show' ? (
            <>
              <button
                onClick={() => {
                  void fileExportShow(menu.id);
                  setMenu(null);
                }}
                className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-700"
              >
                書き出し
              </button>
              <button
                onClick={() => {
                  void fileExportLyrics(menu.id);
                  setMenu(null);
                }}
                className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-700"
              >
                歌詞を書き出し
              </button>
              <button
                onClick={deleteShow}
                className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-600/30"
              >
                削除
              </button>
              <div className="my-1 border-t border-neutral-700" />
              <div className="px-3 py-0.5 text-[10px] text-neutral-500">セットリストに追加</div>
              {setlists.length === 0 ? (
                <div className="px-3 py-1 text-[11px] text-neutral-600">（セットリストなし）</div>
              ) : (
                setlists.map((sl) => (
                  <button
                    key={sl.id}
                    onClick={() => addShowToSetlist(sl.id)}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-700"
                  >
                    <ListMusic size={13} className="shrink-0" /> {sl.name}
                  </button>
                ))
              )}
              <div className="my-1 border-t border-neutral-700" />
              <div className="px-3 py-0.5 text-[10px] text-neutral-500">フォルダへ移動</div>
              {menu.folderId && (
                <button
                  onClick={() => moveToFolder(null)}
                  className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-700"
                >
                  ルート（フォルダなし）
                </button>
              )}
              {folders.length === 0 && (
                <div className="px-3 py-1 text-[11px] text-neutral-600">（フォルダなし）</div>
              )}
              {sortByName(folders, showSort).map((f) => (
                <button
                  key={f.id}
                  disabled={f.id === menu.folderId}
                  onClick={() => moveToFolder(f.id)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
                >
                  <FolderIcon size={13} className="shrink-0" /> {f.name}
                </button>
              ))}
            </>
          ) : menu.kind === 'setlist' ? (
            <button
              onClick={deleteSetlist}
              className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-600/30"
            >
              削除
            </button>
          ) : (
            <button
              onClick={deleteFolder}
              className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-600/30"
            >
              削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}
