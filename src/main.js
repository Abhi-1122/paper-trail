import './style.css';
import { inject } from '@vercel/analytics';
import {
  createGame, addPlayer, viewFor, cleanName, other, targets, legalNodes, linkedSources, describe,
  CARDS, NODES, SOURCE_POS, SRC, COLOR, LABEL, SIGN, WILD, WIN_MOMENTUM, MAX_NAME,
} from './game.js';
import { hostRoom, joinClient, genCode, normCode, validCode, BUILD } from './net.js';

inject();

/* ------------------------------ helpers ------------------------------ */

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* no storage: still works */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  json(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
};
const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
const getToken = () => {
  let t = store.get('pt-token');
  if (!t) { t = uuid(); store.set('pt-token', t); }
  return t;
};

// DOM builder. Strings become text nodes, so player-supplied text is never parsed as HTML.
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') for (const [a, b] of Object.entries(v)) e.style.setProperty(a, b);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}
const svg = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 3200);
}

/* ------------------------------ app state ------------------------------ */

const S = {
  mode: 'home', // home | connecting | error | game
  view: null, host: null, state: null, client: null,
  lostHost: false, stale: false, tmp: null, errMsg: '',
  sel: null, pick: null, // selected card id; pick = 'value' | 'action' while choosing a token
  tutorial: false, // personal toggle, off on every load
  info: null, sheet: null, overHidden: false, lastV: null,
};

function doAct(action) {
  if (S.host) {
    const e = S.host.act(action);
    if (e) toast(e);
  } else if (S.client && !S.client.send(action)) toast('Reconnecting to host...');
}

