# Paper Trail

A two-player asymmetric tug-of-war card game for the browser. One player is City Hall, the other is The Gazette. Every card is either a number (pull a token toward you on the shared track) or an action. The Gazette wins by tying two on-the-record sources to the Mayor with evidence; City Hall wins by collecting momentum or burying every route.

- Peer-to-peer over WebRTC ([Trystero](https://github.com/dmotz/trystero)), no game server. The host's browser runs the rules.
- Phone first: the whole game fits one screen, with the hand in a bottom tray.
- Optional **Tutor** toggle (off by default, per player): contextual hints, tap-to-explain zones and the full rules.
- Reloading is safe: the host's game is saved locally and resumes; the guest rejoins automatically.

## Develop

```sh
npm install
npm run dev
npm test   # rules engine checks, including 200 simulated games
```

Deploys as a static Vite site (Vercel).
