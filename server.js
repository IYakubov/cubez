// ═══════════════════════════════════════════════════════
//  COUNTING CLASH — SERVER  (v2, Shared Couch style)
//  Express + Socket.io: rooms, lobby, QR, tap + menu relay.
//  The host runs the round state machine and broadcasts
//  phase changes to the phones through 'host_event'.
// ═══════════════════════════════════════════════════════
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3003;

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

// ── LAN IP (so phones can reach a host opened on localhost) ──
function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}
function buildOrigin(socket) {
  const h = socket.handshake.headers;
  const host = (h['x-forwarded-host'] || h.host || ('localhost:' + PORT)).split(',')[0].trim();
  const proto = (h['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const hostname = host.replace(/:\d+$/, '');
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    const ip = lanIP();
    const port = (host.match(/:(\d+)$/) || [])[1] || PORT;
    if (ip) return 'http://' + ip + ':' + port;
  }
  return proto + '://' + host;
}

// rooms[code] = { hostSocketId, mode, players:{A,B}, clientIds:{A,B}, ready:{A,B}, started }
const rooms = {};

function genCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms[code]);
  return code;
}
function lobbyPayload(room) {
  return { A: !!room.players.A, B: !!room.players.B, readyA: room.ready.A, readyB: room.ready.B };
}
function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  const p = lobbyPayload(room);
  if (room.hostSocketId) io.to(room.hostSocketId).emit('lobby_update', p);
  io.to(code).emit('lobby_update', p);
}
function slots(room) { return room.mode === 'solo' ? ['A'] : ['A', 'B']; }

// put a socket into a slot, kicking an older tab of the same phone
function seat(room, code, slot, socket, clientId) {
  const old = room.players[slot];
  if (old && old !== socket.id) {
    const s = io.sockets.sockets.get(old);
    if (s) { s.emit('replaced'); s.data.slot = null; s.data.code = null; s.leave(code); }
  }
  room.players[slot] = socket.id;
  if (clientId) room.clientIds[slot] = clientId;
  socket.data.code = code;
  socket.data.slot = slot;
  socket.join(code);
  socket.emit('joined', { slot, code, mode: room.mode, started: room.started });
  broadcastLobby(code);
  if (room.started) {
    socket.emit('game_start', { resume: true });
    if (room.lastUi) socket.emit('host_ui', room.lastUi);
    if (room.hostSocketId) io.to(room.hostSocketId).emit('player_back', { slot });
  }
}