const shareUrl = (code) => `${location.origin}/?room=${code}`;
async function share(code) {
  const url = shareUrl(code);
  try {
    if (navigator.share) { await navigator.share({ title: 'Paper Trail', text: `Play Paper Trail with me: ${code}`, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
}

let wake = null;
async function keepAwake() {
  try {
    if (!navigator.wakeLock || wake || document.visibilityState !== 'visible') return;
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch { /* not allowed: fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !(S.host || S.client)) return;
  keepAwake();
  S.client?.rehello();
});

/* ------------------------------ session ------------------------------ */

function resetLocal() {
  S.host?.leave();
  S.client?.leave();
  Object.assign(S, { host: null, client: null, state: null, view: null, lostHost: false, tmp: null, sel: null, pick: null, lastV: null, sheet: null });
  try { wake?.release(); } catch { /* ignore */ }
  wake = null;
}

function goHome(msg) {
  const session = store.json('pt-session');
  if (session?.host) store.del('pt-host-' + session.room);
  store.del('pt-session');
  resetLocal();
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  S.mode = 'home';
  render();
  if (msg) toast(msg);
}

function setUrl(code) { try { history.replaceState(null, '', '?room=' + code); } catch { /* ignore */ } }

function onHostChange(state) {
  store.set('pt-host-' + state.code, JSON.stringify(state));
  S.view = viewFor(state, state.players.find((p) => p.isHost).id);
  S.mode = 'game';
  render();
}

function startHost(state, session) {
  S.state = state;
  S.host = hostRoom(state, onHostChange);
  store.set('pt-session', JSON.stringify({ ...session, host: true }));
  setUrl(state.code);
  keepAwake();
  S.host.changed();
}

function createRoom(rawName) {
  const name = cleanName(rawName);
  const state = createGame(genCode());
  const r = addPlayer(state, { name, token: getToken(), isHost: true });
  if (r.error) return toast(r.error);
  store.set('pt-name', name);
  resetLocal();
  startHost(state, { room: state.code, name });
}

function joinRoomAs(code, rawName) {
  const name = cleanName(rawName);
  if (!name) return toast('Enter a name');
  if ([...name].length > MAX_NAME) return toast(`Name too long (max ${MAX_NAME})`);
  if (!validCode(code)) return toast('Enter the 4-character room code');
  store.set('pt-name', name);
  resetLocal();
  S.mode = 'connecting';
  S.tmp = { code };
  setUrl(code);
  keepAwake();
  S.client = joinClient(code, { name, token: getToken() }, {
    onView(v) {
      if (!S.client) return;
      store.set('pt-session', JSON.stringify({ room: code, name }));
      S.mode = 'game';
      S.lostHost = false;
      S.stale = v.build !== BUILD;
      S.view = v;
      render();
    },
    onErr(msg) {
      if (msg === 'Not in this game') return S.client?.rehello();
      if (S.mode !== 'game') return goHome(msg);
      toast(msg);
    },
    onTimeout() { S.mode = 'error'; S.errMsg = 'Room not found or host offline'; render(); },
    onHostLost() { S.lostHost = true; render(); },
  });
  render();
}

/* ------------------------------ screens ------------------------------ */

function home() {
  const params = new URLSearchParams(location.search);
  const name = h('input', { class: 'input', placeholder: 'Your name', maxlength: 32, autocomplete: 'off', 'aria-label': 'Your name', value: store.get('pt-name') || '' });
  const code = h('input', { class: 'input code', placeholder: 'CODE', maxlength: 4, autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Room code', value: normCode(params.get('room')) });
  return h('section', { class: 'home' },
    h('div', { class: 'masthead' },
      h('span', { class: 'kicker' }, 'Late city edition · two players'),
      h('h1', {}, 'Paper Trail'),
      h('p', { class: 'deck' }, 'City Hall buries it. The Gazette digs it up. One of you gets the last word.'),
      h('div', { class: 'stamp' }, 'CONFIDENTIAL')),
    h('div', { class: 'card' },
      name,
      h('button', { class: 'btn primary big', onclick: () => createRoom(name.value) }, 'Open a new case'),
      h('div', { class: 'or' }, 'or join with a code'),
      h('div', { class: 'row' }, code, h('button', { class: 'btn big', onclick: () => joinRoomAs(normCode(code.value), name.value) }, 'Join'))),
    h('button', { class: 'btn ghost', onclick: () => { S.sheet = 'rules'; render(); } }, 'How to play'));
}

const connecting = () => h('section', { class: 'card center mid' }, h('div', { class: 'typing' }, h('i'), h('i'), h('i')), h('p', {}, `Calling room ${S.tmp?.code}...`));
const errorScreen = () => h('section', { class: 'card center mid' }, h('p', {}, S.errMsg), h('button', { class: 'btn', onclick: () => goHome() }, 'Back'));

function tutorToggle() {
  return h('button', {
    class: 'btn sm tutor ' + (S.tutorial ? 'on' : ''), 'aria-pressed': String(S.tutorial),
    onclick: () => { S.tutorial = !S.tutorial; S.info = null; render(); },
  }, S.tutorial ? 'Tutor on' : 'Tutor off');
}
const menuBtn = () => h('button', { class: 'btn sm icon', 'aria-label': 'Menu', onclick: () => { S.sheet = 'menu'; render(); } }, '☰');

function lobby(v) {
  const me = v.you;
  const seat = (role) => {
    const p = v.players.find((q) => q.role === role);
    return h('div', { class: `seat ${role} ${p ? 'taken' : ''}` },
      h('span', { class: 'seat-role' }, LABEL[role]),
      h('b', {}, p ? p.name + (p.id === me.id ? ' (you)' : '') : 'Waiting...'),
      h('span', { class: 'muted' }, role === 'press' ? 'Tie two sources to the Mayor.' : `Take ${WIN_MOMENTUM} momentum, or bury every trail.`));
  };
  return h('section', { class: 'lobby' },
    h('div', { class: 'topbar' }, h('span', { class: 'brand' }, 'Paper Trail'), h('span', { class: 'grow' }), tutorToggle(), menuBtn()),
    h('div', { class: 'card' },
      h('div', { class: 'roomcode' }, h('span', { class: 'muted' }, 'Room'), h('b', {}, v.code)),
      h('button', { class: 'btn', onclick: () => share(v.code) }, 'Share invite link'),
      h('div', { class: 'seats' }, seat('press'), seat('machine')),
      me.isHost
        ? h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => doAct({ kind: 'swap' }) }, 'Swap sides'),
          h('button', { class: 'btn primary grow', disabled: v.players.length < 2, onclick: () => doAct({ kind: 'start' }) }, v.players.length < 2 ? 'Waiting for opponent' : 'Start'))
        : h('p', { class: 'muted center' }, 'Waiting for the host to start.')),
    S.tutorial && h('div', { class: 'instructor' }, h('span', { class: 'ins-ico' }, '✎'),
      h('div', {}, h('p', {}, 'The two sides play differently. The Gazette wins by connecting two on-the-record sources to the Mayor with evidence. City Hall wins by collecting momentum or by burying every route.'),
        h('p', {}, 'Full rules are under ☰ → How to play.'))));
}

/* ---- game ---- */

const me = (v) => v.you.role;
const myTurn = (v) => v.phase === 'play' && v.turn === me(v);
const myPlace = (v) => v.phase === 'place' && v.pending[0].side === me(v);
const pickTargets = (v) => (myTurn(v) && S.sel && S.pick ? targets(v, S.sel, S.pick) : []);

function playCard(v, mode, target) {
  doAct({ kind: 'play', card: S.sel, mode, target });
  S.sel = null; S.pick = null;
  render();
}
function chooseMode(v, mode) {
  const ts = targets(v, S.sel, mode);
  if (!ts.length) return playCard(v, mode);
  if (ts.length === 1 && mode === 'action') return playCard(v, mode, ts[0]);
  S.pick = mode;
  render();
}

function infoTitle(key, label) {
  return h('span', {
    class: 'ztitle' + (S.tutorial ? ' tappable' : '') + (S.info === key ? ' active' : ''),
    onclick: S.tutorial ? () => { S.info = S.info === key ? null : key; render(); } : null,
  }, label, S.tutorial && h('i', { class: 'q' }, '?'));
}

function scoreline(v) {
  const linked = linkedSources(v).length;
  return h('div', { class: 'score' },
    h('div', { class: 'sc machine' + (me(v) === 'machine' ? ' you' : '') },
      h('b', {}, 'City Hall'),
      h('span', { class: 'pips' }, Array.from({ length: WIN_MOMENTUM }, (_, i) => h('i', { class: 'pip' + (i < v.momentum.machine ? ' on' : ''), 'data-k': i < v.momentum.machine ? 'mpip' + i : null })))),
    h('div', { class: 'sc mid' }, `Round ${v.round}`, h('span', {}, `bag ${v.bag}`)),
    h('div', { class: 'sc press' + (me(v) === 'press' ? ' you' : '') },
      h('span', { class: 'pips' }, [0, 1].map((i) => h('i', { class: 'pip link' + (i < linked ? ' on' : '') }))),
      h('b', {}, 'Gazette')));
}

function board(v) {
  const placing = myPlace(v) ? legalNodes(v, v.pending[0].c) : [];
  const lines = svg('svg', { viewBox: '0 0 100 100', class: 'edges' });
  const seg = (a, b, cls) => lines.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls }));
  const own = (id) => v.board[id]?.side;
  for (const n of Object.values(NODES)) {
    for (const b of n.adj) if (n.id < b) seg(n, NODES[b], own(n.id) === 'press' && own(b) === 'press' ? 'hot' : own(n.id) === 'machine' || own(b) === 'machine' ? 'cut' : '');
    if (n.inner) seg(n, { x: 50, y: 50 }, own(n.id) === 'press' ? 'hot' : own(n.id) === 'machine' ? 'cut' : '');
  }
  const linked = linkedSources(v);
  SRC.forEach((_, i) => seg(NODES['o' + i], SOURCE_POS[i], linked.includes(i) ? 'hot' : v.sources[i] === 'silenced' || own('o' + i) === 'machine' ? 'cut' : ''));
  return h('div', { class: 'zone board-zone' },
    h('div', { class: 'zhead' }, infoTitle('board', 'Evidence board'),
      v.phase === 'place' && h('span', { class: 'note' }, myPlace(v) ? 'Tap a glowing spot' : 'Opponent is placing')),
    h('div', { class: 'board' },
      lines,
      h('div', { class: 'mayor' }, 'MAYOR'),
      Object.values(NODES).map((n) => {
        const t = v.board[n.id];
        const ok = placing.includes(n.id);
        return h('button', {
          class: `node c-${COLOR[n.c]} ${ok ? 'ok' : ''}`, style: { left: n.x + '%', top: n.y + '%' }, disabled: !ok, 'aria-label': `${COLOR[n.c]} evidence spot`,
          onclick: () => doAct({ kind: 'place', node: n.id }),
        }, t && h('span', { class: `tok ev ${t.side === 'machine' ? 'buried' : 'c-' + COLOR[t.c]}`, 'data-k': 'ev' + t.id }));
      }),
      SRC.map((name, i) => h('div', { class: `source ${v.sources[i] || ''} ${linked.includes(i) ? 'linked' : ''}`, style: { left: SOURCE_POS[i].x + '%', top: SOURCE_POS[i].y + '%' }, title: name },
        h('span', { 'data-k': 'src' + i + (v.sources[i] || '') }, v.sources[i] === 'silenced' ? '✕' : i + 1)))));
}

function track(v) {
  const ts = pickTargets(v);
  const lane = (key, target, pos, cls, glyph, label) => pos != null && h('div', { class: 'lane' },
    h('button', {
      class: `tok ${cls} ${ts.includes(target) ? 'ok' : ''}`, 'data-k': key, style: { '--p': (pos + 5) / 10 }, disabled: !ts.includes(target), 'aria-label': label,
      onclick: () => playCard(v, S.pick, target),
    }, glyph));
  return h('div', { class: 'zone track-zone' },
    h('div', { class: 'zhead' }, infoTitle('track', 'Tug track'), S.pick && h('span', { class: 'note' }, 'Tap a glowing token')),
    h('div', { class: 'track' },
      h('div', { class: 'ticks' }, [5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5].map((n, i) => h('span', { class: i < 5 ? 'm' : i > 5 ? 'p' : 'z' }, n))),
      lane('init', 'init', v.track.init, 'init', '★', 'Initiative'),
      lane('mom', 'mom', v.track.mom, 'mom', '▲', 'Momentum'),
      v.track.ev.map((t, i) => lane('ev' + t.id, i, t.pos, 'ev c-' + COLOR[t.c], '', COLOR[t.c] + ' evidence'))),
    h('div', { class: 'legend' }, h('span', {}, '★ initiative'), h('span', {}, '▲ momentum'), h('span', {}, '● evidence'),
      v.track.init == null && h('span', { class: 'gone' }, '★ taken'), v.track.mom == null && h('span', { class: 'gone' }, '▲ taken')));
}

function cardFace(id, props = {}) {
  const c = CARDS[id];
  return h('button', { class: `pcard ${c.side} ${props.cls || ''}`, 'data-k': 'card' + id, disabled: props.disabled, onclick: props.onclick, 'aria-label': c.name },
    h('span', { class: 'val c-' + COLOR[c.c] }, c.value),
    c.once && h('span', { class: 'once' }, '1×'),
    h('span', { class: 'cname' }, c.name),
    h('span', { class: 'ctext' }, describe(c.action)));
}

function lastPlay(v) {
  if (!v.last) return null;
  const c = CARDS[v.last.card];
  return h('div', { class: 'last ' + v.last.side, 'data-k': 'last' + v.last.n },
    h('b', {}, v.last.side === me(v) ? 'You' : LABEL[v.last.side]), ' played ', h('i', {}, c.name),
    v.last.mode === 'value' ? ` for ${c.value}` : `: ${describe(c.action)}`);
}

function tray(v) {
  const role = me(v);
  const hand = v.hands[role];
  if (S.sel && (!hand.includes(S.sel) || !myTurn(v))) { S.sel = null; S.pick = null; }
  const c = S.sel && CARDS[S.sel];
  const status = v.phase === 'place'
    ? (myPlace(v) ? `Place your ${COLOR[v.pending[0].c]} evidence on the board.` : 'Opponent is placing evidence...')
    : myTurn(v) ? (S.pick ? 'Tap a glowing token on the track.' : S.sel ? 'Number or action?' : 'Your turn: pick a card.')
      : `${LABEL[v.turn]} is thinking...`;
  const vt = c ? targets(v, S.sel, 'value') : [];
  return h('div', { class: `tray ${role} ${myTurn(v) || myPlace(v) ? 'live' : ''}` },
    h('div', { class: 'tray-status' }, h('span', {}, status),
      h('span', { class: 'opp' }, v.hands[other(role)].map(() => h('i', { class: 'back ' + other(role) })))),
    c && !S.pick && h('div', { class: 'choose' },
      h('button', { class: 'btn', onclick: () => chooseMode(v, 'value') }, vt.length ? h('span', {}, 'Pull ', h('b', {}, c.value), c.c === WILD ? ' (any token)' : h('i', { class: 'dot c-' + COLOR[c.c] })) : 'Discard (nothing to pull)'),
      h('button', { class: 'btn primary', onclick: () => chooseMode(v, 'action') }, 'Action', c.once && ' (1×)')),
    S.pick && h('div', { class: 'choose' }, h('button', { class: 'btn ghost', onclick: () => { S.pick = null; render(); } }, 'Back')),
    h('div', { class: 'hand', style: { '--n': Math.max(hand.length, 4) } }, hand.map((id) => cardFace(id, {
      cls: S.sel === id ? 'sel' : '',
      disabled: !myTurn(v),
      onclick: () => { S.sel = S.sel === id ? null : id; S.pick = null; render(); },
    }))));
}

const INFO = {
  board: 'The Mayor sits in the middle, seven numbered sources on the rim. Evidence the Gazette wins goes face-up on a spot of its colour; evidence City Hall wins is buried there instead and blocks the route. The Gazette needs an unbroken chain of its own evidence from the Mayor to two sources that are on the record.',
  track: 'Everything is a tug of war. City Hall pulls left, the Gazette pulls right. A token that reaches an end (5) is claimed at once. When both hands are empty, every token goes to the side it sits on; tokens at 0 stay. ★ decides who leads next round (5 cards instead of 4). ▲ is momentum: City Hall wins with ' + WIN_MOMENTUM + '.',
};

function hint(v) {
  const role = me(v);
  const lines = [];
  if (S.info) lines.push(h('p', { class: 'info' }, INFO[S.info]));
  if (v.phase === 'place') lines.push(myPlace(v)
    ? (role === 'press' ? 'Build toward a source you can reveal, starting next to the Mayor or next to evidence you already have.' : 'Bury evidence where it cuts the most routes: the five spots around the Mayor are the choke points.')
    : 'Your opponent won a piece of evidence and is choosing where it goes.');
  else if (!myTurn(v)) lines.push('Watch what they pull. Tokens on their side at the end of the round are theirs.');
  else if (!S.sel) {
    lines.push('Each card is played once, either for its number (pull one token that many steps toward you) or for its action text.');
    const danger = [v.track.mom != null && v.track.mom * SIGN[role] <= -3 && 'momentum', v.track.init != null && v.track.init * SIGN[role] <= -3 && 'initiative', v.track.ev.some((t) => t.pos * SIGN[role] <= -3) && 'evidence'].filter(Boolean);
    if (danger.length) lines.push(`Careful: ${danger.join(' and ')} sit deep on their side.`);
    if (role === 'machine') lines.push(`You have ${v.momentum.machine}/${WIN_MOMENTUM} momentum.`);
    else lines.push(`${linkedSources(v).length}/2 sources tied to the Mayor. Sources on record: ${v.sources.filter((x) => x === 'revealed').length}.`);
  } else {
    const c = CARDS[S.sel];
    lines.push(`Number: pull ${c.c === WILD ? 'any one token' : `initiative, momentum or ${COLOR[c.c]} evidence`} ${c.value} step${c.value > 1 ? 's' : ''}. Striped evidence counts as every colour.`);
    lines.push(`Action: ${describe(c.action)}${c.once ? ' The card then leaves the game.' : ''}`);
  }
  return h('div', { class: 'instructor' }, h('span', { class: 'ins-ico' }, '✎'), h('div', {}, lines.map((l) => (l instanceof Node ? l : h('p', {}, l)))));
}

function rulesList() {
  return h('ol', { class: 'rules' },
    h('li', {}, h('b', {}, 'Sides. '), 'One player is City Hall, the other is The Gazette. Each has its own 20-card deck.'),
    h('li', {}, h('b', {}, 'Gazette wins '), 'by tying two on-the-record sources to the Mayor with an unbroken chain of its own evidence.'),
    h('li', {}, h('b', {}, 'City Hall wins '), `by collecting ${WIN_MOMENTUM} momentum, by leaving the Gazette no possible route, or when the evidence bag runs dry.`),
    h('li', {}, h('b', {}, 'Each round. '), 'Three evidence tokens, the initiative ★ and the momentum ▲ start at 0 on the track. Whoever holds the initiative draws 5 cards and leads; the other draws 4. Take turns playing one card until both hands are empty.'),
    h('li', {}, h('b', {}, 'Playing a card. '), 'Either use its number: pull the initiative, the momentum, or one evidence token of the card’s colour that many steps toward you. Or use its action. Cards marked 1× leave the game after their action.'),
    h('li', {}, h('b', {}, 'Reaching 5. '), 'A token pulled all the way to your end is yours immediately.'),
    h('li', {}, h('b', {}, 'End of round. '), 'Each token goes to the side it sits on. Tokens at 0 stay (the initiative at 0 swaps to the other player).'),
    h('li', {}, h('b', {}, 'Evidence. '), 'The Gazette places won evidence face-up on an empty spot of that colour. City Hall buries it there instead, blocking the route. Striped evidence fits any spot.'),
    h('li', {}, h('b', {}, 'Sources. '), 'A source only counts once a Gazette card has put it on the record. City Hall has cards that silence four of them for good: ' + [1, 3, 5, 6].map((n) => '#' + n).join(', ') + '.'),
    h('li', {}, h('b', {}, 'The sources. '), SRC.map((n, i) => `#${i + 1} ${n}`).join(' · ')));
}

function sheet(v) {
  if (!S.sheet) return null;
  const close = () => { S.sheet = null; render(); };
  const body = S.sheet === 'rules'
    ? [h('h2', {}, 'How to play'), rulesList()]
    : [
      h('h2', {}, 'Menu'),
      v && h('div', { class: 'roomcode' }, h('span', { class: 'muted' }, 'Room'), h('b', {}, v.code), h('button', { class: 'btn sm', onclick: () => share(v.code) }, 'Share')),
      h('button', { class: 'btn', onclick: () => { S.sheet = 'rules'; render(); } }, 'How to play (rules)'),
      v?.log?.length && h('details', { class: 'log' }, h('summary', {}, 'Case log'), h('ul', {}, v.log.slice().reverse().map((l) => h('li', {}, l)))),
      v?.you?.isHost && v.phase !== 'lobby' && h('button', { class: 'btn ghost', onclick: () => confirm('Restart the game?') && (doAct({ kind: 'restart' }), close()) }, 'Restart game'),
      h('button', { class: 'btn danger', onclick: () => confirm(S.host ? 'Leave? The game ends for both of you.' : 'Leave this game?') && goHome() }, 'Leave'),
    ];
  return h('div', { class: 'sheet-wrap' },
    h('div', { class: 'scrim', onclick: close }),
    h('div', { class: 'sheet' }, h('div', { class: 'grab' }), h('button', { class: 'btn sm icon close', onclick: close, 'aria-label': 'Close' }, '✕'), body));
}

function overModal(v) {
  if (v.phase !== 'over' || S.overHidden) return null;
  const won = v.winner === me(v);
  return h('div', { class: 'over-wrap' },
    h('div', { class: `over ${v.winner}` },
      h('span', { class: 'kicker' }, won ? 'You win' : 'You lose'),
      h('h2', {}, v.winner === 'press' ? 'MAYOR EXPOSED' : 'MAYOR CLEARED'),
      h('div', { class: 'rule' }),
      h('p', {}, v.reason),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { S.overHidden = true; render(); } }, 'See board'),
        v.you.isHost ? h('button', { class: 'btn primary', onclick: () => doAct({ kind: 'restart' }) }, 'Play again') : h('span', { class: 'muted' }, 'Host can restart'))));
}

