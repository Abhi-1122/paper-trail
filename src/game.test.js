import assert from 'node:assert/strict';
import { createGame, addPlayer, applyAction, viewFor, CARDS, NODES, linkedSources, targets, legalNodes } from './game.js';

const seeded = (n = 1) => () => ((n = (n * 16807) % 2147483647) - 1) / 2147483646;
function setup() {
  const s = createGame('TEST');
  addPlayer(s, { name: 'Ann', token: 'a', isHost: true }); // press
  addPlayer(s, { name: 'Bob', token: 'b' }); // machine
  assert.equal(applyAction(s, 'p1', { kind: 'start' }, seeded()), null);
  return s;
}
const PR = 'p1', MA = 'p2';
const id = (name) => Object.values(CARDS).find((c) => c.name === name).id;
const give = (s, side, ...names) => { s.hands[side] = names.map(id); };
const play = (s, who, name, mode, target) => applyAction(s, who, { kind: 'play', card: id(name), mode, target }, seeded(7));

// board shape and card set
assert.equal(Object.keys(NODES).length, 19);
assert.equal(Object.keys(CARDS).length, 40);
for (const n of Object.values(NODES)) for (const b of n.adj) assert.ok(NODES[b].adj.includes(n.id));

// deal, hidden information
{
  const s = setup();
  assert.equal(s.hands.press.length, 5);
  assert.equal(s.hands.machine.length, 4);
  assert.equal(s.track.ev.length, 3);
  const v = viewFor(s, MA);
  assert.deepEqual(v.hands.press, [null, null, null, null, null]);
  assert.equal(typeof v.bag, 'number');
  assert.equal(v.hands.machine.length, 4);
}

// value play, turn order, colour matching, claiming at the end of the track
{
  const s = setup();
  give(s, 'press', 'Front Page', 'Deadline Push', 'Public Outcry');
  give(s, 'machine', 'Rally', 'Closed Session');
  s.track.ev = [{ id: 91, c: 0, pos: 0 }, { id: 92, c: 1, pos: 0 }];
  assert.equal(play(s, MA, 'Rally', 'value', 'mom'), 'Not your turn');
  assert.deepEqual(targets(s, id('Deadline Push'), 'value'), ['init', 'mom']); // violet card, no violet evidence
  assert.equal(play(s, PR, 'Deadline Push', 'value', 0), 'Pick a token this card can move');
  assert.equal(play(s, PR, 'Front Page', 'value', 0), null);
  assert.equal(s.track.ev[0].pos, 4);
  assert.equal(s.turn, 'machine');
  assert.equal(play(s, MA, 'Rally', 'value', 'mom'), null);
  assert.equal(s.track.mom, -4);
  assert.equal(play(s, PR, 'Public Outcry', 'value', 0), null); // reaches +5: claimed, must be placed
  assert.equal(s.phase, 'place');
  assert.equal(s.track.ev.length, 1);
  assert.equal(applyAction(s, MA, { kind: 'place', node: 'o0' }), 'Waiting for your opponent to place evidence');
  assert.equal(applyAction(s, PR, { kind: 'place', node: 'o1' }), 'That evidence cannot go there'); // wrong colour
  assert.equal(applyAction(s, PR, { kind: 'place', node: 'o0' }), null);
  assert.equal(s.board.o0.side, 'press');
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 'machine');
  assert.equal(play(s, MA, 'Closed Session', 'action'), null); // initiative 3 toward machine
  assert.equal(s.track.init, -3);
  // press plays last card -> round ends: machine wins momentum (-4) and initiative (-3)
  assert.equal(play(s, PR, 'Deadline Push', 'value', 'init'), null);
  assert.equal(s.round, 2);
  assert.equal(s.momentum.machine, 1);
  assert.equal(s.initiative, 'press'); // init went -3 +4 = +1
  assert.equal(s.track.ev.length, 3); // refilled around the one left at 0
  assert.equal(s.hands.press.length, 5);
}

