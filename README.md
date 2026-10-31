# nosso-app

Relay de chat, arquivos e sinalização WebRTC para um Discord P2P de até 4 pessoas. O servidor não lê nem processa áudio ou vídeo: voz, câmera e tela passam direto entre os navegadores. Ele só entrega mensagens, arquivos e a sinalização (`offer`, `answer`, `ice`).

## Como rodar

```bash
npm install
npm start
```

O processo escuta na porta **3000**. O front entra em `public/` e passa a ser servido na raiz.

## HTTP

| Rota | Uso |
| --- | --- |
| `GET /` | Arquivos estáticos de `public/` |
| `POST /upload` | `multipart/form-data`, um arquivo, limite de 50MB. O nome do campo é livre. |
| `GET /uploads/:filename` | Baixa o arquivo salvo |

O `POST /upload` responde com `{ filename, originalName, size }` e emite o mesmo objeto no evento Socket.io `file-shared`.

```js
const formData = new FormData();
formData.append('file', arquivo);
const salvo = await fetch('/upload', { method: 'POST', body: formData }).then((r) => r.json());
```

`filename` é o nome no disco (use em `/uploads/:filename`). `originalName` é o nome que a pessoa escolheu.

## Socket.io

Conecte no mesmo host, porta 3000.

| Evento enviado | Payload | O que os outros recebem |
| --- | --- | --- |
| `chat` | `{ name, text }` | `chat` → `{ name, text }` (todos, inclusive quem enviou) |
| `typing` | `{ name }` | `typing` → `{ name }` |
| `stop-typing` | `{ name }` | `stop-typing` → `{ name }` |
| `status` | `{ status }` | `status` → `{ name, status }` (`in-voice`, `sharing-screen`, …) |
| `offer` | `{ to, sdp }` | `offer` → `sdp`, só no socket `to` |
| `answer` | `{ to, sdp }` | `answer` → `sdp`, só no socket `to` |
| `ice` | `{ to, candidate }` | `ice` → `candidate`, só no socket `to` |
| `join` | `{ room }` | `user-joined` → `socket.id` de quem entrou |
| `leave` | `{ room }` | `user-left` |

Ao desconectar, todo mundo recebe `user-left`.

O `name` do `status` é o último nome visto em `chat`, `typing` ou `stop-typing` naquela conexão. Se o payload de `status` também trouxer `name`, esse valor é usado.

Voz, câmera e tela ficam no front: `getUserMedia` para microfone e câmera, `getDisplayMedia` para a tela, e `RTCPeerConnection` para o P2P. O `to` de `offer` / `answer` / `ice` é o `socket.id` recebido em `user-joined`.
