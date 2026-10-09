# Validação de vídeos longos — 8/9 de outubro de 2026

## Causa e correção

API ativa e ingestão concluída no vídeo que falhou. GET do upload `a97d4726-ba58-4b64-8f91-c045742cb99e` revelou `TIMEOUT: Tempo máximo da transcrição excedido.`, de 23:37:38.721Z até 23:42:38.765Z: **300,044 s**. O timer inicial do serviço de transcrição disparou; preparação externa e Python também impunham 300 s. [Diagnóstico completo, antes das alterações](long-video-diagnosis-2026-10-08.md).

Havia inadequação no código para duração longa, não API offline. Os três tetos compartilhados foram separados, com [defaults/env por etapa](long-videos.md). Foi acrescentado job de ingestão e reutilizada a arquitetura de jobs de transcrição/processamento existente. O backend registra estágio/prazo/duração, e o front distingue processamento ativo, consulta lenta, indisponibilidade de conexão e erro real de etapa.

## Resultados reais

| Teste | Duração de mídia | Transcrição | Total | Resultado |
|---|---:|---:|---:|---|
| Curto conhecido, upload e pipeline pelo web 3000/API 3001 | 153,97 s | Progresso até 152,64 s, 39 segmentos | 77,19 s | 8 cortes auto, GET/range, reuso, fonte intacta |
| YouTube `ac0RGoBVzhs`, mesmo vídeo que falhou | 1778,32 s / 29min38s | 787,58 s / 13min08s | 816,76 s / 13min37s | Download separado + remux, ASR, portfolio, 1 corte, checksum/cleanup/recovery |
| Arquivo controlado de uma hora | 3600 s | 176,45 s / 2min56s | 185,75 s / 3min06s | Upload local, ASR, portfolio, 1 corte, checksum/cleanup/recovery |

O arquivo controlado tem cinco cenas de 120 s de fala portuguesa real, pausas, 320×180 a 1 fps, e fala até o final. Ele **não mede uma hora contínua de fala nem ingestão de uma hora natural por YouTube**. Valida a duração real de uma hora, reserva/gravação PCM, VAD, timestamps até 3599,78 s, status, persistência, análise, um render e reuso após reinício. Estimativa para uma hora contínua com conteúdo parecido ao vídeo de 30 min: ~26,6 min, sem garantia. A medição anterior em vídeo curto projetava ~15,2 min e se mostrou otimista para este conteúdo.

YouTube: POST 202 em **7,865 ms**, ingestão 19,17 s, 1130 segmentos/6430 palavras, última palavra 1775,04 s. Engine: 784,02 s e 3080,31 CPU-s. Áudio temporário: 56906428 bytes. Portfolio: 389 candidatos; um MICRO/DYNAMIC de 15,4 s validado com áudio, H.264/AAC, checksum e legendas. Preview PNG inspecionado visualmente. Nenhum `.part` no upload nem trabalho no `.work`; GETs e cache após uma nova instância da API passaram.

Hora controlada: POST de transcrição em **3,925 ms**, 202 segmentos/1425 palavras, última palavra 3599,78 s. PCM: 115200078 bytes. Portfolio: 78 candidatos; um SHORT/EMOTIONAL de 26,04 s. Mesmas verificações de integridade, GET/range, cleanup e reutilização passaram.

| Recurso observado | Vídeo de 29min38s | Hora controlada |
|---|---:|---:|
| Python peak working set | 2116448256 bytes (~1,97 GiB) | 1230856192 bytes (~1,15 GiB) |
| Node RSS máximo amostrado | 204099584 bytes (~194,6 MiB) | 155426816 bytes (~148,2 MiB) |
| Storage final (vídeo + JSONs) | 193821022 bytes (~184,8 MiB) | 8041760 bytes (~7,7 MiB) |
| Outputs finais (MP4 + manifesto) | 11441581 bytes (~10,9 MiB) | 2403557 bytes (~2,3 MiB) |
| PCM temporário | ~54,3 MiB | ~109,9 MiB |

