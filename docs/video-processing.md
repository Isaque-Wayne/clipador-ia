# Processamento de vídeo — primeiro bloco

Este documento registra o primeiro bloco de preparação. A engine local foi
posteriormente instalada e a transcrição real validada; o estado atual e as
rotas estão em [transcrição e análise](transcription.md).

## Estado entregue

Ingestão → verificação SHA-256 → inspeção técnica → metadata persistente → áudio para ASR → callback consumidor → cleanup.

Este bloco termina antes da engine de transcrição. Não há cortes, análise de IA,
legendas, worker ativo, porcentagens ou resultados simulados na interface.

## Árvore criada

```text
apps/api/src/features/
  video-preparation/
    config/preparation-policy.ts
    controllers/inspect-upload.ts
    routes/preparation-routes.ts
    services/
      inspect-video.ts
      open-media-input.ts
      prepare-audio.ts
      prepare-video.ts
      read-probe-json.ts
      validate-prepared-audio.ts
    types/
      inspection.ts
      preparation.ts
    utils/
      media-commands.ts
      parse-inspection.ts
      parse-probe.ts
  transcription/
    types/transcript.ts
    services/normalize-transcript.ts
apps/api/tests/video-preparation.test.mjs
scripts/video-preparation/smoke-test.mjs
docs/video-processing.md
```

## Responsabilidades

- FFprobe fornece JSON limitado a 512 KiB: duração, dimensões codificadas,
  aspect ratio declarado, FPS racional, container, codecs, sample rate, canais e bitrate.
  FPS/bitrate podem ser nulos; ausência de áudio é explícita.
- A inspeção fica no campo opcional `inspection` de `metadata.json`.
  Atualização atômica e quota existentes são reutilizadas. Uploads antigos continuam válidos.
- `POST /uploads/:id/inspect` verifica integridade e inspeciona um upload conhecido.
  `GET /uploads/:id` retorna também a inspeção, inclusive depois de reiniciar.
- `createVideoPreparation(uploads).prepare(id, consumer, signal, onStage)` prepara
  áudio e chama o consumidor dentro da operação protegida. Não é uma fila nem
  um endpoint que afirma ter transcrito. O callback recebe caminho interno, inspeção e sinal.
- Áudio é WAV PCM s16le, mono, 16 kHz: aproximadamente 32.000 bytes/s.
  `aresample` ancora os timestamps de áudio em zero para preparar alinhamento
  com a linha do tempo de entrada. Não modifica ou recomprime o vídeo original.
- FFmpeg emite áudio por stdout com backpressure; a escrita reutiliza o writer
  limitado existente. O arquivo fixo `audio-asr.wav.part` só é entregue depois
  de exit zero, sync e validação por FFprobe. Nenhum áudio inteiro fica em RAM.
- Reserva conservadora: `(duração + 2 segundos) × 32.000 + 4.096 bytes`,
  seguida de controle por bloco. Reserva e upload original contam na mesma quota.
  Um refresh não conta novamente o áudio já reservado.
- O consumidor deve terminar antes de retornar e respeitar o AbortSignal.
  Sucesso, erro, timeout e cancelamento removem o áudio da operação. Depois de
  crash, áudio órfão conta quota sem invalidar o vídeo original já publicado.
  Na API padrão não há mais expiração por idade: veja [Biblioteca](library.md).
  Colisão não sobrescreve nem apaga arquivo preexistente.
- Preparação protege o upload da retenção e compartilha as vagas existentes
  de concorrência. Preparação de áudio usa prazo de 1.200.000 ms configurável por
  `VIDEO_PREPARATION_TIMEOUT_MS`; Whisper, análise e render recebem prazos próprios,
  sem herdar esse teto externo. Veja [vídeos longos](long-videos.md).
- Comandos usam executáveis verificados, spawn sem shell e argumentos separados.
  Cada ferramenta recebe um descritor regular via stdin e protocolo `fd:`,
  com suporte a seek. Identidade, tamanho e tempos são comparados com o
  arquivo cujo checksum foi verificado antes de herdar esse descritor.
  Identificadores e tempos usam bigint/nanosegundos para não perder precisão
  dos IDs de arquivo do Windows.
  Isso evita confiar em um caminho que possa ter sido substituído, sem
  recalcular SHA-256 para cada ferramenta. Um novo descritor validado por
  ferramenta evita compartilhar o cursor deixado pelo FFprobe.
  Protocolos e demuxers são limitados ao descritor MP4/MOV/WebM, ou WAV
  na validação do áudio; playlists e fontes de rede não são aceitas nessa etapa.
