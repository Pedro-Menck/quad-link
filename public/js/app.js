const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const MAX_TEXT = 2000;

const gate = document.querySelector('#gate');
const gateForm = document.querySelector('#gate-form');
const gateError = document.querySelector('#gate-error');
const nameInput = document.querySelector('#name');
const roomInput = document.querySelector('#room');
const shell = document.querySelector('#shell');
const roomLabel = document.querySelector('#room-label');
const occupancy = document.querySelector('#occupancy');
const conn = document.querySelector('#conn');
const memberList = document.querySelector('#member-list');
const log = document.querySelector('#log');
const empty = document.querySelector('#empty');
const typingEl = document.querySelector('#typing');
const composer = document.querySelector('#composer');
const textInput = document.querySelector('#text');
const fileInput = document.querySelector('#file');
const banner = document.querySelector('#banner');
const stage = document.querySelector('#stage');
const stageHint = document.querySelector('#stage-hint');
const tiles = document.querySelector('#tiles');
const audioSink = document.querySelector('#audio-sink');
const toastEl = document.querySelector('#toast');
const voiceBtn = document.querySelector('#voice');
const callControls = document.querySelector('#call-controls');
const micBtn = document.querySelector('#mic');
const camBtn = document.querySelector('#cam');
const screenBtn = document.querySelector('#screen');
const hangupBtn = document.querySelector('#hangup');
const membersToggle = document.querySelector('#members-toggle');
const membersClose = document.querySelector('#members-close');
const leaveRoomBtn = document.querySelector('#leave-room');

const state = {
  name: '',
  room: 'geral',
  entered: false,
  joinedAs: null,
  inVoice: false,
  micOn: false,
  camOn: false,
  screenOn: false,
  localStream: null,
  screenStream: null,
  members: new Map(),
  peers: new Map(),
  remote: new Map(),
  typing: new Map(),
  seenFiles: new Set(),
};

const saved = readSaved();
if (saved.name) nameInput.value = saved.name;
if (saved.room) roomInput.value = saved.room;

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  setConn('on', 'conectado');
  banner.hidden = true;
  if (state.entered) announceJoin();
});

socket.on('disconnect', () => {
  setConn('off', 'sem conexão');
  banner.hidden = false;
  banner.textContent = 'Conexão perdida. Tentando de novo…';
  state.joinedAs = null;
  closeAllPeers();
  state.members.clear();
  renderMembers();
});

socket.on('room-full', () => {
  state.entered = false;
  state.joinedAs = null;
  showGate('Essa sala já tem 4 pessoas. Escolhe outro nome de sala.');
});

socket.on('room-members', (members) => {
  state.members.clear();
  for (const member of members || []) rememberMember(member);
  renderMembers();
  if (state.inVoice || state.screenOn) publish();
  renderStage();
});

socket.on('user-joined', (payload) => {
  const member = typeof payload === 'string' ? { id: payload, name: null } : payload;
  if (!member?.id || member.id === socket.id) return;
  rememberMember(member);
  renderMembers();
  if (state.inVoice || state.screenOn) publish();
  renderStage();
});

socket.on('user-left', (payload) => {
  const id = typeof payload === 'string' ? payload : payload?.id;
  if (!id || !state.members.has(id)) return;
  state.members.delete(id);
  closePeer(id);
  renderMembers();
  renderStage();
});

socket.on('chat', (payload) => {
  if (!payload || typeof payload.text !== 'string') return;
  appendMessage({
    name: payload.name || 'Anônimo',
    text: payload.text,
    mine: payload.name === state.name,
  });
});

socket.on('file-shared', (file) => {
  if (!file?.filename || state.seenFiles.has(file.filename)) return;
  state.seenFiles.add(file.filename);
  appendFile(file);
});

socket.on('typing', ({ name } = {}) => noteTyping(name, true));
socket.on('stop-typing', ({ name } = {}) => noteTyping(name, false));

