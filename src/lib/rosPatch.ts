/**
 * Compatibility shim for the (discontinued) `node-routeros` library on
 * RouterOS v7.
 *
 * v7 replies to an empty result set with a bare `!empty` sentence, where v6
 * sent nothing before `!done`. The bundled library has no case for it: it
 * emits `unknown`, whose listener *throws* `RosException('UNKNOWNREPLY')`.
 * That throw happens synchronously inside the socket 'data' handler, so it
 * escapes every `try/catch`/`.catch()` around `api.write()` and crashes the
 * connection (and, in Node, the process).
 *
 * On v7 the empty-result sequence is `!empty` *followed by* the real
 * `!done`, so we simply swallow the `!empty` sentence and let the trailing
 * `!done` close the channel as usual. (Rewriting `!empty`→`!done` instead
 * closes the channel early, and the trailing `!done` then lands on an
 * unregistered tag — a different crash.) Every other reply is delegated to
 * the original implementation.
 */

type PacketProcessor = (packet: string[]) => void;
interface ChannelProto {
  processPacket: PacketProcessor;
}

const g = globalThis as unknown as { __rosEmptyPatched?: boolean };

if (!g.__rosEmptyPatched) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("node-routeros/dist/Channel") as {
    Channel: { prototype: ChannelProto };
  };
  const proto = mod.Channel.prototype;
  const original = proto.processPacket;

  proto.processPacket = function (this: ChannelProto, packet: string[]) {
    // informational only; the real !done follows and closes the channel
    if (Array.isArray(packet) && packet[0] === "!empty") return;
    return original.call(this, packet);
  };

  g.__rosEmptyPatched = true;
}

export {};
