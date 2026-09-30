// ═══════════════════════════════════════════════════════
//  COUNTING CLASH — SERVER
//  Express + Socket.io: room codes, lobby, tap relay.
//  The host runs the whole round state machine itself and
//  broadcasts phase changes down to the two phones through
//  a single generic 'host_event' channel.
// ═══════════════════════════════════════════════════════
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // always serve the latest html so a stale cached page can't run old game rules
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

// ── ROOM STATE ──
// rooms[code] = {
//   hostSocketId,
//   players: { A: socketId|null, B: socketId|null },
//   ready:   { A: false, B: false },
//   started: false
// }
const rooms = {};

function genCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms[code]);
  return code;
}

function roomPresence(room) {
  return { A: !!room.players.A, B: !!room.players.B };
}

function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  const presence = roomPresence(room);
  const payload = { A: presence.A, B: presence.B, readyA: room.ready.A, readyB: room.ready.B };
  if (room.hostSocketId) io.to(room.hostSocketId).emit('lobby_update', payload);
  if (room.players.A) io.to(room.players.A).emit('lobby_update', payload);
  if (room.players.B) io.to(room.players.B).emit('lobby_update', payload);
}

io.on('connection', (socket) => {

  // ── HOST: create a new game ──
  // mode: 'solo' (only slot A is used) or 'duel' (default, needs A + B)
  socket.on('create_game', (data) => {
    const mode = (data && data.mode === 'solo') ? 'solo' : 'duel';
    const code = genCode();
    rooms[code] = {
      hostSocketId: socket.id,
      mode,
      players: { A: null, B: null },
      ready: { A: false, B: false },
      started: false
    };
    socket.data.hostCode = code;
    socket.emit('game_created', { code, mode });
  });

  // ── CONTROLLER: join a game by code ──
  socket.on('join_game', ({ code }) => {
    const room = rooms[code];
    if (!room) { socket.emit('join_error', 'room not found'); return; }
    if (room.started) { socket.emit('join_error', 'game already started'); return; }

    let slot = null;
    if (!room.players.A) slot = 'A';
    else if (room.mode !== 'solo' && !room.players.B) slot = 'B';
    else { socket.emit('join_error', 'room full'); return; }

    room.players[slot] = socket.id;
    socket.data.code = code;
    socket.data.slot = slot;
    socket.join(code);

    socket.emit('joined', { slot, code, mode: room.mode });
    if (room.hostSocketId) io.to(room.hostSocketId).emit('player_joined', { slot, players: roomPresence(room) });
    broadcastLobby(code);
  });

  // ── CONTROLLER: rejoin after reconnect ──
  socket.on('rejoin_game', ({ code, slot }) => {
    const room = rooms[code];
    if (!room) return;
    room.players[slot] = socket.id;
    socket.data.code = code;
    socket.data.slot = slot;
    socket.join(code);
    socket.emit('joined', { slot, code, mode: room.mode });
    broadcastLobby(code);
    if (room.started) socket.emit('game_start');
  });

  // ── CONTROLLER: ready up ──
  socket.on('player_ready', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const slot = socket.data.slot;
    if (!slot) return;
    room.ready[slot] = true;
    broadcastLobby(code);

    const needed = room.mode === 'solo' ? ['A'] : ['A', 'B'];
    const allReady = needed.every(s => room.players[s] && room.ready[s]);
    if (allReady && !room.started) {
      room.started = true;
      io.to(code).emit('game_start');
      if (room.hostSocketId) io.to(room.hostSocketId).emit('game_start');
    }
  });

  // ── HOST: restart after a match ends, without a new room code ──
  socket.on('restart_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    room.ready.A = false;
    room.ready.B = false;
    room.started = false;
    io.to(code).emit('return_to_lobby');            // phones (they are in the room)
    socket.emit('return_to_lobby');                  // the host display (it is NOT in the room)
    broadcastLobby(code);
  });

  // ── CONTROLLER: tap the counter button ──
  socket.on('ctrl_tap', ({ code, slot }) => {
    const room = rooms[code];
    if (!room || !room.hostSocketId) return;
    io.to(room.hostSocketId).emit('ctrl_tap', { slot });
  });

  // ── HOST -> both players: generic round-state broadcast ──
  // type: 'watch' | 'answer' | 'reveal' | 'gameover'
  socket.on('host_event', ({ code, type, payload }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    io.to(code).emit('host_event', { type, payload });
  });

  // ── Latency diagnostic ──
  socket.on('ping_check', (cb) => { if (typeof cb === 'function') cb(); });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const code = socket.data.code;
    const slot = socket.data.slot;
    const hostCode = socket.data.hostCode;

    if (hostCode && rooms[hostCode]) {
      const room = rooms[hostCode];
      if (room.players.A) io.to(room.players.A).emit('host_disconnected');
      if (room.players.B) io.to(room.players.B).emit('host_disconnected');
      delete rooms[hostCode];
    }

    if (code && slot && rooms[code]) {
      const room = rooms[code];
      if (room.players[slot] === socket.id) {
        room.players[slot] = null;
        room.ready[slot] = false;
        if (room.hostSocketId) io.to(room.hostSocketId).emit('player_left', { slot });
        broadcastLobby(code);
      }
    }
  });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`COUNTING CLASH server running on http://localhost:${PORT}`);
  console.log(`Host display: http://localhost:${PORT}/`);
  console.log(`Controller (phones): http://localhost:${PORT}/controller.html`);
});