socket.on('status', ({ id, name, status } = {}) => {
  let member = id ? state.members.get(id) : null;
  if (!member && name) {
    member = [...state.members.values()].find((item) => item.name === name);
  }
  if (!member) return;
  member.status = status || 'online';
  renderMembers();
  renderStage();
});

socket.on('offer', (payload) => onOffer(payload));
socket.on('answer', (payload) => onAnswer(payload));
socket.on('ice', (payload) => onIce(payload));

gateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const room = roomInput.value.trim();
  if (!name) {
    gateError.textContent = 'Diz como quer aparecer na sala.';
    return;
  }
  if (!room) {
    gateError.textContent = 'A sala precisa de um nome.';
    return;
  }
  state.name = name.slice(0, 32);
  state.room = room.slice(0, 32);
  state.entered = true;
  state.joinedAs = null;
  localStorage.setItem('quadlink', JSON.stringify({ name: state.name, room: state.room }));
  gateError.textContent = '';
  roomLabel.textContent = state.room;
  showShell();
  announceJoin();
  textInput.focus();
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChat();
});

textInput.addEventListener('input', () => {
  fitText();
  if (!socket.connected) return;
  socket.emit('typing', { name: state.name });
  clearTimeout(textInput.idle);
  textInput.idle = setTimeout(() => {
    socket.emit('stop-typing', { name: state.name });
  }, 900);
});

textInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChat();
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (file) uploadFile(file);
});

composer.addEventListener('dragover', (event) => {
  event.preventDefault();
});
composer.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
});

voiceBtn.addEventListener('click', () => enterVoice().catch(showMediaError));
micBtn.addEventListener('click', () => toggleMic());
camBtn.addEventListener('click', () => toggleCamera().catch(showMediaError));
screenBtn.addEventListener('click', () => toggleScreen().catch(showMediaError));
hangupBtn.addEventListener('click', () => leaveVoice());
leaveRoomBtn.addEventListener('click', () => exitRoom());
membersToggle.addEventListener('click', () => setMembersOpen(true));
membersClose.addEventListener('click', () => setMembersOpen(false));

function announceJoin() {
  if (!state.entered || !socket.connected) return;
  if (state.joinedAs === socket.id) return;
  state.joinedAs = socket.id;
  socket.emit('join', { room: state.room, name: state.name });
}

function sendChat() {
  const text = textInput.value.trim().slice(0, MAX_TEXT);
  if (!text) return;
  if (!socket.connected) {
    toast('Sem conexão. A mensagem não saiu.');
    return;
  }
  socket.emit('chat', { name: state.name, text });
  socket.emit('stop-typing', { name: state.name });
  clearTimeout(textInput.idle);
  textInput.value = '';
  fitText();
}

