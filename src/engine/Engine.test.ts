import { describe, it, expect, vi } from 'vitest';
import { Engine } from './Engine';
import { createDefaultProject, defaultArtnetSettings } from '../shared/types';

/** Art-Net は既定で無効なので、送出パケットを見るテストでは明示的に有効化する。 */
const artnetOn = () => ({ ...defaultArtnetSettings(), enabled: true });

describe('Engine', () => {
  it('reflects setFader into the composed output on tick', () => {
    const sent: Buffer[] = [];
    const engine = new Engine({ send: (p) => sent.push(p), artnet: artnetOn() });

    engine.setFader(0, 255);
    engine.setFader(1, 100);
    engine.tick(0);

    const out = engine.getOutput();
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(0);

    // 送出された ArtDMX のデータ部に反映されている。
    expect(sent).toHaveLength(1);
    expect(sent[0].readUInt8(18 + 0)).toBe(255);
    expect(sent[0].readUInt8(18 + 1)).toBe(100);
  });

  it('clamps fader values to 0-255 and ignores out-of-range channels', () => {
    const engine = new Engine({ send: () => {} });
    engine.setFader(0, 999);
    engine.setFader(1, -50);
    engine.setFader(999, 200); // 範囲外 ch は無視
    engine.tick(0);
    const out = engine.getOutput();
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
  });

  it('increments the ArtDMX sequence each tick, skipping 0', () => {
    const sent: Buffer[] = [];
    const engine = new Engine({ send: (p) => sent.push(p), artnet: artnetOn() });
    for (let i = 0; i < 3; i++) engine.tick(i);
    expect(sent[0].readUInt8(12)).toBe(1);
    expect(sent[1].readUInt8(12)).toBe(2);
    expect(sent[2].readUInt8(12)).toBe(3);
  });

  it('notifies frame listeners on each tick', () => {
    const engine = new Engine({ send: () => {} });
    const cb = vi.fn();
    engine.onFrame(cb);
    engine.setFader(5, 42);
    engine.tick(0);
    expect(cb).toHaveBeenCalledTimes(1);
    const frame = cb.mock.calls[0][0] as number[];
    expect(frame[5]).toBe(42);
  });

  it('scales output by the grand master and zeroes on blackout', () => {
    const engine = new Engine({ send: () => {} });
    engine.setFader(0, 200);

    engine.setMasterLevel(128); // ~50%
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(Math.round(200 * (128 / 255)));

    engine.setBlackout(true);
    engine.tick(1);
    expect(engine.getOutput()[0]).toBe(0);

    engine.setBlackout(false);
    engine.setMasterLevel(255);
    engine.tick(2);
    expect(engine.getOutput()[0]).toBe(200); // 全データは保持されている
  });

  it('measures the output rate over a 1s window', () => {
    const engine = new Engine({ send: () => {} });
    // 25ms 間隔で 1 秒ぶんのティックを供給。
    for (let t = 0; t <= 1000; t += 25) engine.tick(t);
    const state = engine.getState();
    // 直近 1 秒に入るティック数（おおよそ 40）。
    expect(state.measuredHz).toBeGreaterThanOrEqual(39);
    expect(state.measuredHz).toBeLessThanOrEqual(41);
  });
});

describe('注入タイマー（scheduleProjectNotify）', () => {
  it('間引き通知が注入タイマーに乗り、stop() で保留分が破棄される', () => {
    const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
    let nextId = 1;
    const engine = new Engine({
      send: () => {},
      setTimeoutFn: (cb) => {
        const id = nextId++ as unknown as ReturnType<typeof setTimeout>;
        timers.set(id, cb);
        return id;
      },
      clearTimeoutFn: (h) => void timers.delete(h),
    });
    const p = createDefaultProject();
    p.shows = [
      {
        id: 'show1',
        name: 'S',
        sequence: [{ kind: 'cue', cue: { id: 'c1', values: {}, fadeInMs: 0 } }],
      },
    ];
    engine.loadProject(p);
    engine.loadShow('show1');
    engine.goTo(0, 0);

    const onProject = vi.fn();
    engine.onProject(onProject);
    engine.setFader(0, 10); // CUE へのリアルタイム書き込み → trailing 通知を予約
    expect(timers.size).toBe(1); // 生 setTimeout ではなく注入タイマーに乗る

    const fire = [...timers.values()][0];
    timers.clear();
    fire();
    expect(onProject).toHaveBeenCalled(); // trailing 通知が届く

    engine.setFader(0, 20); // 再度予約
    expect(timers.size).toBe(1);
    engine.stop(); // 保留中の通知タイマーを破棄
    expect(timers.size).toBe(0);
  });
});