Picos de Node/Python são medidos separadamente; não são um pico combinado. Pico do filho FFmpeg e pico físico do disco durante remux não foram amostrados. O scanner/reserva lógica de faixas+final é coberto pelos testes existentes. Não se extrapola a RAM da hora esparsa para uma hora contínua; são cargas diferentes.

## Web e cancelamento

Uma validação adicional detectou a instância 3000 usando `next start` com o build anterior ainda carregado, retornando o POST síncrono antigo. A instância foi identificada pelo caminho/comando, reiniciada com o build atual e validada novamente. Não se alterou a ordem dos rewrites com base em hipótese.

No web atualizado, POST YouTube respondeu **202 em 83,159 ms**. Foram observados dois processos `yt-dlp.exe` reais, launcher e descendente. DELETE confirmou `CANCELLED` em **260,226 ms**; ambos desapareceram, GET do upload retornou 404 e não restaram arquivos. Runners também passaram em testes com descendente Node simulado e com o launcher real da venv Python.

Os testes do front validam POST→ID→GET, mensagens reais de timeout, consulta offline, abandono do polling sem DELETE, cancelamento explícito e progresso validado. A interface foi compilada, seus handlers exercitados via HTTP e o corte inspecionado; não houve inspeção interativa da página no navegador nesta rodada.

## Testes e builds

