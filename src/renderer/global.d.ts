import type { DmxBridge } from '../shared/ipc';

declare global {
  interface Window {
    /** preload が公開する DMX エンジン API（§9）。 */
    dmx: DmxBridge;
  }
}

export {};
