/**
 * ルートコンポーネント。エンジンからの outputFrame / engineState / project を
 * 購読し、Project・再生・フェーダー・出力モニターを配置する。
 */

import { useEffect, useRef, useState } from 'react';
import { ProjectBar } from './components/ProjectBar';
import { ProjectSidebar } from './components/ProjectSidebar';
import { PreferencesModal } from './components/PreferencesModal';
import { ShowImportPatchModal } from './components/ShowImportPatchModal';
import { MissingFilesModal } from './components/MissingFilesModal';
import { PlaybackPanel } from './components/PlaybackPanel';
import { SetlistPanel } from './components/SetlistPanel';
import { NowNextPanel } from './components/NowNextPanel';
import { MasterBar } from './components/MasterBar';
import { ActionPanel } from './components/ActionPanel';
import { TimelineView } from './components/timeline/TimelineView';
import { FaderBank } from './components/FaderBank';
import { OutputMeter } from './components/OutputMeter';
import { SplitHandle } from './components/SplitHandle';
import { useDmxStore } from './store';
import {
  fileNewProject,
  fileOpenProject,
  fileRelinkAudio,
  fileSaveProjectAs,
  fileSaveProjectOverwrite,
} from './projectFileOps';
import { cueAt, nextPosition } from '../engine/playback';
import type {
  MenuAction,
  PlaybackStatus,
  RemoteCommand,
  RemoteCue,
  RemoteState,
} from '../shared/ipc';
import type { Project } from '../shared/types';

type Tab = 'cue' | 'timeline';

/** CUE を RemoteCue（名前 + 歌詞）へ整形する（NowNextPanel と同じ既定名ロジック）。 */
function toRemoteCue(cue: { name?: string; lyrics?: string } | null): RemoteCue | null {
  if (!cue) return null;
  return { name: cue.name?.trim() ? cue.name : 'Cue', lyrics: cue.lyrics?.trim() ?? '' };
}

/** ストアの各スライスからスマホ向けビューモデル（RemoteState）を組み立てる。 */
function buildRemoteState(args: {
  project: Project | null;
  activeShowId: string | null;
  playback: PlaybackStatus | null;
  mode: RemoteState['mode'];
  blackout: boolean;
  masterLevel: number;
  activeSetlistId: string | null;
  setlistIndex: number;
  transportPlaying: boolean;
  audioDurationMs: number;
  timelineDurationMs: number;
  positionMs: number;
  actionFadeMs: number;
}): RemoteState {
  const { project, activeShowId } = args;
  const show = project?.shows.find((s) => s.id === activeShowId) ?? null;

  let now: RemoteCue | null = null;
  let next: RemoteCue | null = null;
  if (show) {
    const seq = show.sequence;
    const main = args.playback?.mainIndex ?? -1;
    const sub = args.playback?.subIndex ?? 0;
    now = main >= 0 ? toRemoteCue(cueAt(seq, { main, sub })) : null;
    const nextPos = nextPosition(seq, main, sub);
    next = nextPos ? toRemoteCue(cueAt(seq, nextPos)) : null;
  }

  const setlist = project?.setlists?.find((sl) => sl.id === args.activeSetlistId) ?? null;
  const showNameOf = (id: string) => project?.shows.find((s) => s.id === id)?.name || 'Show';

  const hasAudio = args.audioDurationMs > 0;
  return {
    mode: args.mode,
    blackout: args.blackout,
    masterLevel: args.masterLevel,
    showName: show?.name ?? null,
    activeShowId: activeShowId,
    shows: (project?.shows ?? [])
      .map((s) => ({ id: s.id, name: s.name || 'Show' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true })),
    setlist: setlist
      ? {
          name: setlist.name,
          index: args.setlistIndex,
          total: setlist.entries.length,
          entries: setlist.entries.map((e) => ({ name: showNameOf(e.showId) })),
        }
      : null,
    now,
    next,
    transport: show
      ? {
          hasAudio,
          playing: args.transportPlaying,
          positionMs: args.positionMs,
          durationMs: args.timelineDurationMs,
        }
      : null,
    actions: (project?.actions ?? []).map((a) => ({ id: a.id, name: a.name || 'Action' })),
    actionFadeMs: args.actionFadeMs,
  };
}

