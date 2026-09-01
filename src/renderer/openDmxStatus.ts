/**
 * USB-DMX（OpenDMX / Pico W）の接続状態を表示文字列へ変換する共通ヘルパー。
 * 設定モーダル（詳細表記）とトップバー（短縮表記）の双方から使う。
 * 状態そのものは main の OpenDmxDriver が持ち、ここは映すだけ。
 */

import type { OpenDmxStatus } from '../shared/ipc';

/** 接続状態を表示文字列と色クラスへ変換する（設定モーダル用の詳細表記）。 */
export function describeOpenDmxStatus(status: OpenDmxStatus): [string, string] {
  switch (status.state) {
    case 'disabled':
      return ['無効', 'text-neutral-500'];
    case 'closed':
      return ['ポート未選択', 'text-neutral-400'];
    case 'opening':
      return ['接続中…', 'text-amber-400'];
    case 'open':
      return [`送出中 ${status.measuredHz} Hz`, 'text-emerald-400'];
    case 'error':
      return [status.error ?? '接続エラー', 'text-red-400'];
  }
}

/** トップバー用の短縮表記（送出中は実測レートだけを出す）。 */
export function openDmxRateLabel(status: OpenDmxStatus): [string, string] {
  switch (status.state) {
    case 'disabled':
      return ['無効', 'text-neutral-500'];
    case 'closed':
      return ['未接続', 'text-neutral-400'];
    case 'opening':
      return ['接続中…', 'text-amber-400'];
    case 'open':
      return [`${status.measuredHz} Hz`, 'text-emerald-400'];
    case 'error':
      return ['エラー', 'text-red-400'];
  }
}