async function uploadFile(file) {
  if (file.size > 50 * 1024 * 1024) {
    toast('Esse arquivo passa de 50 MB.');
    return;
  }
  const body = new FormData();
  body.append('file', file);
  fileInput.disabled = true;
  try {
    const response = await fetch('/upload', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não consegui enviar o arquivo.');
  } catch (error) {
    toast(error.message || 'Não consegui enviar o arquivo.');
  } finally {
    fileInput.disabled = false;
  }
}

function appendMessage({ name, text, mine }) {
  empty.hidden = true;
  const article = document.createElement('article');
  article.className = mine ? 'msg mine' : 'msg';
  const header = document.createElement('header');
  const who = document.createElement('strong');
  who.textContent = mine ? 'Você' : name;
  const when = document.createElement('span');
  when.textContent = clock();
  header.append(who, when);
  const body = document.createElement('p');
  body.textContent = text;
  article.append(header, body);
  stickLog(article);
}

function appendFile(file) {
  empty.hidden = true;
  const article = document.createElement('article');
  article.className = 'msg';
  const header = document.createElement('header');
  const who = document.createElement('strong');
  who.textContent = 'Arquivo';
  const when = document.createElement('span');
  when.textContent = clock();
  header.append(who, when);
  const link = document.createElement('a');
  link.href = `/uploads/${encodeURIComponent(file.filename)}`;
  link.textContent = file.originalName || file.filename;
  link.download = file.originalName || file.filename;
  const meta = document.createElement('div');
  meta.className = 'file-meta';
  meta.textContent = formatBytes(file.size);
  article.append(header, link, meta);
  stickLog(article);
}

function stickLog(node) {
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.append(node);
  if (nearBottom || node.classList.contains('mine')) node.scrollIntoView({ block: 'end' });
}

function noteTyping(name, active) {
  if (!name || name === state.name) return;
  clearTimeout(state.typing.get(name));
  if (!active) {
    state.typing.delete(name);
  } else {
    state.typing.set(name, setTimeout(() => noteTyping(name, false), 2500));
  }
  const names = [...state.typing.keys()];
  if (!names.length) {
    typingEl.hidden = true;
    typingEl.textContent = '';
    return;
  }
  typingEl.hidden = false;
  typingEl.textContent = names.length === 1
    ? `${names[0]} está digitando…`
    : `${names.slice(0, 2).join(' e ')} estão digitando…`;
}

function rememberMember(member) {
  if (!member?.id || member.id === socket.id) return;
  const previous = state.members.get(member.id);
  state.members.set(member.id, {
    id: member.id,
    name: member.name || previous?.name || 'Anônimo',
    status: member.status || previous?.status || 'online',
  });
}

function renderMembers() {
  memberList.replaceChildren();
  memberList.append(memberRow({ name: state.name, status: localStatus(), self: true }));
  for (const member of state.members.values()) memberList.append(memberRow(member));
  occupancy.textContent = `${state.members.size + 1}/4`;
}

function memberRow(member) {
  const item = document.createElement('li');
  item.className = member.self ? 'member self' : 'member';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = initial(member.name);
  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = member.self ? `${member.name} (você)` : member.name;
  const small = document.createElement('small');
  small.dataset.status = member.status || 'online';
  small.textContent = statusLabel(member.status);
  text.append(strong, small);
  item.append(avatar, text);
  return item;
}

function localStatus() {
  if (state.screenOn) return 'sharing-screen';
  if (state.inVoice && !state.micOn) return 'muted';
  if (state.inVoice) return 'in-voice';
  return 'online';
}

function sendStatus() {
  if (!socket.connected) return;
  socket.emit('status', { name: state.name, status: localStatus() });
}

function renderControls() {
  const live = state.inVoice || state.screenOn;
  voiceBtn.hidden = live;
  callControls.hidden = !live;
  micBtn.setAttribute('aria-pressed', state.micOn ? 'true' : 'false');
  micBtn.textContent = state.micOn ? 'Mic ligado' : 'Mic mudo';
  camBtn.setAttribute('aria-pressed', state.camOn ? 'true' : 'false');
  camBtn.textContent = state.camOn ? 'Câmera ligada' : 'Câmera';
  screenBtn.setAttribute('aria-pressed', state.screenOn ? 'true' : 'false');
  screenBtn.textContent = state.screenOn ? 'Parar tela' : 'Tela';
}

function renderStage() {
  const someoneCalling = [...state.members.values()].some((member) => member.status && member.status !== 'online');
  const show = state.inVoice || state.screenOn || someoneCalling || state.remote.size > 0 || tiles.childElementCount > 0;
  stage.hidden = !show;
  if (!show) return;
  if (state.inVoice || state.screenOn) {
    stageHint.textContent = 'Direto entre os navegadores. O servidor não escuta.';
  } else if (someoneCalling) {
    stageHint.textContent = 'Alguém está na chamada.';
  } else {
    stageHint.textContent = '';
  }
  if (state.inVoice || state.screenOn) mountAll();
}

async function enterVoice() {
  if (state.inVoice && state.localStream) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  state.localStream = stream;
  state.inVoice = true;
  state.micOn = true;
  publish();
  mountAll();
  refreshLocalTiles();
  sendStatus();
  renderControls();
  renderStage();
}

async function toggleMic() {
  const tracks = state.localStream?.getAudioTracks().filter((track) => track.readyState === 'live') || [];
  if (!tracks.length) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (!state.localStream) state.localStream = new MediaStream();
      state.localStream.addTrack(track);
      state.inVoice = true;
      state.micOn = true;
      publish();
      mountAll();
      sendStatus();
      renderControls();
      renderMembers();
      renderStage();
    } catch (error) {
      showMediaError(error);
    }
    return;
  }
  const next = !tracks[0].enabled;
  for (const track of tracks) track.enabled = next;
  state.micOn = next;
  sendStatus();
  renderControls();
  renderMembers();
}