- Contrato de transcrição é independente da engine. Normalização preserva
  pontuação, timestamps e probabilidades, normaliza espaços/idioma e rejeita
  dados inválidos ou segmentos falados sem palavras temporizadas.

Arquivos existentes ajustados: `uploads/types/upload.ts`,
`uploads/utils/parse-upload-metadata.ts`, `uploads/services/upload-coordinator.ts`,
`uploads/services/receive-video.ts`, `uploads/services/scan-upload-storage.ts`,
`youtube-ingestion/services/ffmpeg-runner.ts`, `youtube-ingestion/services/stream-process.ts`,
`server/register-routes.ts` e README.

## Validação manual

Depois de ingerir um vídeo real com áudio, usando o ID retornado:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:3001/uploads/ID/inspect'
Invoke-RestMethod -Uri 'http://localhost:3001/uploads/ID'
```

Use a porta configurada da API (substitua `3001` se necessário). Não há botão
de processamento no web neste bloco, pois a engine ainda não foi instalada.

Smoke test offline, com fixture sintética de dois segundos e storage isolado:

```powershell
pnpm --filter @clipador-ia/api build
node scripts/video-preparation/smoke-test.mjs
```

O script gera MP4 com moov no fim (exige seek) usando FFmpeg local verificado,
ingere, inspeciona, prepara WAV,
valida cleanup após sucesso/falha/cancelamento, quota e recuperação. POST/GET
são exercitados por `server.inject`, sem iniciar servidor de rede. Artefatos
de teste permanecem em `.data/preparation-smoke/`; nenhum dado real é alterado.

## Bloqueio e próxima decisão

Não foi encontrada engine ASR utilizável, nem instalação Python confirmada:
os comandos encontrados apontam para aliases do WindowsApps. Não houve download
ou instalação nesta fase.

Proposta: Python x64 local, ambiente isolado em `tools/transcription/venv`,
`faster-whisper` com dependências transitivas e modelo multilíngue `small`
em `tools/transcription/models/`. Execução inicial CPU int8, word timestamps,
sem CUDA, chave, API paga, alteração do PATH ou instalação global.
Versões, licença, origem, hashes e revisão do modelo devem ser registrados
na instalação autorizada; downloads automáticos devem ser desabilitados no runtime.

[faster-whisper](https://github.com/SYSTRAN/faster-whisper) suporta quantização
int8 e timestamps por palavra. Requer Python e pacotes nativos, incluindo
CTranslate2 e PyAV. [CTranslate2](https://opennmt.net/CTranslate2/installation.html)
oferece wheels Windows; requer runtime Visual C++ (DLLs principais encontradas
nesta máquina, compatibilidade ainda deve ser verificada na instalação).
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) evita Python, mas também
exige binário/modelo novos e documenta timestamps por palavra como experimentais.

Impactos: download e espaço para Python, dependências e modelo; uso de CPU/RAM
e latência a medir com fala real em português. Reserva sugerida para instalação:
até 3 GiB de disco, distinta da quota temporária de mídia; não é um tamanho medido.
Qualidade de reconhecimento e alinhamento não são garantidas sem esse smoke test.

Validação executada neste bloco: 99 testes API/worker + 7 testes web, todos
passando, sem skips; typecheck e build nos três apps; smoke test offline real
com FFmpeg/FFprobe. Fixture MP4 de 2 s, 320×180, 25 FPS, áudio AAC 48 kHz;
WAV preparado validado como PCM mono 16 kHz. POST de inspeção e GET após
recriar a API retornaram 200, com metadata e checksum preservados. Cleanup
após sucesso, falha do consumidor e cancelamento e bloqueio por quota passaram.
Último smoke: ID `09ba032a-549d-488e-a23d-23bcd6f5c7d1`, aproximadamente 1,92 s
para as verificações pós-ingestão, em storage isolado. Não é benchmark de
vídeo longo ou teste de reconhecimento de fala.

Depois da autorização: instalar e verificar ASR, executar transcrição real com
normalização, e então avançar em análise/score explicável, seleção, render vertical,
legendas e resultados reais. Provedor externo de análise continua dependendo de
autorização específica. O contrato de engine não é uma transcrição funcional.

Limitações deste bloco: coordenação em um processo, sem fila durável; o hash de
entrada é verificado novamente por consumo e atualmente termina sua leitura
antes de observar o timeout de preparação. O callback precisa cooperar com
cancelamento; política de duração para processamento e rotação de vídeo devem
ser tratadas antes do render. Preparação não altera os estados de ingestão.
