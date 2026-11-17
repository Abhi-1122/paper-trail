// Paper Trail rules engine. Pure state + actions; the host owns the state.
// applyAction mutates state and returns an error string, or null on success.
// Track positions run -5 (Machine's end) to +5 (Press's end).

export const SIDES = ['machine', 'press'];
export const other = (s) => (s === 'machine' ? 'press' : 'machine');
export const SIGN = { machine: -1, press: 1 };
export const LABEL = { machine: 'City Hall', press: 'The Gazette' };
export const WIN_MOMENTUM = 5;
export const MAX_NAME = 16;
export const WILD = 3;
export const COLOR = ['amber', 'teal', 'violet', 'wild'];
export const SRC = ['The Night Clerk', 'The Auditor', 'The Driver', 'The Intern', 'The Contractor', 'The Ex-Aide', 'The Stenographer'];

/* ------------------------------ evidence board ------------------------------ */
// Mayor in the middle, 7 sources on the rim, 19 evidence spots between them in three rings.

export const NODES = {};
const polar = (r, ang) => ({ x: 50 + r * 0.56 * Math.cos((ang * Math.PI) / 180), y: 50 + r * 0.56 * Math.sin((ang * Math.PI) / 180) });
const link = (a, b) => { NODES[a].adj.push(b); NODES[b].adj.push(a); };
const SPOKE = (i) => (i * 360) / 7 - 90;
const INNER_ANG = [-64, -13, 90, 141, 244];
const INNER_OF = [[0, 4], [0, 1], [1], [2], [2, 3], [3], [4]]; // middle spot i touches these inner spots
for (let i = 0; i < 7; i++) {
  NODES['o' + i] = { id: 'o' + i, c: i % 3, adj: [], ...polar(61, SPOKE(i)) };
  NODES['m' + i] = { id: 'm' + i, c: (i + 1) % 3, adj: [], ...polar(41, SPOKE(i) + 9) };
}
for (let j = 0; j < 5; j++) NODES['c' + j] = { id: 'c' + j, c: (j + 2) % 3, adj: [], inner: true, ...polar(21, INNER_ANG[j]) };
for (let i = 0; i < 7; i++) {
  link('o' + i, 'm' + i);
  link('m' + i, 'm' + ((i + 1) % 7));
  INNER_OF[i].forEach((j) => link('m' + i, 'c' + j));
}
for (let j = 0; j < 5; j++) link('c' + j, 'c' + ((j + 1) % 5));
export const SOURCE_POS = SRC.map((_, i) => polar(80, SPOKE(i)));

// Outer spots reachable from the Mayor through spots that pass(id).
function reach(pass) {
  const seen = new Set(Object.keys(NODES).filter((id) => NODES[id].inner && pass(id)));
  const q = [...seen];
  while (q.length) for (const n of NODES[q.pop()].adj) if (!seen.has(n) && pass(n)) { seen.add(n); q.push(n); }
  return seen;
}
export const linkedSources = (s) => {
  const r = reach((id) => s.board[id]?.side === 'press');
  return SRC.map((_, i) => i).filter((i) => s.sources[i] === 'revealed' && r.has('o' + i));
};
const pressCanStillWin = (s) => {
  const r = reach((id) => s.board[id]?.side !== 'machine');
  return SRC.filter((_, i) => s.sources[i] !== 'silenced' && r.has('o' + i)).length >= 2;
};

/* ------------------------------ cards ------------------------------ */
// [name, value, colour (0-2, 3 = any), action, single-use]