async function toggleCamera() {
  if (state.camOn && state.localStream) {
    for (const track of [...state.localStream.getVideoTracks()]) {
      track.stop();
      unpublishTrack(track);
      state.localStream.removeTrack(track);
    }
    state.camOn = false;
    refreshLocalTiles();
    sendStatus();
    renderControls();
    renderMembers();
    return;
  }
  const cam = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  const track = cam.getVideoTracks()[0];
  if (!state.localStream) state.localStream = new MediaStream();
  state.localStream.addTrack(track);
  state.camOn = true;
  state.inVoice = true;
  publish();
  mountAll();
  refreshLocalTiles();
  sendStatus();
  renderControls();
  renderMembers();
  renderStage();
}

async function toggleScreen() {
  if (state.screenOn) {
    haltScreen();
    refreshLocalTiles();
    sendStatus();
    renderControls();
    renderMembers();
    renderStage();
    return;
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  state.screenStream = stream;
  state.screenOn = true;
  const track = stream.getVideoTracks()[0];
  if (track) track.onended = () => {
    haltScreen();
    refreshLocalTiles();
    sendStatus();
    renderControls();
    renderMembers();
    renderStage();
  };
  publish();
  refreshLocalTiles();
  sendStatus();
  renderControls();
  renderMembers();
  renderStage();
}

function leaveVoice() {
  haltScreen();
  if (state.localStream) {
    for (const track of [...state.localStream.getTracks()]) {
      track.stop();
      unpublishTrack(track);
    }
  }
  state.localStream = null;
  state.inVoice = false;
  state.micOn = false;
  state.camOn = false;
  unmountPlayback();
  refreshLocalTiles();
  sendStatus();
  renderControls();
  renderMembers();
  renderStage();
}

function haltScreen() {
  if (!state.screenStream) {
    state.screenOn = false;
    return;
  }
  for (const track of state.screenStream.getTracks()) {
    track.onended = null;
    track.stop();
    unpublishTrack(track);
  }
  state.screenStream = null;
  state.screenOn = false;
}

function exitRoom() {
  leaveVoice();
  if (socket.connected && state.room) socket.emit('leave', { room: state.room });
  closeAllPeers();
  state.members.clear();
  state.entered = false;
  state.joinedAs = null;
  log.replaceChildren();
  empty.hidden = false;
  setMembersOpen(false);
  showGate('');
}

function publish() {
  for (const id of state.members.keys()) {
    const peer = state.peers.get(id) || createPeer(id);
    addMissingTracks(peer.pc);
  }
}

function createPeer(id) {
  const pc = new RTCPeerConnection(ICE);
  const peer = {
    id,
    pc,
    makingOffer: false,
    ignoreOffer: false,
    suppress: false,
    polite: socket.id > id,
    pending: [],
  };
  state.peers.set(id, peer);
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('ice', { to: id, candidate: event.candidate });
  };
  pc.ontrack = (event) => noteRemoteTrack(id, event.track);
  pc.onnegotiationneeded = () => {
    if (peer.makingOffer || peer.suppress) return;
    negotiate(peer);
  };
  return peer;
}

