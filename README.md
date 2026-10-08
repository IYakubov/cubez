# Counting Clash v2 — Shared Couch style

Cubes fly across the big screen and vanish. Players count them, then tap
their phone once per cube. A wrong count is a strike; 3 strikes and you're out.

## Run
    npm install
    npm start          # http://localhost:3003  (PORT env var supported)

Open the host on the TV/PC, pick **1 Player** or **2 Players** (arrows + Enter,
or click). Scan the QR with the phone(s) and press **Ready**.

## v2 changes
- Same design language as Tank War / Math Duel: Unbounded font (bundled in
  `public/fonts/`, OFL), grayscale palette — soil #cfcdc6, slab #dddbd4,
  paper #ecebe6, ink #1b1b1a. Player A = ink, Player B = navy #1A4361.
  Correct = muted green #bcc8b3/#4f6a48, wrong = muted red #d6bdb6/#7a3b33.
  No noise, no glow.
- Cubes stay 3D but are greyscale and smaller (max 130 px, was 210;
  `CUBE_MAX` / `CUBE_PAD` at the top of index.html's script).
- Lobby shows only the QR (built by the server, LAN IP when the host is on
  localhost), the room number small top-right, and A/B slot cards.
- 3-2-1 countdown before round 1.
- Match-over menu (Play again / Back to lobby) is chosen from the phones;
  input locked 0.9 s after it opens. Phones mirror the list via `host_ui`.
- One phone = one slot (`clientId` in localStorage `cubez_client`); a
  re-opened link keeps the slot and the old tab gets `replaced`. Auto-join
  waits until the page is visible. Slot is taken from the server socket.
- Controller: player-coloured tap ring + counter, strikes, timer bar,
  haptics; host-left / replaced screens instead of alert().
- Single-player mode was already there and is kept.

## Socket protocol
| Event | Direction | Payload |
|---|---|---|
| create_game → game_created | host↔server | `{mode}` → `{code, mode, joinUrl, qrSvg}` |
| leave_room | host→server | (Esc in lobby) |
| join_game → joined / join_error | phone↔server | `{code, clientId}` → `{slot, code, mode, started}` |
| rejoin_game | phone→server | `{code, slot, clientId}` |
| replaced | server→old tab | |
| player_ready / lobby_update | | `{A,B,readyA,readyB}` |
| game_start | server→all | |
| ctrl_tap | phone→host | `{slot}` |
| ctrl_menu | phone→host | `{slot, action: prev/next/select/pick, index}` |
| host_event | host→phones | `newmatch / watch / answer / reveal / gameover` |
| host_ui | host→phones | `{menu, title, items, focus}` or null |
| host_back_to_lobby → back_to_lobby | | |
| player_left, player_back, host_disconnected | server→clients | |