const mv = (ev, mom, init) => ({ t: 'move', ev, mom, init });
const PRESS = [
  ...SRC.map((n, i) => [n, 2 + (i % 2), i % 3, { t: 'reveal', i }, true]),
  ['Front Page', 4, WILD, mv(0, 1, 1)],
  ['Follow the Money', 3, 0, mv(2, 1, 0)],
  ['Records Request', 3, 1, mv(3, 0, 0)],
  ['Stakeout', 3, 2, mv(2, 0, 1)],
  ['Legwork', 3, 1, mv(2, 0, 1)],
  ['Late Edition', 2, 0, { t: 'draw', n: 2 }],
  ['Second Source', 2, 1, { t: 'draw', n: 2 }],
  ['Anonymous Tip', 2, 2, { t: 'leak' }, true],
  ['Whistleblower', 1, WILD, { t: 'leak' }, true],
  ['Editorial', 3, WILD, mv(0, 2, 2)],
  ['Public Outcry', 2, 0, mv(0, 3, 0)],
  ['Court Order', 1, 1, { t: 'discard' }, true],
  ['Deadline Push', 4, 2, mv(0, 0, 3)],
];
const HUSH = [['Quiet Retirement', 0], ['Out-of-Town Posting', 2], ['Sealed Settlement', 4], ['Friendly Reminder', 5]];
const MACHINE = [
  ...HUSH.map(([n, i], k) => [n, 2 + (k % 2), k % 3, { t: 'silence', i }, true]),
  ['Press Conference', 3, WILD, mv(0, 2, 1)],
  ['Spin Cycle', 3, 0, mv(0, 3, 0)],
  ['Stonewall', 3, 1, mv(3, 0, 0)],
  ['Lost in the Mail', 3, 2, mv(2, 0, 1)],
  ['Loyal Staff', 3, 2, mv(2, 1, 0)],
  ['Friendly Judge', 3, 0, mv(2, 1, 0)],
  ['Backroom Deal', 2, 2, mv(3, 0, 0)],
  ['Shredder', 2, 0, { t: 'shred' }, true],
  ['Office Fire', 1, WILD, { t: 'shred' }, true],
  ['Fundraiser', 2, 1, { t: 'draw', n: 2 }],
  ['Old Friends', 2, 2, { t: 'draw', n: 2 }],
  ['Smear Campaign', 1, 1, { t: 'discard' }, true],
  ['Ribbon Cutting', 4, WILD, mv(0, 1, 1)],
  ['Closed Session', 4, 0, mv(0, 0, 3)],
  ['Photo Op', 2, 1, mv(0, 2, 2)],
  ['Rally', 4, 1, mv(0, 3, 1)],
];
export const CARDS = {};
const mk = (side, list) => list.forEach(([name, value, c, action, once], k) => {
  const id = side[0] + k;
  CARDS[id] = { id, side, name, value, c, action, once: !!once };
});
mk('press', PRESS);
mk('machine', MACHINE);

export function describe(a) {
  switch (a.t) {
    case 'reveal': return `Put source #${a.i + 1} (${SRC[a.i]}) on the record.`;
    case 'silence': return `Silence source #${a.i + 1} (${SRC[a.i]}) for good.`;
    case 'move': return 'Pull ' + [a.ev && `any evidence ${a.ev}`, a.mom && `momentum ${a.mom}`, a.init && `initiative ${a.init}`].filter(Boolean).join(' + ') + '.';
    case 'draw': return `Draw ${a.n} cards.`;
    case 'leak': return 'Add a new evidence token from the bag on your 1 space.';
    case 'shred': return 'Destroy one evidence token on the track.';
    case 'discard': return 'Opponent discards a random card.';
  }
}

/* ------------------------------ setup ------------------------------ */

export const cleanName = (raw) => String(raw || '').replace(/\s+/g, ' ').trim();
export const createGame = (code) => ({ code, players: [], phase: 'lobby', log: [] });

