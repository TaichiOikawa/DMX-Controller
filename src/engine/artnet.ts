/**
 * ArtDMX パケットのエンコード（§4）。
 *
 * 純粋関数のみ。UDP 送信はここでは行わない（main の engineHost が担当）。
 * Node の Buffer を使うが、Electron には依存しない。
 *
 * ArtDMX パケット構造（Art-Net 4 仕様）:
 *   0   ID[8]        "Art-Net\0"
 *   8   OpCode       0x5000 (little-endian)
 *   10  ProtVerHi    0
 *   11  ProtVerLo    14
 *   12  Sequence     1-255（0 は「シーケンス無効」を意味するため使わない）
 *   13  Physical     0
 *   14  SubUni       universe の下位 8bit (Net 内の Sub-Net + Universe)
 *   15  Net          universe の上位 7bit
 *   16  LengthHi     データ長 上位 (big-endian)
 *   17  LengthLo     データ長 下位
 *   18  Data[Length] DMX チャンネルデータ（最大 512）
 */

import { UNIVERSE_SIZE } from '../shared/types';

const ARTNET_ID = 'Art-Net\0';
const OP_OUTPUT = 0x5000; // ArtDMX
const PROTOCOL_VERSION = 14;
const HEADER_SIZE = 18;

export interface ArtDmxAddress {
  /** Art-Net universe (0-15) */
  universe: number;
  /** Net (0-127) */
  net: number;
  /** Sub-Net (0-15) */
  subnet: number;
}

/**
 * 15bit の Port-Address を組み立てる。
 * Net(7bit) << 8 | SubNet(4bit) << 4 | Universe(4bit)。
 * SubUni バイトは下位 8bit、Net バイトは上位 7bit に分割される。
 */
export function portAddress(addr: ArtDmxAddress): { subUni: number; net: number } {
  const subUni = ((addr.subnet & 0x0f) << 4) | (addr.universe & 0x0f);
  const net = addr.net & 0x7f;
  return { subUni, net };
}

/**
 * 512ch の DMX データから ArtDMX パケットを生成する。
 *
 * @param channels 各 ch の値（0-255）。長さは UNIVERSE_SIZE 前提。
 * @param sequence 1-255 のシーケンス番号。
 * @param addr 宛先ポートアドレス。
 */
export function encodeArtDmx(
  channels: readonly number[],
  sequence: number,
  addr: ArtDmxAddress,
): Buffer {
  const length = UNIVERSE_SIZE; // 常に 512ch 送出
  const packet = Buffer.alloc(HEADER_SIZE + length);

  packet.write(ARTNET_ID, 0, 'latin1');
  packet.writeUInt16LE(OP_OUTPUT, 8);
  packet.writeUInt8(0, 10); // ProtVerHi
  packet.writeUInt8(PROTOCOL_VERSION, 11); // ProtVerLo
  packet.writeUInt8(sequence & 0xff, 12);
  packet.writeUInt8(0, 13); // Physical

  const { subUni, net } = portAddress(addr);
  packet.writeUInt8(subUni, 14);
  packet.writeUInt8(net, 15);
  packet.writeUInt16BE(length, 16); // Length は big-endian

  for (let i = 0; i < length; i++) {
    const v = channels[i] ?? 0;
    packet.writeUInt8(clampDmx(v), HEADER_SIZE + i);
  }

  return packet;
}

/** 0-255 に丸める（小数は floor）。 */
export function clampDmx(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.floor(value);
}

/**
 * シーケンス番号を 1→255→1 で巡回させる。
 * 0 は仕様上「シーケンス無効」を意味するためスキップする。
 */
export function nextSequence(current: number): number {
  return current >= 255 ? 1 : current + 1;
}