- **141 testes API/worker + 15 web = 156**, todos aprovados. Incluem 12 novos testes API (defaults/env, todas as etapas, jobs independentes da request, status, quotas, cancelamento, cleanup, filho/descendente, venv, prazos nativos FFmpeg/probe e perfis 5/15/30/45/60) e 5 novos testes web.
- Typecheck e build executados com sucesso nos três apps.
- Runner nativo do novo teste web falhou por `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (parameter property); a suíte completa foi executada com o tsx existente da API, sem nova instalação. A falha de runner não era falha de produto.
- Um teste com 150 ms de prazo nativo expirou durante a verificação SHA-256 do executável, antes do spawn. O orçamento do teste passou a 1000 ms para medir especificamente a terminação do filho; defaults de produção não foram alterados por esse teste.

Evidências ignoradas pelo Git:

- `.data/long-video-validation/2026-10-09T00-23-21-111Z/result.json`: vídeo YouTube de 30 minutos.
- `.data/long-video-validation/2026-10-09T00-47-17-318Z/result.json`: uma hora controlada.
- `.data/long-video-validation/2026-10-09T00-52-15-223Z/web-result.json`: curto pelo web, 8 cortes.
- `.data/long-video-validation/2026-10-09T10-26-46-692Z/cancel-result.json`: web atualizado e cancelamento yt-dlp real.
- `.data/long-video-tests-final.log`, `.data/long-video-web-tests-passed.log`: suítes completas.

Todos os caminhos `.data` acima são relativos a `apps/api`. Fontes e resultados anteriores foram preservados; as validações longas usaram storage isolado. Os 4 GiB/16 GiB/4 GiB de outputs, checksum, formatos/seletor, small CPU/int8, FFmpeg/probe, captions e algoritmos de seleção/edição não foram enfraquecidos. Nenhuma dependência, ferramenta, modelo, secret, banco, backup ou `app/` foi modificado.

## Arquivos desta rodada e motivo

Diretórios abaixo são relativos ao workspace. Alterações anteriores não foram descartadas nem contabilizadas como mudanças novas desta rodada.

| Arquivos | Por que mudaram |
|---|---|
| `config/pipeline-timeouts.mjs`, `.d.mts` (novos) | Defaults/env centralizados e tipos compartilhados sem pacote novo |
| `apps/api/src/features/pipeline/services/stage-deadline.ts`, `terminate-process-tree.ts` (novos) | Causa/etapa/prazo e encerramento de launcher/descendentes |
| `uploads/config/storage-policy.ts`, `uploads/services/receive-video.ts` | Prazo local central e opção interna para callbacks com seus próprios budgets; concorrência intacta |
| `uploads/services/consume-upload.ts`, `verify-upload-integrity.ts`, `write-video-stream.ts` | Hash/sync com prazo e cancelamento cooperativo; cancelamento não marca vídeo íntegro como corrompido |
| `video-preparation/config/preparation-policy.ts`, `services/prepare-audio.ts` | Deadline termina antes do consumidor Whisper; cleanup preservado |
| `transcription/services/transcription-service.ts`, `faster-whisper-engine.ts`, `python-runner.ts` | Remover limites ocultos de 5 min, aplicar prazo ao ASR, progresso validado, terminar árvore |
| `transcription/types/transcript.ts`, `types/status.ts`, `tools/transcription/engine.py` | Callback/contagem real de segmentos e detalhes do timeout; modelo/parâmetros preservados |
| `analysis/services/analysis-service.ts` | Budget independente de análise/enriquecimento |
| `processing/services/processing-service.ts`, `processing-error.ts`, `processing/types.ts` | Budget de lote, propagar progresso e detalhes do erro sem mudar seleção |
| `clip-rendering/services/render-clips.ts`, `render-process.ts` | Budget por corte/lote, fonte verificada sem prazo externo de preparação, término do filho |
| `youtube-ingestion/services/ffmpeg-runner.ts`, `run-ytdlp.ts`, `stream-ytdlp.ts`, `stream-process.ts` | Budgets nativos, bytes reais, árvore/close antes de liberar recursos |
| `youtube-ingestion/services/youtube-downloader.ts`, `merge-video.ts` | Propagar bytes da faixa atual/total, sem mudar seletor/remux/limites |
| `youtube-ingestion/services/ingest-youtube.ts`, `controllers/ingestion-controller.ts`, `routes/ingestion-routes.ts`, `types/ingestion.ts` | Job 202, GET/DELETE, erro por etapa, shutdown; manter endpoint legado |
| `apps/web/next.config.ts`, `src/app/api/ingestions/youtube/route.ts` | Derivar deadlines públicos, encaminhar POST para jobs e diferenciar consulta/API offline |
| `apps/web/src/app/api/uploads/video/route.ts`, `features/video-upload/services/upload-video.ts` | Alinhar prazo de transferência local com API e margens |
| `apps/web/src/features/youtube-ingestion/services/ingest-youtube.ts`, `hooks/use-youtube-ingestion.ts`, `types/ingestion.ts`, `components/youtube-ingestion-form.tsx` | Polling, reconexão de consulta, guardar ID, bytes e cancelamento explícito |
| `apps/web/src/features/processing/services/processing-api.ts`, `hooks/use-processing.ts`, `types.ts`, `components/processing-panel.tsx` | Progresso real, continuar consultas transitórias, interrupção por reinício e botão cancelar |
| `apps/api/tests/pipeline-timeouts.test.mjs`, `apps/web/tests/long-video-polling.test.ts` (novos), `apps/web/tests/youtube-ingestion.test.ts` | Cobrir novos contratos/prioridades sem substituir regressões existentes |
| `scripts/long-videos/validate.mjs`, `create-hour-fixture.mjs`, `web-smoke.mjs`, `web-cancel.mjs` (novos) | Testes reais reproduzíveis com evidência e dados preservados |
| `README.md`, `docs/transcription.md`, `video-processing.md`, `automatic-clips.md`, `clip-portfolio.md`, `youtube-ingestion.md`, três documentos `long-*` | Tornar comandos, valores, fluxos, diagnóstico e limites coerentes |

## Limitações restantes

Jobs não são duráveis e não fazem resume de etapa interrompida. Lotes grandes podem atingir quota de outputs; bytes/codec/origem continuam limitando vídeos de uma hora. O teste de 60 min tem fala esparsa; uma hora contínua e pico do FFmpeg não foram medidos. Upload local necessita request durante a transferência. O gerenciamento de árvore validado é Windows; a instalação nativa do projeto é Windows. O MVP segue local, com uma instância por diretório e sem coordenação distribuída.