export function addPlayer(state, { name, token, isHost = false }) {
  name = cleanName(name);
  if (!name) return { error: 'Enter a name' };
  if ([...name].length > MAX_NAME) return { error: `Name too long (max ${MAX_NAME})` };
  if (state.players.length >= 2) return { error: 'Room is full' };
  const taken = state.players[0]?.role;
  const player = { id: 'p' + (state.players.length + 1), name, token, isHost, role: taken ? other(taken) : 'press', connected: true };
  state.players.push(player);
  return { player };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const log = (s, msg) => { s.log.push(msg); if (s.log.length > 80) s.log.shift(); };

function begin(s, rng) {
  const ids = (side) => Object.keys(CARDS).filter((id) => CARDS[id].side === side);
  Object.assign(s, {
    phase: 'play', round: 0, initiative: 'press', nextInit: null, turn: 'press', winner: null, reason: '',
    track: { init: 0, mom: 0, ev: [] }, uid: 1,
    bag: shuffle([0, 1, 2].flatMap((c) => Array(8).fill(c)).concat(Array(5).fill(WILD)), rng),
    board: {}, sources: SRC.map(() => null), momentum: { machine: 0, press: 0 },
    hands: { machine: [], press: [] }, decks: { machine: shuffle(ids('machine'), rng), press: shuffle(ids('press'), rng) },
    discards: { machine: [], press: [] }, pending: [], turnDone: false, roundEnding: false, last: null, log: [],
  });
  startRound(s, rng);
}

function draw(s, side, n, rng) {
  for (let k = 0; k < n; k++) {
    if (!s.decks[side].length) { s.decks[side] = shuffle(s.discards[side], rng); s.discards[side] = []; }
    if (s.decks[side].length) s.hands[side].push(s.decks[side].pop());
  }
}

function startRound(s, rng) {
  s.round++;
  s.track.init = 0;
  s.track.mom = 0;
  while (s.track.ev.length < 3 && s.bag.length) s.track.ev.push({ id: s.uid++, c: s.bag.pop(), pos: 0 });
  if (!s.track.ev.length) return win(s, 'machine', 'The evidence ran dry. The story dies on the desk.');
  draw(s, s.initiative, 5, rng);
  draw(s, other(s.initiative), 4, rng);
  s.turn = s.initiative;
  log(s, `Round ${s.round}: ${LABEL[s.initiative]} has the initiative.`);
}

function win(s, side, reason) {
  s.phase = 'over'; s.winner = side; s.reason = reason; s.pending = [];
  log(s, `${LABEL[side]} wins. ${reason}`);
}

/* ------------------------------ track ------------------------------ */

const matches = (card, tok) => card.c === WILD || tok.c === WILD || card.c === tok.c;
export const legalNodes = (s, c) => Object.keys(NODES).filter((id) => !s.board[id] && (c === WILD || NODES[id].c === c));

// Tokens a card may target: 'init', 'mom' or an index into track.ev.
export function targets(s, cardId, mode) {
  const card = CARDS[cardId];
  const evs = s.track.ev.map((_, i) => i);
  if (mode === 'value') return [s.track.init != null && 'init', s.track.mom != null && 'mom', ...evs.filter((i) => matches(card, s.track.ev[i]))].filter((t) => t !== false);
  const a = card.action;
  return (a.t === 'move' && a.ev) || a.t === 'shred' ? evs : [];
}

function claimMomentum(s, side) {
  s.track.mom = null;
  s.momentum[side]++;
  log(s, `${LABEL[side]} takes the momentum (${s.momentum[side]}).`);
  if (side === 'machine' && s.momentum.machine >= WIN_MOMENTUM) win(s, 'machine', 'City Hall rides the momentum to re-election.');
}

function pull(s, side, target, n) {
  if (!n || s.phase === 'over') return;
  const step = (pos) => Math.max(-5, Math.min(5, pos + SIGN[side] * n));
  const edge = SIGN[side] * 5;
  if (target === 'init') {
    if (s.track.init == null) return;
    s.track.init = step(s.track.init);
    if (s.track.init === edge) { s.track.init = null; s.nextInit = side; log(s, `${LABEL[side]} seizes the initiative.`); }
  } else if (target === 'mom') {
    if (s.track.mom == null) return;
    s.track.mom = step(s.track.mom);
    if (s.track.mom === edge) claimMomentum(s, side);
  } else {
    const tok = s.track.ev[target];
    if (!tok) return;
    tok.pos = step(tok.pos);
    if (tok.pos === edge) { s.track.ev.splice(target, 1); s.pending.push({ side, c: tok.c, id: tok.id }); }
  }
}

function endRound(s) {
  const sideOf = (pos) => (pos < 0 ? 'machine' : pos > 0 ? 'press' : null);
  if (s.track.init != null) s.nextInit = sideOf(s.track.init) || other(s.initiative);
  s.initiative = s.nextInit;
  s.nextInit = null;
  if (s.track.mom != null && s.track.mom !== 0) claimMomentum(s, sideOf(s.track.mom));
  if (s.phase === 'over') return;
  s.track.ev = s.track.ev.filter((t) => {
    if (!t.pos) return true; // dead centre: stays for next round
    s.pending.push({ side: sideOf(t.pos), c: t.c, id: t.id });
    return false;
  });
  s.roundEnding = true;
}

// Drives the game forward after any change: placements first, then turn / round hand-over.
function cont(s, rng) {
  for (;;) {
    if (s.phase === 'over') return;
    while (s.pending.length && !legalNodes(s, s.pending[0].c).length) s.pending.shift();
    if (s.pending.length) { s.phase = 'place'; return; }
    s.phase = 'play';
    if (s.roundEnding) { s.roundEnding = false; startRound(s, rng); return; }
    if (!s.turnDone) return;
    s.turnDone = false;
    if (!s.hands.machine.length && !s.hands.press.length) { endRound(s); continue; }
    if (s.hands[other(s.turn)].length) s.turn = other(s.turn);
    return;
  }
}

/* ------------------------------ actions ------------------------------ */

// action: { kind, card?, mode?, target?, node? }
export function applyAction(s, playerId, a, rng = Math.random) {
  const p = s.players.find((q) => q.id === playerId);
  if (!p || !a) return 'Not in this game';
  const side = p.role;

  if (a.kind === 'swap') {
    if (s.phase !== 'lobby' || !p.isHost) return 'Only the host can swap sides in the lobby';
    s.players.forEach((q) => { q.role = other(q.role); });
    return null;
  }
  if (a.kind === 'start' || a.kind === 'restart') {
    if (!p.isHost) return 'Only the host can start';
    if (s.players.length < 2) return 'Waiting for your opponent';
    if (a.kind === 'start' && s.phase !== 'lobby') return 'Already started';
    begin(s, rng);
    return null;
  }

  if (a.kind === 'place') {
    if (s.phase !== 'place') return 'Nothing to place';
    const tok = s.pending[0];
    if (tok.side !== side) return 'Waiting for your opponent to place evidence';
    if (!legalNodes(s, tok.c).includes(a.node)) return 'That evidence cannot go there';
    s.board[a.node] = { side, id: tok.id, c: tok.c };
    s.pending.shift();
    log(s, side === 'press' ? 'The Gazette pins evidence to the board.' : 'City Hall buries a piece of evidence.');
    if (linkedSources(s).length >= 2) win(s, 'press', 'Two sources are tied to the Mayor. The story runs.');
    else if (!pressCanStillWin(s)) win(s, 'machine', 'Every trail to the Mayor is buried.');
    cont(s, rng);
    return null;
  }

  if (a.kind === 'play') {
    if (s.phase !== 'play') return 'Not now';
    if (s.turn !== side) return 'Not your turn';
    const hand = s.hands[side];
    const at = hand.indexOf(a.card);
    const card = CARDS[a.card];
    if (at < 0 || !card) return 'You do not hold that card';
    const ok = targets(s, a.card, a.mode);
    let burn = false;
    if (a.mode === 'value') {
      // No token this card can move: it may still be thrown away so a turn is never stuck.
      if (ok.length && !ok.includes(a.target)) return 'Pick a token this card can move';
      if (ok.length) pull(s, side, a.target, card.value);
    } else if (a.mode === 'action') {
      const act = card.action;
      if (ok.length && !ok.includes(a.target)) return 'Pick an evidence token';
      if ((act.t === 'reveal' || act.t === 'silence') && s.sources[act.i]) return `That source is already ${s.sources[act.i]}`;
      if (act.t === 'shred' && !ok.length) return 'No evidence on the track';
      if (act.t === 'leak' && !s.bag.length) return 'The bag is empty';
      burn = card.once;
      if (act.t === 'reveal') s.sources[act.i] = 'revealed';
      if (act.t === 'silence') s.sources[act.i] = 'silenced';
      if (act.t === 'draw') { hand.splice(at, 1); draw(s, side, act.n, rng); hand.splice(at, 0, a.card); }
      if (act.t === 'leak') s.track.ev.push({ id: s.uid++, c: s.bag.pop(), pos: SIGN[side] });
      if (act.t === 'shred') s.track.ev.splice(a.target, 1);
      if (act.t === 'discard') {
        const oh = s.hands[other(side)];
        if (oh.length) s.discards[other(side)].push(oh.splice(Math.floor(rng() * oh.length), 1)[0]);
      }
      if (act.t === 'move') { pull(s, side, 'init', act.init); pull(s, side, 'mom', act.mom); if (ok.length) pull(s, side, a.target, act.ev); }
    } else return 'Choose the number or the action';
    hand.splice(hand.indexOf(a.card), 1);
    if (!burn) s.discards[side].push(a.card);
    s.last = { side, card: a.card, mode: a.mode, n: (s.last?.n || 0) + 1 };
    log(s, `${LABEL[side]} plays ${card.name} for its ${a.mode === 'value' ? 'number (' + card.value + ')' : 'action'}.`);
    if (s.phase !== 'over') {
      if (linkedSources(s).length >= 2) win(s, 'press', 'Two sources are tied to the Mayor. The story runs.');
      else if (!pressCanStillWin(s)) win(s, 'machine', 'Too many sources silenced. Nobody is left to talk.');
    }
    s.turnDone = true;
    cont(s, rng);
    return null;
  }
  return 'Unknown action';
}

// What one player may see: the opponent's hand, both decks and the bag stay hidden.
export function viewFor(state, id) {
  const v = structuredClone(state);
  const me = v.players.find((p) => p.id === id);
  v.players.forEach((p) => { delete p.token; });
  v.you = me ? { id: me.id, role: me.role, isHost: me.isHost } : null;
  if (v.phase === 'lobby') return v;
  if (me) v.hands[other(me.role)] = v.hands[other(me.role)].map(() => null);
  v.decks = { machine: v.decks.machine.length, press: v.decks.press.length };
  v.bag = v.bag.length;
  return v;
}
