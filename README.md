# nosso-app

Relay de chat, arquivos e sinalização WebRTC para um Discord P2P de até 4 pessoas. O servidor não lê nem processa áudio ou vídeo: voz, câmera e tela passam direto entre os navegadores. Ele só entrega mensagens, arquivos e a sinalização (`offer`, `answer`, `ice`).

## Como rodar

```bash
npm install
npm start
```

O processo escuta na porta **3000**, em todas as interfaces. Abra [http://localhost:3000](http://localhost:3000), entre com o seu nome e copie o convite. Cada amigo abre esse link no próprio aparelho e entra com o próprio nome. A sala mostra só quem conectou. Voz, câmera e tela usam o navegador (`getUserMedia` / `getDisplayMedia`) e seguem em P2P.

Na mesma rede, o convite usa o IP local (por exemplo `http://192.168.0.10:3000/?sala=mesa7k`). Mensagens, digitação e arquivos ficam só naquela sala.

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
| `chat` | `{ name, text }` | `chat` → `{ id, name, text }` na mesma sala, inclusive quem enviou |
| `typing` | `{ name }` | `typing` → `{ name }` |
| `stop-typing` | `{ name }` | `stop-typing` → `{ name }` |
| `status` | `{ status }` | `status` → `{ id, name, status }` (`in-voice`, `muted`, `sharing-screen`, `online`) |
| `offer` | `{ to, sdp }` | `offer` → `{ from, sdp }`, só no socket `to` |
| `answer` | `{ to, sdp }` | `answer` → `{ from, sdp }`, só no socket `to` |
| `ice` | `{ to, candidate }` | `ice` → `{ from, candidate }`, só no socket `to` |
| `join` | `{ room, name }` | quem entra recebe `room-members` (`[{ id, name }]`). Os outros recebem `user-joined` → `{ id, name }` |
| `leave` | `{ room }` | `user-left` → `{ id }` |

A sala aceita no máximo 4 sockets. O quinto recebe `room-full`.

Ao desconectar, a sala recebe `user-left` com `{ id }`. Chat, digitação, status e arquivo ficam nessa sala. O `from` na sinalização é o `socket.id` de quem enviou, para a malha P2P saber a quem responder.

O `name` do `status` é o último nome visto em `chat`, `typing` ou `stop-typing` naquela conexão. Se o payload de `status` também trouxer `name`, esse valor é usado.

Voz, câmera e tela ficam no front: `getUserMedia` para microfone e câmera, `getDisplayMedia` para a tela, e `RTCPeerConnection` para o P2P. O `to` de `offer` / `answer` / `ice` é o `id` recebido em `user-joined` ou `room-members`.