function game(v) {
  const pill = v.phase === 'over' ? 'Final' : (myTurn(v) || myPlace(v)) ? 'Your move' : 'Waiting';
  return h('section', { class: 'game seat-' + me(v) },
    h('div', { class: 'topbar' },
      h('span', { class: 'brand' }, 'Paper Trail'),
      h('span', { class: `pill ${pill === 'Your move' ? 'mine' : ''}`, onclick: () => { if (S.overHidden) { S.overHidden = false; render(); } } }, pill),
      h('span', { class: 'grow' }),
      v.players.some((p) => !p.connected) && h('span', { class: 'off' }, 'opponent offline'),
      tutorToggle(), menuBtn()),
    scoreline(v),
    board(v),
    track(v),
    lastPlay(v),
    S.tutorial && hint(v),
    tray(v),
    overModal(v));
}

/* ------------------------------ animation ------------------------------ */

// FLIP: every element with data-k glides from where it was last drawn to where it is now.
const rects = new Map();
const EASE = 'cubic-bezier(.22,1,.36,1)';
const snap = () => document.querySelectorAll('[data-k]').forEach((e) => rects.set(e.dataset.k, e.getBoundingClientRect()));
function flip() {
  let fresh = 0;
  document.querySelectorAll('[data-k]').forEach((e) => {
    const o = rects.get(e.dataset.k), n = e.getBoundingClientRect();
    if (!o) return void e.animate([{ transform: 'translateY(14px) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 50 * fresh++, easing: EASE, fill: 'backwards' });
    const dx = o.left - n.left, dy = o.top - n.top;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    e.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${o.width / n.width})`, zIndex: 9 }, { transform: 'none', zIndex: 9 }], { duration: 600, easing: EASE });
  });
}

function banner(big, small) {
  const b = h('div', { class: 'round-banner' }, h('b', {}, big), h('span', {}, small));
  document.body.append(b);
  setTimeout(() => b.remove(), 2200);
}

function onChange(p, v) {
  if (!v || v.phase === 'lobby') return;
  if (!p || p.phase === 'lobby' || v.round !== p.round) banner(`Round ${v.round}`, `${v.initiative === me(v) ? 'You lead' : LABEL[v.initiative] + ' leads'} with 5 cards`);
  if (!p || p.phase === 'lobby') return;
  if ((myTurn(v) && !myTurn(p)) || (myPlace(v) && !myPlace(p))) navigator.vibrate?.(35);
  if (v.momentum.machine > p.momentum.machine || v.momentum.press > p.momentum.press) toast(`${LABEL[v.momentum.machine > p.momentum.machine ? 'machine' : 'press']} takes the momentum`);
  v.sources.forEach((st, i) => { if (st && !p.sources[i]) toast(`Source #${i + 1} ${SRC[i]}: ${st === 'revealed' ? 'on the record' : 'silenced'}`); });
  if (v.phase === 'over' && p.phase !== 'over') navigator.vibrate?.(v.winner === me(v) ? [30, 60, 30] : [80, 40, 120]);
  if (v.phase !== 'over') S.overHidden = false;
}

/* ------------------------------ render ------------------------------ */

function render() {
  const v = S.view;
  const inGame = S.mode === 'game' && v;
  const changed = v !== S.lastV;
  const prev = S.lastV;
  if (changed) S.lastV = v;
  snap();
  if (!inGame || v.phase === 'lobby') rects.clear();
  const app = document.getElementById('app');
  const body = inGame ? (v.phase === 'lobby' ? lobby(v) : game(v)) : { home, connecting, error: errorScreen }[S.mode]();
  const banners = [
    S.lostHost && h('div', { class: 'banner' }, 'Connection to host lost. Reconnecting...'),
    S.stale && S.client && h('div', { class: 'banner' }, 'You and the host are on different versions. Both reload, host first.'),
  ].filter(Boolean);
  const y = window.scrollY;
  app.replaceChildren(...banners, body);
  document.querySelector('.sheet-wrap')?.remove();
  const sh = sheet(inGame ? v : null);
  if (sh) document.body.append(sh);
  window.scrollTo(0, y);
  if (inGame && v.phase !== 'lobby') flip();
  if (changed && inGame) onChange(prev, v);
}

/* ------------------------------ boot ------------------------------ */

(function boot() {
  const session = store.json('pt-session');
  const room = normCode(new URLSearchParams(location.search).get('room')) || normCode(session?.room);
  if (session && room === session.room) {
    if (session.host) {
      const saved = store.json('pt-host-' + room);
      if (saved) {
        saved.players.forEach((p) => { p.connected = p.isHost; });
        return startHost(saved, session);
      }
    } else return joinRoomAs(room, session.name);
  }
  render();
})();
