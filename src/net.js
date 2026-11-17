// Trystero wrapper: host and client message plumbing (same shape as the mafia game).
import { joinRoom } from 'trystero';
import { addPlayer, applyAction, viewFor } from './game.js';

// ponytail: add a TURN server if players on strict networks can't connect, e.g.
// { urls: ['turn:host:3478'], username: 'u', credential: 'p' }
export const TURN_SERVERS = [];

const APP_ID = 'paper-trail-p2p-v1';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_TIMEOUT_MS = 12000;

export const genCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
};
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
export const validCode = (s) => s.length === 4 && [...s].every((c) => CODE_CHARS.includes(c));

function open(code) {
  const cfg = { appId: APP_ID };
  if (TURN_SERVERS.length) cfg.turnConfig = TURN_SERVERS;
  const room = joinRoom(cfg, code);
  return { room, hello: room.makeAction('hello'), act: room.makeAction('act'), view: room.makeAction('view'), err: room.makeAction('err') };
}
const quiet = (p) => p && p.catch && p.catch(() => {});
export const BUILD = new URL(import.meta.url).pathname;
// Only these fields cross the wire from a client.
const clean = (d) => ({ kind: d.kind, card: d.card, mode: d.mode, target: d.target, node: d.node });

/* ------------------------------ host ------------------------------ */

export function hostRoom(state, onChange) {
  const { room, hello, act, view, err } = open(state.code);
  const peers = new Map(); // peerId -> playerId

  const peerOf = (pid) => [...peers].find(([, v]) => v === pid)?.[0];
  const sendView = (p) => {
    const peer = peerOf(p.id);
    if (peer && !p.isHost) quiet(view.send({ ...viewFor(state, p.id), build: BUILD }, { target: peer }));
  };
  const changed = () => {
    state.players.forEach(sendView);
    onChange(state);
  };
  const hostPlayer = () => state.players.find((p) => p.isHost);

  hello.onMessage = (data, { peerId }) => {
    const reply = (msg) => quiet(err.send({ msg }, { target: peerId }));
    if (!data || typeof data.token !== 'string') return;
    const known = state.players.find((p) => p.token === data.token);
    if (known) {
      if (known.isHost) return;
      for (const [k, v] of peers) if (v === known.id) peers.delete(k);
      peers.set(peerId, known.id);
      known.connected = true;
      return changed();
    }
    if (state.phase !== 'lobby') return reply('Game already in progress');
    const r = addPlayer(state, { name: data.name, token: data.token });
    if (r.error) return reply(r.error);
    peers.set(peerId, r.player.id);
    changed();
  };

  const run = (pid, action) => {
    const e = applyAction(state, pid, action);
    if (!e) changed();
    return e;
  };

  act.onMessage = (data, { peerId }) => {
    const pid = peers.get(peerId);
    if (!pid) return quiet(err.send({ msg: 'Not in this game' }, { target: peerId }));
    const e = data && typeof data === 'object' ? run(pid, clean(data)) : 'Bad action';
    if (e) quiet(err.send({ msg: e }, { target: peerId }));
  };

  room.onPeerLeave = (peerId) => {
    const pid = peers.get(peerId);
    if (!pid) return;
    peers.delete(peerId);
    if (state.phase === 'lobby') state.players = state.players.filter((p) => p.id !== pid);
    else {
      const p = state.players.find((q) => q.id === pid);
      if (p) p.connected = false;
    }
    changed();
  };

  return {
    act: (action) => run(hostPlayer().id, action),
    changed,
    leave: () => room.leave(),
  };
}

/* ----------------------------- client ----------------------------- */

// handlers: onView(view), onErr(msg), onTimeout(), onHostLost()
export function joinClient(code, { name, token }, handlers) {
  const { room, hello, act, view, err } = open(code);
  let hostPeer = null;
  const timer = setTimeout(() => handlers.onTimeout(), JOIN_TIMEOUT_MS);
  const hi = (target) => quiet(hello.send({ name, token }, target ? { target } : undefined));

  room.onPeerJoin = (peerId) => hi(peerId);
  room.onPeerLeave = (peerId) => {
    if (peerId === hostPeer) { hostPeer = null; handlers.onHostLost(); }
  };
  view.onMessage = (v, { peerId }) => {
    if (hostPeer && peerId !== hostPeer) return;
    hostPeer = peerId;
    clearTimeout(timer);
    handlers.onView(v);
  };
  err.onMessage = (e, { peerId }) => {
    if (hostPeer && peerId !== hostPeer) return;
    clearTimeout(timer);
    handlers.onErr(e && typeof e.msg === 'string' ? e.msg : 'Error');
  };

  return {
    send: (action) => !!hostPeer && (quiet(act.send(action, { target: hostPeer })), true),
    rehello: () => hi(),
    leave: () => { clearTimeout(timer); room.leave(); },
  };
}