io.on('connection', (socket) => {

  // ── HOST: create a game ──
  socket.on('create_game', async (data) => {
    const mode = (data && data.mode === 'solo') ? 'solo' : 'duel';
    // a host that creates again drops its previous room
    const prev = socket.data.hostCode;
    if (prev && rooms[prev]) { io.to(prev).emit('host_disconnected'); delete rooms[prev]; }

    const code = genCode();
    rooms[code] = {
      hostSocketId: socket.id, mode,
      players: { A: null, B: null }, clientIds: { A: null, B: null },
      ready: { A: false, B: false }, started: false, lastUi: null
    };
    socket.data.hostCode = code;
    const joinUrl = buildOrigin(socket) + '/controller.html?code=' + code;
    let qrSvg = '';
    try {
      qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1b1b1a', light: '#00000000' } });
    } catch (e) { console.error('QR error', e); }
    socket.emit('game_created', { code, mode, joinUrl, qrSvg });
  });

  // ── PHONE: join by code ──
  socket.on('join_game', (data) => {
    const code = data && String(data.code || '');
    const clientId = data && typeof data.clientId === 'string' ? data.clientId.slice(0, 64) : null;
    const room = rooms[code];
    if (!room) { socket.emit('join_error', 'Room not found'); return; }

    // a socket never holds two slots
    if (socket.data.code === code && socket.data.slot) {
      socket.emit('joined', { slot: socket.data.slot, code, mode: room.mode, started: room.started });
      return;
    }
    // same phone re-opening the link keeps its slot
    if (clientId) {
      for (const s of slots(room)) {
        if (room.clientIds[s] === clientId) { seat(room, code, s, socket, clientId); log(code, s, socket, 'rejoin'); return; }
      }
    }
    if (room.started) { socket.emit('join_error', 'Game already started'); return; }
    const slot = slots(room).find(s => !room.players[s] && !room.clientIds[s]) ||
                 slots(room).find(s => !room.players[s]);
    if (!slot) { socket.emit('join_error', 'Room is full'); return; }
    room.ready[slot] = false;
    seat(room, code, slot, socket, clientId);
    log(code, slot, socket, 'join');
  });

  // ── PHONE: rejoin after a dropped connection ──
  socket.on('rejoin_game', (data) => {
    const code = data && String(data.code || '');
    const slot = data && data.slot;
    const clientId = data && data.clientId;
    const room = rooms[code];
    if (!room || !slots(room).includes(slot)) { socket.emit('join_error', 'Room not found'); return; }
    // never steal another phone's slot
    if (room.clientIds[slot] && clientId && room.clientIds[slot] !== clientId) { socket.emit('join_error', 'Room is full'); return; }
    seat(room, code, slot, socket, clientId);
  });

  // ── PHONE: ready ──
  socket.on('player_ready', () => {
    const code = socket.data.code, slot = socket.data.slot;
    const room = rooms[code];
    if (!room || !slot || room.started) return;
    room.ready[slot] = true;
    broadcastLobby(code);
    if (slots(room).every(s => room.players[s] && room.ready[s])) {
      room.started = true;
      io.to(code).emit('game_start', {});
      if (room.hostSocketId) io.to(room.hostSocketId).emit('game_start', {});
    }
  });

  // ── HOST: back to lobby (phones stay connected) ──
  socket.on('host_back_to_lobby', ({ code } = {}) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    room.ready.A = false; room.ready.B = false;
    room.started = false; room.lastUi = null;
    io.to(code).emit('back_to_lobby');
    socket.emit('back_to_lobby');
    broadcastLobby(code);
  });

  // ── PHONE → HOST: counter tap ──
  socket.on('ctrl_tap', () => {
    const room = rooms[socket.data.code];
    if (!room || !room.hostSocketId || !socket.data.slot) return;
    io.to(room.hostSocketId).emit('ctrl_tap', { slot: socket.data.slot });
  });

  // ── PHONE → HOST: menu navigation ──
  socket.on('ctrl_menu', (data) => {
    const room = rooms[socket.data.code];
    if (!room || !room.hostSocketId || !socket.data.slot) return;
    const action = data && data.action;
    if (!['prev', 'next', 'select', 'pick'].includes(action)) return;
    io.to(room.hostSocketId).emit('ctrl_menu', { slot: socket.data.slot, action, index: data.index | 0 });
  });

  // ── HOST → PHONES: round state + mirrored menu ──
  socket.on('host_event', ({ code, type, payload } = {}) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    io.to(code).emit('host_event', { type, payload });
  });
  socket.on('host_ui', ({ code, ui } = {}) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    room.lastUi = ui || null;
    io.to(code).emit('host_ui', ui || null);
  });

  // ── HOST: leave the lobby (Esc) ──
  socket.on('leave_room', () => {
    const code = socket.data.hostCode;
    if (code && rooms[code] && rooms[code].hostSocketId === socket.id) {
      io.to(code).emit('host_disconnected');
      delete rooms[code];
    }
    socket.data.hostCode = null;
  });

  socket.on('ping_check', (cb) => { if (typeof cb === 'function') cb(); });

  socket.on('disconnect', () => {
    const hostCode = socket.data.hostCode;
    if (hostCode && rooms[hostCode] && rooms[hostCode].hostSocketId === socket.id) {
      io.to(hostCode).emit('host_disconnected');
      delete rooms[hostCode];
    }
    const code = socket.data.code, slot = socket.data.slot;
    if (code && slot && rooms[code]) {
      const room = rooms[code];
      if (room.players[slot] === socket.id) {
        room.players[slot] = null;
        if (!room.started) room.ready[slot] = false;
        if (room.hostSocketId) io.to(room.hostSocketId).emit('player_left', { slot });
        broadcastLobby(code);
      }
    }
  });
});

function log(code, slot, socket, what) {
  const ua = (socket.handshake.headers['user-agent'] || '').slice(0, 90);
  console.log(`[${code}] ${what} ${slot} — ${ua}`);
}

server.listen(PORT, () => {
  const ip = lanIP();
  console.log(`COUNTING CLASH running on http://localhost:${PORT}`);
  if (ip) console.log(`On your network:      http://${ip}:${PORT}`);
});
