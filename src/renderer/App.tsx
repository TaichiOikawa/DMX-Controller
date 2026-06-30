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
import { NowNextPanel } from './components/NowNextPanel';
import { MasterBar } from './components/MasterBar';
import { ActionPanel } from './components/ActionPanel';
import { TimelineView } from './components/timeline/TimelineView';
import { FaderBank } from './components/FaderBank';
import { OutputMeter } from './components/OutputMeter';
import { useDmxStore } from './store';
import {
  fileNewProject,
  fileOpenProject,
  fileRelinkAudio,
  fileSaveProjectAs,
  fileSaveProjectOverwrite,
} from './projectFileOps';
import type { MenuAction } from '../shared/ipc';

type Tab = 'cue' | 'timeline';

export default function App() {
  const setOutput = useDmxStore((s) => s.setOutput);
  const setProject = useDmxStore((s) => s.setProject);
  const setEngineState = useDmxStore((s) => s.setEngineState);
  const setDirty = useDmxStore((s) => s.setDirty);
  const fadersCollapsed = useDmxStore((s) => s.fadersCollapsed);
  const sidebarCollapsed = useDmxStore((s) => s.sidebarCollapsed);
  const applyPanelLayoutForContext = useDmxStore((s) => s.applyPanelLayoutForContext);
  const mode = useDmxStore((s) => s.mode);
  // ウィンドウタイトル用：Project 名・対象 Show 名・未保存状態。
  const project = useDmxStore((s) => s.project);
  const projectPath = useDmxStore((s) => s.projectPath);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const selectedShowId = useDmxStore((s) => s.selectedShowId);
  const dirty = useDmxStore((s) => s.dirty);
  // Show 未読込（解放中）。CUE/Timeline を隠し Action を大きく表示する。
  const released = activeShowId === null;
  const [tab, setTab] = useState<Tab>('cue');
  // キーハンドラ（[] 依存で固定）から現在タブを参照するための ref。
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

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
      if (e.code === 'Space') {
        e.preventDefault();
        // Timeline タブでは再生/一時停止トグル、それ以外（CUE）では GO。
        if (tabRef.current === 'timeline') {
          const st = useDmxStore.getState();
          if (st.activeShowId) {
            if (st.transport.playing) st.transportPause();
            else st.transportPlay();
          }
        } else {
          window.dmx.go();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        window.dmx.go();
      } else if (e.code === 'Backspace' || e.code === 'ArrowLeft') {
        e.preventDefault();
        window.dmx.goBack();
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

  return (
    <div className="flex h-screen gap-2 bg-neutral-950 p-2 text-neutral-100">
      {/* 左サイド：Project / Show ツリー（開閉可） */}
      <ProjectSidebar />

      {/* 右側：従来の縦積みレイアウト */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <ProjectBar />
        <MasterBar />

        {/* 本番モードの「現在 / 次の CUE」帯（SHOW 時のみ表示） */}
        <NowNextPanel />

        {/* Show 読込中のみ CUE / Timeline を表示。未読込時は隠して Action を大きく出す。 */}
        {!released && (
          <>
            {/* タブバー：CUE / Timeline を切り替え */}
            <div className="flex items-center gap-1 border-b border-neutral-800">
              <TabButton label="CUE" active={tab === 'cue'} onClick={() => setTab('cue')} />
              <TabButton
                label="Timeline"
                active={tab === 'timeline'}
                onClick={() => setTab('timeline')}
              />
            </div>

            {/* タブ内容（共通の高さ領域）。CUE はマスター列、Timeline はトランスポート。
                両方マウントしたまま表示切替し、Timeline のスクロール位置・再生状態を保持する。 */}
            <div className="min-h-0 flex-[2]">
              <div className={`h-full ${tab === 'cue' ? '' : 'hidden'}`}>
                <PlaybackPanel />
              </div>
              <div className={`h-full ${tab === 'timeline' ? '' : 'hidden'}`}>
                <TimelineView active={tab === 'timeline'} />
              </div>
            </div>
          </>
        )}

        {/* Action パネル。未読込時は大きく（タブ領域を占有）、読込時は通常/折りたたみ。 */}
        {released ? (
          <div className="min-h-0 flex-[2]">
            <ActionPanel big />
          </div>
        ) : (
          <ActionPanel />
        )}

        {/* フェーダーバンク（折りたたみ時は高さを解放） */}
        <div className={fadersCollapsed ? 'shrink-0' : 'min-h-0 flex-[3]'}>
          <FaderBank />
        </div>
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
