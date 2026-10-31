'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = 3000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function rememberName(socket, name) {
  if (typeof name === 'string' && name.trim()) {
    socket.data.name = name;
  }
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
    io.emit('file-shared', payload);
    res.json(payload);
  });
});

io.on('connection', (socket) => {
  console.log('Conexão:', socket.id);

  socket.on('chat', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { name, text } = payload;
    rememberName(socket, name);
    io.emit('chat', { name, text });
  });

  socket.on('typing', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { name } = payload;
    rememberName(socket, name);
    socket.broadcast.emit('typing', { name });
  });

  socket.on('stop-typing', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { name } = payload;
    rememberName(socket, name);
    socket.broadcast.emit('stop-typing', { name });
  });

  socket.on('status', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    rememberName(socket, payload.name);
    socket.broadcast.emit('status', {
      name: socket.data.name ?? null,
      status: payload.status,
    });
  });

  socket.on('offer', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.to) return;
    socket.to(payload.to).emit('offer', payload.sdp);
  });

  socket.on('answer', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.to) return;
    socket.to(payload.to).emit('answer', payload.sdp);
  });

  socket.on('ice', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.to) return;
    socket.to(payload.to).emit('ice', payload.candidate);
  });

  socket.on('join', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.room) return;
    socket.join(payload.room);
    socket.to(payload.room).emit('user-joined', socket.id);
  });

  socket.on('leave', (payload) => {
    if (!payload || typeof payload !== 'object' || !payload.room) return;
    socket.leave(payload.room);
    socket.to(payload.room).emit('user-left');
  });

  socket.on('disconnect', () => {
    console.log('Desconexão:', socket.id);
    io.emit('user-left');
  });
});

server.listen(PORT, () => {
  console.log(`Servidor na porta ${PORT}`);
});
