COUNTING CLASH — Networked Edition
====================================

A 2-player counting reflex game. One screen (PC, TV, laptop) shows
cubes flying in and out. Two players connect from their phones and
tap a glowing counter button to match how many cubes they saw.

REQUIREMENTS
------------
Node.js 16 or newer.

SETUP
-----
1. Open a terminal in this folder.
2. Install dependencies:
       npm install
3. Start the server:
       npm start
   You should see:
       COUNTING CLASH server running on http://localhost:3003

HOW TO PLAY
------------
1. On the PC/TV/laptop that will display the game, open a browser to:
       http://localhost:3003
   (or http://<your-computer's-LAN-IP>:3003 if opening from another device)
   Choose "1 PLAYER" or "2 PLAYERS". A 6-digit room code appears with a QR code.

2. On each phone, connected to the SAME WiFi as the host computer, scan
   the QR code, or open:
       http://<host-computer-LAN-IP>:3003/controller.html
   and enter the 6-digit code.

3. In 2-player mode, the first phone to join becomes PLAYER A, the second
   becomes PLAYER B; the round starts once both are Ready. In 1-player
   mode, only Player A connects, and the round starts as soon as they're
   Ready — there's no waiting on a second phone, and no one else can join
   that room.

HOW A ROUND WORKS
------------------
1. MEMORIZE! — a batch of cubes flies in from the right, pauses briefly,
   then exits to the left. The whole batch is on screen for 3 seconds.
2. TAP TO COUNT! — the screen is empty and both phones get a countdown window
   that grows with the cube count: up to 10 cubes = 3s, 11-20 = 5s,
   (a round never has more than 20 cubes; MAX_CUBES in index.html). Every tap plays a sound
   on the phone (public/sounds/tap.wav). Tap the glowing
   button on your phone once per cube you counted. Each tap lights up
   another dash on the ring and updates the number in the middle.
3. REVEAL — the real count is shown, and each player is marked correct
   or wrong. A wrong guess costs a strike.
4. Difficulty ramps up round after round — more cubes, harder to track.
5. 2-player: first player to rack up 3 wrong guesses loses the match;
   the other player wins. (If both hit 3 wrong on the same round,
   whoever had more correct rounds overall wins the tiebreak — a true
   tie is a draw.)
   1-player: the round keeps going until you rack up 3 wrong guesses,
   then the host shows how many rounds you got correct.

PROJECT STRUCTURE
------------------
server.js                    - Express + Socket.io server (rooms, lobby, tap + round-state relay)
public/index.html            - Host display (cube animations + round logic runs here)
public/controller.html       - Phone controller (the glowing tap-counter button)
package.json                 - Node dependencies

NOTES
-----
- Everything runs on your local network — no internet/cloud needed.
- The host page runs the entire round state machine (timing, difficulty,
  scoring); the server is just a relay between host and phones, and the
  phones only ever send a "tap" event.
- If a phone disconnects mid-game, it automatically tries to rejoin its
  same player slot when it reconnects.
- Tunable knobs are all constants at the top of index.html's <script>:
  SHOW_MS (how long the cubes are on screen), ANSWER_BASE_MS / ANSWER_STEP_MS (answer window length),
  rangeForRound() (difficulty curve), MAX_MISSES (strikes to lose).
