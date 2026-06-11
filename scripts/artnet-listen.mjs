/**
 * ハード無し検証用の Art-Net 受信ノード（§4）。
 *
 * UDP 6454 を listen し、受信した ArtDMX パケットをデコードして
 * 「非ゼロのチャンネルだけ」を定期的に表示する。送出レート(Hz)も計測する。
 *
 * 使い方:
 *   node scripts/artnet-listen.mjs
 * その後アプリ（npm run dev）でフェーダーを動かすと、ここに値が出る。
 */

import dgram from 'node:dgram';

const PORT = 6454;
const ARTNET_ID = 'Art-Net\0';
const OP_OUTPUT = 0x5000;

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

let latest = null; // 最新の 512ch
let lastSeq = null;
let packetsThisSecond = 0;
let measuredHz = 0;

socket.on('error', (err) => {
  console.error('socket error:', err);
  socket.close();
});

socket.on('message', (msg) => {
  if (msg.length < 18) return;
  if (msg.toString('latin1', 0, 8) !== ARTNET_ID) return;
  if (msg.readUInt16LE(8) !== OP_OUTPUT) return;

  const seq = msg.readUInt8(12);
  const subUni = msg.readUInt8(14);
  const net = msg.readUInt8(15);
  const length = msg.readUInt16BE(16);
  const data = [];
  for (let i = 0; i < length; i++) data.push(msg.readUInt8(18 + i));

  latest = { seq, subUni, net, data };
  lastSeq = seq;
  packetsThisSecond++;
});

socket.bind(PORT, () => {
  console.log(`[artnet-listen] listening on udp/${PORT}`);
  console.log('[artnet-listen] フェーダーを動かすと非ゼロ ch がここに表示されます\n');
});

// 1 秒ごとにレートと現在の非ゼロ ch を表示。
setInterval(() => {
  measuredHz = packetsThisSecond;
  packetsThisSecond = 0;

  if (!latest) {
    console.log('[artnet-listen] パケット未受信…');
    return;
  }

  const nonZero = latest.data
    .map((v, i) => ({ ch: i + 1, v }))
    .filter((x) => x.v > 0);

  const head = `[${measuredHz}Hz] net=${latest.net} subUni=${latest.subUni} seq=${lastSeq}`;
  if (nonZero.length === 0) {
    console.log(`${head} | 全 ch ゼロ`);
  } else {
    const shown = nonZero
      .slice(0, 16)
      .map((x) => `CH${x.ch}=${x.v}`)
      .join('  ');
    const more = nonZero.length > 16 ? `  …他 ${nonZero.length - 16}ch` : '';
    console.log(`${head} | ${shown}${more}`);
  }
}, 1000);
