'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = 3000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_ROOM = 4;
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function rememberName(socket, name) {
  if (typeof name === 'string' && name.trim()) {
    socket.data.name = name.trim().slice(0, 32);
  }
}

function roomMembers(roomName, exceptId) {
  const room = io.sockets.adapter.rooms.get(roomName);
  const members = [];
  if (!room) return members;
  for (const id of room) {
    if (id === exceptId) continue;
    const other = io.sockets.sockets.get(id);
    members.push({ id, name: other?.data?.name || null });
  }
  return members;
}

// Navegadores mandam o nome do arquivo em UTF-8. O multipart trata o
// cabeçalho como Latin-1, então "relatório" chega como "relatÃ³rio".
function originalNameOf(name) {
  if (typeof name !== 'string' || !name) return 'arquivo';
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, uploadsDir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(originalNameOf(file.originalname)).replace(/[^.\w]/g, '').slice(0, 16);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

app.use(express.static(publicDir));

app.get('/api/access', (_req, res) => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal) ips.push(net.address);
    }
  }
  res.json({ port: PORT, ips });
});

app.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(uploadsDir, filename);
  const root = path.resolve(uploadsDir);

  if (filePath === root || !filePath.startsWith(root + path.sep)) {
    return res.status(400).json({ error: 'Nome inválido' });
  }

  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Arquivo não encontrado' });
    }
  });
});

app.post('/upload', (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Arquivo excede o limite de 50MB' });
      }
      console.error('Falha no upload:', err.message);
      return res.status(400).json({ error: 'Falha no upload' });
    }

    const file = Array.isArray(req.files) ? req.files[0] : null;
    if (!file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const payload = {
      filename: file.filename,
      originalName: originalNameOf(file.originalname),
      size: file.size,
    };

    console.log(
      `Upload de arquivo: ${payload.originalName} (${payload.size} bytes) -> ${payload.filename}`
    );
    const roomName = typeof req.body.room === 'string' ? req.body.room.trim().slice(0, 64) : '';
    if (roomName) io.to(roomName).emit('file-shared', { ...payload, room: roomName });
    res.json(payload);
  });
});

io.on('connection', (socket) => {
  console.log('Conexão:', socket.id);

  socket.on('chat', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { name, text } = payload;
    rememberName(socket, name);
    if (!socket.data.room) return;
    io.to(socket.data.room).emit('chat', { id: socket.id, name, text });
  });

  socket.on('typing', (payload) => {
    if (!payload || typeof payload !== 'object' || !socket.data.room) return;
    const { name } = payload;
    rememberName(socket, name);
    socket.to(socket.data.room).emit('typing', { name });
  });

  socket.on('stop-typing', (payload) => {
    if (!payload || typeof payload !== 'object' || !socket.data.room) return;
    const { name } = payload;
    rememberName(socket, name);
    socket.to(socket.data.room).emit('stop-typing', { name });
  });

  socket.on('status', (payload) => {
    if (!payload || typeof payload !== 'object' || !socket.data.room) return;
    rememberName(socket, payload.name);
    socket.to(socket.data.room).emit('status', {
      id: socket.id,
      name: socket.data.name ?? null,
      status: payload.status,
    });
  });

  socket.on('offer', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.to) return;
    socket.to(payload.to).emit('offer', { from: socket.id, sdp: payload.sdp });
  });

  socket.on('answer', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.to) return;
    socket.to(payload.to).emit('answer', { from: socket.id, sdp: payload.sdp });
  });

  socket.on('ice', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.to) return;
    socket.to(payload.to).emit('ice', { from: socket.id, candidate: payload.candidate });
  });

  socket.on('join', async (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.room) return;
    const roomName = String(payload.room).trim().slice(0, 64);
    if (!roomName) return;
    rememberName(socket, payload.name);

    const current = io.sockets.adapter.rooms.get(roomName);
    const alreadyIn = current?.has(socket.id);
    if (current && current.size >= MAX_ROOM && !alreadyIn) {
      socket.emit('room-full', { room: roomName, limit: MAX_ROOM });
      return;
    }

    socket.data.room = roomName;
    await socket.join(roomName);
    socket.emit('room-members', roomMembers(roomName, socket.id));
    socket.to(roomName).emit('user-joined', {
      id: socket.id,
      name: socket.data.name || null,
    });
  });

  socket.on('leave', async (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.room) return;
    const roomName = String(payload.room).trim().slice(0, 64);
    await socket.leave(roomName);
    if (socket.data.room === roomName) socket.data.room = null;
    socket.to(roomName).emit('user-left', { id: socket.id });
  });

  socket.on('disconnecting', () => {
    const roomName = socket.data.room;
    if (roomName) socket.to(roomName).emit('user-left', { id: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('Desconexão:', socket.id);
  });
});

server.listen({ port: PORT, host: '::', ipv6Only: false }, () => {
  console.log(`Servidor na porta ${PORT}`);
});