export default function App() {
  const setOutput = useDmxStore((s) => s.setOutput);
  const setProject = useDmxStore((s) => s.setProject);
  const setEngineState = useDmxStore((s) => s.setEngineState);
  const setDirty = useDmxStore((s) => s.setDirty);
  const fadersCollapsed = useDmxStore((s) => s.fadersCollapsed);
  const sidebarCollapsed = useDmxStore((s) => s.sidebarCollapsed);
  const applyPanelLayoutForContext = useDmxStore((s) => s.applyPanelLayoutForContext);
  // 可変レイアウトの寸法（スプリッタで変更・localStorage へ永続化）。
  const panelLayout = useDmxStore((s) => s.panelLayout);
  const setPanelLayout = useDmxStore((s) => s.setPanelLayout);
  const resetPanelLayout = useDmxStore((s) => s.resetPanelLayout);
  const mode = useDmxStore((s) => s.mode);
  // ウィンドウタイトル用：Project 名・対象 Show 名・未保存状態。
  const project = useDmxStore((s) => s.project);
  const projectPath = useDmxStore((s) => s.projectPath);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const selectedShowId = useDmxStore((s) => s.selectedShowId);
  const dirty = useDmxStore((s) => s.dirty);
  // セットリスト読込中は中央をセットリスト表示に切替える（Show の CUE/Timeline より優先）。
  const activeSetlistId = useDmxStore((s) => s.activeSetlistId);
  // リモート（スマホ）へ報告するビューモデルの素材。
  const playback = useDmxStore((s) => s.playback);
  const blackout = useDmxStore((s) => s.blackout);
  const masterLevel = useDmxStore((s) => s.masterLevel);
  const setlistIndex = useDmxStore((s) => s.setlistIndex);
  const transportPlaying = useDmxStore((s) => s.transport.playing);
  const audioDurationMs = useDmxStore((s) => s.audioDurationMs);
  const timelineDurationMs = useDmxStore((s) => s.transport.durationMs);
  // 再生位置は 100ms 粒度で購読（毎フレーム再送を避け、~10Hz でタイムコード更新）。
  const positionBucket = useDmxStore((s) => Math.round(s.transport.playheadMs / 100));
  const actionFadeMs = useDmxStore((s) => s.actionFadeMs);
  // Show 未読込（解放中）。CUE/Timeline を隠し Action を大きく表示する。
  const released = activeShowId === null;
  const [tab, setTab] = useState<Tab>('cue');
  // キーハンドラ（[] 依存で固定）から現在タブを参照するための ref。
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  // --- 可変レイアウト（スプリッタ）-----------------------------------------
  // 分割対象パネルの実 DOM。ドラッグ開始時の実寸から新しい配分比を求める。
  const centerRef = useRef<HTMLDivElement>(null);
  const faderRef = useRef<HTMLDivElement>(null);
  const setlistRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  /** ドラッグ開始時の寸法（a=手前側 / b=奥側。px 直接指定では a のみ使う）。 */
  const dragStart = useRef({ a: 0, b: 0 });

  /** 隣接 2 パネルの現在サイズを控える（比率ドラッグの基準）。 */
  const beginSplit = (a: HTMLElement | null, b: HTMLElement | null, axis: 'x' | 'y') => {
    const size = (el: HTMLElement | null) =>
      el ? (axis === 'x' ? el.offsetWidth : el.offsetHeight) : 0;
    dragStart.current = { a: size(a), b: size(b) };
  };
  /** ドラッグ量から手前側パネルの取り分（0-1）を求める。両側に最小 px を確保する。 */
  const splitRatio = (delta: number, minPx = 96): number => {
    const total = dragStart.current.a + dragStart.current.b;
    if (total <= 0) return 0.5;
    if (total < minPx * 2) return dragStart.current.a / total;
    const a = Math.min(total - minPx, Math.max(minPx, dragStart.current.a + delta));
    return a / total;
  };
  /** px 直接指定のドラッグ開始（サイドバー幅・出力モニター高さ）。 */
  const beginPx = (value: number) => {
    dragStart.current = { a: value, b: 0 };
  };

  useEffect(() => {
    const offFrame = window.dmx.onOutputFrame((frame) => setOutput(frame));
    const offState = window.dmx.onEngineState((state) => setEngineState(state));
    const offProject = window.dmx.onProject((project) => setProject(project));
    const offDirty = window.dmx.onDirty((state) => setDirty(state));
    // 初期状態を取得して反映。
    window.dmx.getProject().then(setProject);
    window.dmx.getEngineState().then(setEngineState);
    return () => {
      offFrame();
      offState();
      offProject();
      offDirty();
    };
  }, [setOutput, setProject, setEngineState, setDirty]);

  // グローバルキーボード操作（本番オペ）：Space/→ で GO、Backspace/← で 1つ戻る。
  // テキスト入力中（input/textarea/select/編集可能要素）は誤爆を避けて無効化する。
  useEffect(() => {
    const isTyping = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+S は上書き保存。入力欄でもブラウザの保存を抑止して実行する。
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void window.dmx.saveProjectOverwrite();
        return;
      }
      // Ctrl/Cmd+, で環境設定を開く。
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        useDmxStore.getState().setPrefsOpen(true);
        return;
      }
      if (isTyping(e.target)) return; // 入力欄ではネイティブ動作（テキスト編集の Undo 等）に任せる
      // Undo / Redo（Ctrl/Cmd 修飾）
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          window.dmx.undo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault();
          window.dmx.redo();
        }
        return;
      }
      if (e.repeat || e.altKey) return;
      const st = useDmxStore.getState();
      // セットリスト読込中はマスター GO 系へ振る（中央がセットリスト表示のため）。
      if (st.activeSetlistId) {
        if (e.code === 'Space' || e.code === 'ArrowRight') {
          e.preventDefault();
          st.operatorGo();
        } else if (e.code === 'Backspace' || e.code === 'ArrowLeft') {
          e.preventDefault();
          st.operatorBack();
        }
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        // Timeline タブでは再生/一時停止トグル、それ以外（CUE）では GO。
        if (tabRef.current === 'timeline') {
          if (st.activeShowId) {
            if (st.transport.playing) st.transportPause();
            else st.transportPlay();
          }
        } else {
          st.operatorGo();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        st.operatorGo();
      } else if (e.code === 'Backspace' || e.code === 'ArrowLeft') {
        e.preventDefault();
        st.operatorBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // アプリメニューからのアクションを受けて、既存のロジック/ストアへディスパッチする。
  useEffect(() => {
    const onMenu = (action: MenuAction) => {
      const st = useDmxStore.getState();
      switch (action) {
        case 'file:new':
          fileNewProject();
          break;
        case 'file:open':
          void fileOpenProject();
          break;
        case 'file:save':
          void fileSaveProjectOverwrite();
          break;
        case 'file:saveAs':
          void fileSaveProjectAs();
          break;
        case 'file:relink':
          void fileRelinkAudio();
          break;
        case 'edit:undo':
          window.dmx.undo();
          break;
        case 'edit:redo':
          window.dmx.redo();
          break;
        case 'edit:prefs':
          st.setPrefsOpen(true);
          break;
        case 'view:tabCue':
          setTab('cue');
          break;
        case 'view:tabTimeline':
          setTab('timeline');
          break;
        case 'view:toggleSidebar':
          st.toggleSidebarCollapsed();
          break;
        case 'view:toggleFaders':
          st.toggleFadersCollapsed();
          break;
        case 'view:resetLayout':
          st.resetPanelLayout();
          break;
        case 'show:go':
          window.dmx.go();
          break;
        case 'show:goBack':
          window.dmx.goBack();
          break;
        case 'show:modeEdit':
          st.setMode('edit');
          break;
        case 'show:modeShow':
          st.setMode('show');
          break;
        case 'show:blackoutToggle':
          st.setBlackout(!st.blackout);
          break;
        case 'show:gmFull':
          st.setMasterLevel(255);
          break;
      }
    };
    return window.dmx.onMenuAction(onMenu);
  }, []);

  // リモート（スマホ等）からのコマンドを受け、既存のストア/GO ロジックへディスパッチする。
  // GO/BACK はキーボードと同じ operatorGo/operatorBack（セットリスト対応）を再利用する。
  useEffect(() => {
    const onRemote = (cmd: RemoteCommand) => {
      const st = useDmxStore.getState();
      switch (cmd.action) {
        case 'go':
          st.operatorGo();
          break;
        case 'back':
          st.operatorBack();
          break;
        case 'hold':
          window.dmx.holdFade();
          break;
        case 'blackout':
          st.setBlackout(!st.blackout);
          break;
        case 'master':
          if (typeof cmd.value === 'number') {
            st.setMasterLevel(Math.max(0, Math.min(255, Math.round(cmd.value))));
          }
          break;
        case 'setlistGoTo':
          if (typeof cmd.value === 'number') st.setlistGoTo(cmd.value);
          break;
        case 'action':
          if (typeof cmd.id === 'string') st.applyAction(cmd.id, cmd.fade ? st.actionFadeMs : 0);
          break;
        case 'modeShow':
          // リモートからは EDIT→SHOW のみ許可（SHOW→EDIT は本体でのみ操作）。
          st.setMode('show');
          break;
        case 'loadShow':
          // セットリスト読込中は Show の読込をマスター GO に委ねる（サイドバーと同じ制約）。
          if (typeof cmd.id === 'string' && !st.activeSetlistId) window.dmx.loadShow(cmd.id);
          break;
        case 'unloadShow':
          if (!st.activeSetlistId) window.dmx.unloadShow();
          break;
        case 'timelineToggle':
          // 本体の再生状態を真として切り替える（スマホ側の状態が古くても位置を戻さない）。
          if (st.transport.playing) st.transportPause();
          else if (st.activeShowId) st.transportPlay();
          break;
        case 'timelinePlay':
          if (st.activeShowId) st.transportPlay();
          break;
        case 'timelinePause':
          st.transportPause();
          break;
        case 'timelineStop':
          st.transportStop();
          break;
      }
    };
    return window.dmx.onRemoteCommand(onRemote);
  }, []);

  // リモート画面用ビューモデルを組み立て、変化時のみ main（RemoteServer）へ報告する。
  // 内容が同一のときは送らない（フェード進捗・再生位置などの高頻度更新を握りつぶす）。
  const lastRemoteJson = useRef<string>('');
  useEffect(() => {
    const vm = buildRemoteState({
      project,
      activeShowId,
      playback,
      mode,
      blackout,
      masterLevel,
      activeSetlistId,
      setlistIndex,
      transportPlaying,
      audioDurationMs,
      timelineDurationMs,
      positionMs: positionBucket * 100,
      actionFadeMs,
    });
    const json = JSON.stringify(vm);
    if (json === lastRemoteJson.current) return;
    lastRemoteJson.current = json;
    window.dmx.reportRemoteState(vm);
  }, [
    project,
    activeShowId,
    playback,
    mode,
    blackout,
    masterLevel,
    activeSetlistId,
    setlistIndex,
    transportPlaying,
    audioDurationMs,
    timelineDurationMs,
    positionBucket,
    actionFadeMs,
  ]);

  // タブ/パネル開閉の変化を main へ同期し、メニューのチェック表示に反映する。
  useEffect(() => {
    window.dmx.notifyUiState({ tab, sidebarCollapsed, fadersCollapsed });
  }, [tab, sidebarCollapsed, fadersCollapsed]);

  // 文脈（Show 読込・モード）が変わったらパネル開閉状態を反映する。
  //   - Show 未読込: Action を大きく（折りたたまない）／フェーダー表示
  //   - Show 読込: EDIT/SHOW 別に永続化（localStorage）した開閉状態を復元
  // 手動トグルは現モードの状態として保存され、次にそのモードへ戻ると復元される。
  useEffect(() => {
    applyPanelLayoutForContext();
  }, [released, mode, applyPanelLayoutForContext]);

  // ウィンドウタイトルへ「Project名 — Show名」を反映する（Electron はウィンドウ
  // タイトルを document.title に追従させる）。project.name は "Untitled" 固定のため、
  // 保存済みはファイル名（拡張子なし）を Project 名として用いる（ProjectSidebar と同様）。
  // 対象 Show は読込中（active）を優先し、未読込なら編集中に選択している Show を表示する。
  // 未保存時は先頭に ● を付ける。
  useEffect(() => {
    const fileName = projectPath ? projectPath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') : '';
    const projectName = fileName || '無題';
    const showId = activeShowId ?? selectedShowId;
    const showName = showId ? project?.shows.find((s) => s.id === showId)?.name : undefined;
    const base = showName ? `${projectName} — ${showName}` : projectName;
    document.title = `${dirty ? '● ' : ''}${base} — DMX Console`;
  }, [project, projectPath, activeShowId, selectedShowId, dirty]);

  // CUE / Timeline のタブ領域（通常時は中央、セットリスト時は右半分で再利用）。
  const cueTimelinePanel = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* タブバー：CUE / Timeline を切り替え */}
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-800">
        <TabButton label="CUE" active={tab === 'cue'} onClick={() => setTab('cue')} />
        <TabButton label="Timeline" active={tab === 'timeline'} onClick={() => setTab('timeline')} />
      </div>
      {/* タブ内容（共通の高さ領域）。CUE はマスター列、Timeline はトランスポート。
          両方マウントしたまま表示切替し、Timeline のスクロール位置・再生状態を保持する。 */}
      <div className="min-h-0 flex-1">
        <div className={`h-full ${tab === 'cue' ? '' : 'hidden'}`}>
          <PlaybackPanel />
        </div>
        <div className={`h-full ${tab === 'timeline' ? '' : 'hidden'}`}>
          <TimelineView active={tab === 'timeline'} />
        </div>
      </div>
    </div>
  );

  // 中央領域（CUE/Timeline・セットリスト・Action 大）とフェーダーバンクの高さ配分。
  // フェーダー折りたたみ時は相方の grow が無くなるため、中央が余白を全部取る
  // （grow の合計が 1 未満だと余白がその割合しか配られず、下に隙間が残る）。
  const centerStyle = { flexGrow: fadersCollapsed ? 1 : panelLayout.centerRatio, flexBasis: 0 };

  return (
    <div className="flex h-screen gap-2 bg-neutral-950 p-2 text-neutral-100">
      {/* 左サイド：Project / Show ツリー（開閉可・幅はスプリッタで可変） */}
      <ProjectSidebar />
      {!sidebarCollapsed && (
        <SplitHandle
          axis="x"
          onStart={() => beginPx(panelLayout.sidebarWidth)}
          onMove={(d) => setPanelLayout({ sidebarWidth: dragStart.current.a + d })}
          onReset={() => resetPanelLayout('sidebarWidth')}
          title="サイドバーの幅を変更（ダブルクリックで既定に戻す）"
        />
      )}

      {/* 右側：縦積みレイアウト（中央 / フェーダー / 出力モニターの高さが可変） */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <ProjectBar />
        <MasterBar />

        {/* 本番モードの「現在 / 次の CUE」帯（SHOW 時のみ表示） */}
        <NowNextPanel />

        {/* 中央領域: セットリスト読込中は左右2分割（左=セットリスト / 右=CUE・Timeline）。
            そうでなければ Show 読込中に CUE / Timeline を表示。どちらも無ければ Action を大きく。
            高さは centerRatio（フェーダーバンクとの配分）で可変。 */}
        {activeSetlistId ? (
          <div ref={centerRef} className="flex min-h-0 gap-2" style={centerStyle}>
            {/* 左: セットリスト（マスター GO） */}
            <div
              ref={setlistRef}
              className="flex min-h-0 min-w-0 flex-col"
              style={{ flexGrow: panelLayout.setlistRatio, flexBasis: 0 }}
            >
              <SetlistPanel />
            </div>
            <SplitHandle
              axis="x"
              onStart={() => beginSplit(setlistRef.current, cueRef.current, 'x')}
              onMove={(d) => setPanelLayout({ setlistRatio: splitRatio(d, 160) })}
              onReset={() => resetPanelLayout('setlistRatio')}
              title="セットリストと CUE/Timeline の幅を変更（ダブルクリックで既定に戻す）"
            />
            {/* 右: 再生中 Show の CUE / Timeline */}
            <div
              ref={cueRef}
              className="flex min-h-0 min-w-0 flex-col"
              style={{ flexGrow: 1 - panelLayout.setlistRatio, flexBasis: 0 }}
            >
              {cueTimelinePanel}
            </div>
          </div>
        ) : released ? (
          <div ref={centerRef} className="min-h-0" style={centerStyle}>
            <ActionPanel big />
          </div>
        ) : (
          <div ref={centerRef} className="flex min-h-0 flex-col" style={centerStyle}>
            {cueTimelinePanel}
          </div>
        )}

        {/* Action パネル（中央を占有していない時だけ通常サイズで表示） */}
        {!(released && !activeSetlistId) && <ActionPanel />}

        {/* 中央 ↔ フェーダーバンクの高さスプリッタ（折りたたみ時は分割不要） */}
        {!fadersCollapsed && (
          <SplitHandle
            axis="y"
            onStart={() => beginSplit(centerRef.current, faderRef.current, 'y')}
            onMove={(d) => setPanelLayout({ centerRatio: splitRatio(d) })}
            onReset={() => resetPanelLayout('centerRatio')}
            title="中央パネルとフェーダーの高さを変更（ダブルクリックで既定に戻す）"
          />
        )}

        {/* フェーダーバンク（折りたたみ時は高さを解放） */}
        <div
          ref={faderRef}
          className={fadersCollapsed ? 'shrink-0' : 'min-h-0'}
          style={
            fadersCollapsed
              ? undefined
              : { flexGrow: 1 - panelLayout.centerRatio, flexBasis: 0 }
          }
        >
          <FaderBank />
        </div>

        {/* 出力モニターの高さスプリッタ（モニターだけは px 指定） */}
        <SplitHandle
          axis="y"
          onStart={() => beginPx(panelLayout.meterHeight)}
          onMove={(d) => setPanelLayout({ meterHeight: dragStart.current.a - d })}
          onReset={() => resetPanelLayout('meterHeight')}
          title="出力モニターの高さを変更（ダブルクリックで既定に戻す）"
        />
        <OutputMeter />
      </div>

      {/* 環境設定モーダル（prefsOpen で表示） */}
      <PreferencesModal />
      <ShowImportPatchModal />
      <MissingFilesModal />
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px rounded-t px-4 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-b-2 border-sky-500 bg-neutral-900 text-sky-400'
          : 'border-b-2 border-transparent text-neutral-500 hover:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );
}