async function negotiate(peer) {
  if (peer.suppress || peer.makingOffer || peer.pc.signalingState !== 'stable') return;
  try {
    peer.makingOffer = true;
    await peer.pc.setLocalDescription();
    if (peer.pc.localDescription) {
      socket.emit('offer', { to: peer.id, sdp: peer.pc.localDescription });
    }
  } catch (error) {
    console.error(error);
  } finally {
    peer.makingOffer = false;
  }
}

function addMissingTracks(pc) {
  for (const stream of [state.localStream, state.screenStream]) {
    if (!stream) continue;
    for (const track of stream.getTracks()) {
      if (track.readyState === 'ended') continue;
      if (pc.getSenders().some((sender) => sender.track === track)) continue;
      pc.addTrack(track, stream);
    }
  }
}

function unpublishTrack(track) {
  for (const peer of state.peers.values()) {
    const sender = peer.pc.getSenders().find((item) => item.track === track);
    if (sender) peer.pc.removeTrack(sender);
  }
}

async function onOffer(payload) {
  const from = payload?.from;
  const sdp = payload?.sdp;
  if (!from || !sdp) return;
  rememberMember({ id: from });
  const peer = state.peers.get(from) || createPeer(from);
  const collision = sdp.type === 'offer' && (peer.makingOffer || peer.pc.signalingState !== 'stable');
  peer.ignoreOffer = !peer.polite && collision;
  if (peer.ignoreOffer) return;
  peer.suppress = true;
  try {
    if (collision) await peer.pc.setLocalDescription({ type: 'rollback' });
    await peer.pc.setRemoteDescription(sdp);
    if (sdp.type === 'offer') {
      addMissingTracks(peer.pc);
      await peer.pc.setLocalDescription();
      socket.emit('answer', { to: from, sdp: peer.pc.localDescription });
    }
    await flushIce(peer);
  } catch (error) {
    console.error(error);
  } finally {
    peer.suppress = false;
  }
  renderMembers();
}

async function onAnswer(payload) {
  const peer = payload?.from ? state.peers.get(payload.from) : null;
  if (!peer || !payload.sdp) return;
  peer.suppress = true;
  try {
    await peer.pc.setRemoteDescription(payload.sdp);
    await flushIce(peer);
  } catch (error) {
    console.error(error);
  } finally {
    peer.suppress = false;
  }
}

async function onIce(payload) {
  if (!payload?.from || !payload.candidate) return;
  const peer = state.peers.get(payload.from) || createPeer(payload.from);
  if (!peer.pc.remoteDescription) {
    peer.pending.push(payload.candidate);
    return;
  }
  try {
    await peer.pc.addIceCandidate(payload.candidate);
  } catch (error) {
    console.error(error);
  }
}

async function flushIce(peer) {
  const queued = peer.pending.splice(0);
  for (const candidate of queued) {
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {
      console.error(error);
    }
  }
}

function noteRemoteTrack(peerId, track) {
  const key = `${peerId}:${track.id}`;
  state.remote.set(key, { peerId, track });
  track.onended = () => {
    state.remote.delete(key);
    document.getElementById(domId(key))?.remove();
    renderStage();
  };
  if (state.inVoice || state.screenOn) mountTrack(key);
  renderStage();
}

function mountAll() {
  for (const key of state.remote.keys()) mountTrack(key);
}

function mountTrack(key) {
  const item = state.remote.get(key);
  if (!item || document.getElementById(domId(key))) return;
  const name = state.members.get(item.peerId)?.name || 'Alguém';
  if (item.track.kind === 'audio') {
    const audio = document.createElement('audio');
    audio.id = domId(key);
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = new MediaStream([item.track]);
    audioSink.append(audio);
    ensureAudioTile(item.peerId, name);
    return;
  }
  const surface = item.track.getSettings?.().displaySurface;
  const caption = surface ? `${name} · tela` : `${name} · câmera`;
  tiles.append(videoTile(domId(key), caption, item.track));
  document.getElementById(`voice-${item.peerId}`)?.remove();
}