// actions: reveal, silence, single-use cards leave the game, shred, leak, draw, discard
{
  const s = setup();
  give(s, 'press', 'The Driver', 'Anonymous Tip', 'Late Edition', 'Court Order', 'The Night Clerk');
  give(s, 'machine', 'Quiet Retirement', 'Shredder', 'Fundraiser', 'Rally');
  assert.equal(play(s, PR, 'The Driver', 'action'), null);
  assert.equal(s.sources[2], 'revealed');
  assert.ok(!s.discards.press.includes(id('The Driver')));
  assert.equal(play(s, MA, 'Quiet Retirement', 'action'), null);
  assert.equal(s.sources[0], 'silenced');
  assert.equal(play(s, PR, 'The Night Clerk', 'action'), 'That source is already silenced');
  assert.equal(play(s, PR, 'Anonymous Tip', 'action'), null);
  assert.equal(s.track.ev.length, 4);
  assert.equal(s.track.ev[3].pos, 1);
  assert.equal(play(s, MA, 'Shredder', 'action'), 'Pick an evidence token');
  assert.equal(play(s, MA, 'Shredder', 'action', 3), null);
  assert.equal(s.track.ev.length, 3);
  assert.equal(play(s, PR, 'Late Edition', 'action'), null);
  assert.equal(s.hands.press.length, 4); // 2 left + 2 drawn
  assert.equal(play(s, MA, 'Fundraiser', 'value', 'mom'), null);
  assert.equal(play(s, PR, 'Court Order', 'action'), null);
  assert.equal(s.hands.machine.length, 0);
}

// press wins by tying two revealed sources to the mayor
{
  const s = setup();
  s.sources[0] = 'revealed'; s.sources[1] = 'revealed';
  for (const n of ['o0', 'm0', 'c0', 'o1']) s.board[n] = { side: 'press', id: 0, c: 0 };
  assert.deepEqual(linkedSources(s), [0]);
  s.pending = [{ side: 'press', c: 3, id: 50 }]; s.phase = 'place';
  assert.ok(legalNodes(s, 3).includes('m1'));
  assert.equal(applyAction(s, PR, { kind: 'place', node: 'm1' }), null);
  assert.equal(s.winner, 'press');
}

// machine wins on momentum, or by burying every trail
{
  const s = setup();
  s.momentum.machine = 4; s.track.mom = -2;
  give(s, 'press', 'Front Page'); give(s, 'machine', 'Rally');
  play(s, PR, 'Front Page', 'value', 'init');
  assert.equal(play(s, MA, 'Rally', 'action'), null); // momentum 3 -> reaches -5
  assert.equal(s.winner, 'machine');
}
{
  const s = setup();
  for (const n of ['c0', 'c1', 'c2', 'c3']) s.board[n] = { side: 'machine', id: 0, c: 0 };
  s.pending = [{ side: 'machine', c: 3, id: 51 }]; s.phase = 'place';
  assert.equal(applyAction(s, MA, { kind: 'place', node: 'c4' }), null);
  assert.equal(s.winner, 'machine');
}

// random full games never stall or throw
for (let g = 1; g <= 200; g++) {
  const rng = seeded(g * 97);
  const s = createGame('SIM');
  addPlayer(s, { name: 'A', token: 'a', isHost: true }); addPlayer(s, { name: 'B', token: 'b' });
  applyAction(s, 'p1', { kind: 'start' }, rng);
  const pid = (side) => s.players.find((p) => p.role === side).id;
  let steps = 0;
  while (s.phase !== 'over') {
    assert.ok(++steps < 3000, 'game stalled');
    if (s.phase === 'place') {
      const t = s.pending[0], opts = legalNodes(s, t.c);
      assert.equal(applyAction(s, pid(t.side), { kind: 'place', node: opts[Math.floor(rng() * opts.length)] }, rng), null);
      continue;
    }
    const hand = s.hands[s.turn], card = hand[Math.floor(rng() * hand.length)];
    const mode = rng() < 0.5 ? 'action' : 'value';
    const ts = targets(s, card, mode);
    let e = applyAction(s, pid(s.turn), { kind: 'play', card, mode, target: ts[Math.floor(rng() * ts.length)] }, rng);
    if (e) { const tv = targets(s, card, 'value'); e = applyAction(s, pid(s.turn), { kind: 'play', card, mode: 'value', target: tv[Math.floor(rng() * tv.length)] }, rng); }
    assert.equal(e, null);
  }
}
console.log('all game tests passed');