function ensureAudioTile(peerId, name) {
  if (document.getElementById(`voice-${peerId}`)) return;
  if ([...tiles.children].some((node) => node.dataset.peer === peerId && node.dataset.kind === 'video')) return;
  const tile = document.createElement('figure');
  tile.className = 'tile audio-only';
  tile.id = `voice-${peerId}`;
  tile.dataset.peer = peerId;
  const pulse = document.createElement('div');
  pulse.className = 'pulse';
  pulse.textContent = initial(name);
  const caption = document.createElement('figcaption');
  caption.textContent = `${name} · voz`;
  tile.append(pulse, caption);
  tiles.append(tile);
}

function refreshLocalTiles() {
  document.getElementById('local-camera')?.remove();
  document.getElementById('local-screen')?.remove();
  const camera = state.localStream?.getVideoTracks().find((track) => track.readyState === 'live');
  if (camera) tiles.prepend(videoTile('local-camera', 'Sua câmera', camera, true));
  const screen = state.screenStream?.getVideoTracks().find((track) => track.readyState === 'live');
  if (screen) tiles.prepend(videoTile('local-screen', 'Sua tela', screen, true));
  renderStage();
}

function videoTile(id, captionText, track, muted) {
  const tile = document.createElement('figure');
  tile.className = 'tile';
  tile.id = id;
  tile.dataset.kind = 'video';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = Boolean(muted);
  video.srcObject = new MediaStream([track]);
  const caption = document.createElement('figcaption');
  caption.textContent = captionText;
  tile.append(video, caption);
  return tile;
}

function unmountPlayback() {
  audioSink.replaceChildren();
  [...tiles.children].forEach((node) => {
    if (!node.id.startsWith('local-')) node.remove();
  });
}

function closePeer(id) {
  const peer = state.peers.get(id);
  if (peer) {
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();
    state.peers.delete(id);
  }
  for (const key of [...state.remote.keys()]) {
    if (key.startsWith(`${id}:`)) state.remote.delete(key);
  }
  [...tiles.children].forEach((node) => {
    if (node.id.includes(id) || node.dataset.peer === id) node.remove();
  });
  [...audioSink.children].forEach((node) => {
    if (node.id.includes(id)) node.remove();
  });
}

function closeAllPeers() {
  for (const id of [...state.peers.keys()]) closePeer(id);
}

function showMediaError(error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    toast('O navegador bloqueou o dispositivo. Libera a permissão e tenta de novo.');
    return;
  }
  if (name === 'NotFoundError') {
    toast('Não encontrei microfone ou câmera neste computador.');
    return;
  }
  toast('Não consegui abrir o áudio ou o vídeo.');
}

function showGate(message) {
  gate.hidden = false;
  shell.hidden = true;
  gateError.textContent = message || '';
}

function showShell() {
  gate.hidden = true;
  shell.hidden = false;
  renderMembers();
  renderControls();
  renderStage();
}

function setConn(mode, label) {
  conn.dataset.state = mode;
  conn.textContent = label;
}

function setMembersOpen(open) {
  document.body.classList.toggle('members-open', open);
  membersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function fitText() {
  textInput.style.height = 'auto';
  textInput.style.height = `${Math.min(textInput.scrollHeight, 140)}px`;
}

function toast(message) {
  toastEl.hidden = false;
  toastEl.textContent = message;
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 4200);
}

function clock(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function formatBytes(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function statusLabel(status) {
  if (status === 'in-voice') return 'na voz';
  if (status === 'muted') return 'mudo';
  if (status === 'sharing-screen') return 'compartilhando a tela';
  return 'na sala';
}

function initial(name) {
  const letter = (name || '?').trim().charAt(0);
  return letter.toLocaleUpperCase('pt-BR');
}

function domId(key) {
  return `media-${key.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem('quadlink') || '{}');
  } catch {
    return {};
  }
}

if (socket.connected) setConn('on', 'conectado');
