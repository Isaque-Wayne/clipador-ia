# Vídeos longos no MVP

O fluxo foi preparado para 5, 15, 30, 45 e 60 minutos, conservando os limites de bytes e a engine small CPU/int8. A duração não substitui a validação de tamanho, codec, quota, integridade e disponibilidade da origem. O [diagnóstico anterior à alteração](long-video-diagnosis-2026-10-08.md) identificou a falha real de 300,044 segundos.

## Prazos independentes

Fonte única: `config/pipeline-timeouts.mjs`, com tipos em `.d.mts`. Inteiros positivos até 2147483647 ms; valores inválidos geram erro, sem fallback silencioso. Defina as variáveis no terminal da API e antes do build do web; não há carregamento automático de `.env`. Variáveis públicas do web são derivadas pela configuração, não devem ser configuradas separadamente.

| Variável | Default | Aplicação |
|---|---:|---|
| `METADATA_TIMEOUT_MS` | 120000 / 2 min | Metadata yt-dlp |
| `DOWNLOAD_TIMEOUT_MS` | 3600000 / 60 min | Transferência progressiva ou cada faixa separada |
| `FFMPEG_TIMEOUT_MS` | 1200000 / 20 min | Remux, extração/medição de áudio |
| `FFPROBE_TIMEOUT_MS` | 120000 / 2 min | Cada inspeção nativa |
| `VIDEO_PREPARATION_TIMEOUT_MS` | 1200000 / 20 min | Preparação/validação de PCM; termina antes do Whisper |
| `TRANSCRIPTION_TIMEOUT_MS` | 3600000 / 60 min | Whisper, incluindo seu launcher Python |
| `ANALYSIS_TIMEOUT_MS` | 900000 / 15 min | Enriquecimento, análise e persistência |
| `RENDER_TIMEOUT_MS` | 3600000 / 60 min | Lote, incluindo EditPlans/assets |
| `RENDER_CLIP_TIMEOUT_MS` | 300000 / 5 min | FFmpeg de cada corte |
| `STORAGE_TIMEOUT_MS` | 300000 / 5 min | Verificação SHA-256 e sync do arquivo |
| `UPLOAD_TIMEOUT_MS` | 1800000 / 30 min | Upload local; endpoint síncrono legado |
| `API_REQUEST_TIMEOUT_MS` | 15000 / 15 s | Início/consulta de job, não a execução |

Os limites externos de cinco minutos foram retirados dos callbacks que executam Whisper, análise e render. Cada etapa continua recebendo o sinal de cancelamento, além do seu próprio prazo. Streaming de escrita observa o orçamento da transferência; `STORAGE_TIMEOUT_MS` não limita um download inteiro a cinco minutos. Syscalls de filesystem já iniciadas terminam antes do cleanup; não se fecha um arquivo enquanto uma escrita estiver em curso.

O timeout de socket do yt-dlp continua em 15 segundos de inatividade, com um retry; é diferente do prazo total de download. Na medição real, download/remux de 29min38s levou 19,17 s, preparação ~3 s, análise ~3,50 s e um corte ~5,13 s. Metadata/probe ganham margem para inicialização/rede. Preparação/análise são menores que ASR, com margens para arquivos grandes. O render ganhou cinco minutos por corte para os planos de até 180 s; o lote tem orçamento separado.

Benchmark curto anterior: 153,97 s de vídeo em 38,99 s. Projeção inicial: 30 min ~7,6 min; 60 min ~15,2 min. O novo vídeo real de 1778,32 s exigiu 787,58 s (~13min08s): projeção mais conservadora, ~13,3 min para 30 min e **~26,6 min para 60 min**, cerca de 2,25 vezes de margem até o deadline de uma hora. Conteúdo e carga alteram o desempenho; essas projeções não são garantias.

## Jobs e interface

1. O web envia `POST /api/ingestions/youtube`; seu handler encaminha para `/ingestions/youtube/jobs` e retorna **202 com ID**.
2. A ingestão segue no servidor: `queued`, metadata, download/faixas, merge, `downloaded` ou `failed`. GET `/ingestions/:id` consulta status; DELETE cancela e aguarda cleanup. `downloaded` equivale à conclusão da aquisição, distinta da conclusão dos cortes.
3. Após ingestão, o job existente `/uploads/:id/portfolio/process` retorna 202 e executa preparação, transcrição, análise, planos e render. GET status/resultados continuam separados.
4. Desconectar uma consulta ou fechar a página não cancela esses jobs. O ID YouTube fica no localStorage e a página pode voltar a consultar a ingestão e anexar-se ao processamento existente. Cancelar exige DELETE explícito.

O endpoint API antigo `/ingestions/youtube` permanece síncrono e mantém cancelamento por desconexão para compatibilidade; não é usado pelo web atualizado. Endpoints diretos de análise permanecem disponíveis; trabalhos longos do web passam pelo job de processamento. Upload local mantém a request enquanto transfere o corpo do arquivo; o processamento posterior é assíncrono.

Download informa bytes realmente recebidos, com estimativa quando disponível. Whisper emite mensagens estruturadas no stderr por segmento; stdout continua sendo apenas o JSON final íntegro, com limite de 16 MiB. Status informa segmentos e posição temporal realmente processada. VAD pode avançar pela pausa, sem que isso seja um percentual de trabalho/tempo restante. Render informa cortes concluídos/selecionados.

Um prazo real retorna `TIMEOUT`, etapa, orçamento, duração e mensagem específica. Render individual mantém `RENDER_TIMEOUT` e detalhes do corte. Falhas de FFmpeg/downloader/Python mantêm suas mensagens do backend e diagnóstico no log. Deadline de uma consulta retorna `REQUEST_TIMEOUT` e não confirma falha do job; problemas de conexão usam `API_UNAVAILABLE`. O web mantém o polling em falhas transitórias de consulta e expõe cancelamento separado.

No Windows, executáveis de venv/yt-dlp têm launcher e descendentes. `terminate-process-tree.ts` usa o `taskkill.exe` do Windows com PID do processo criado, `/T /F`, sem shell. Runners aguardam fechamento e conclusão do terminador antes de devolver controle para cleanup. Testes confirmam o PID descendente da venv real e a árvore yt-dlp real. Os binários/modelo não foram alterados ou reinstalados.

## Quota e recuperação

Mantidos **4 GiB por arquivo, 16 GiB de storage e 4 GiB separados para outputs**. Uma hora de vídeo a 6 Mbps ocupa cerca de 2,5 GiB; 4 GiB correspondem a ~9,54 Mbps médios totais por hora. Vídeos de bitrate superior podem exceder o limite, independentemente da duração. O seletor mantém prioridade progressiva e fallback H.264/AAC até a qualidade já validada.

PCM mono 16 kHz/16 bits: 32000 bytes/s; uma hora gerou **115200078 bytes (~109,86 MiB)**. Remux pode manter faixas mais saída em crescimento, aproximando duas vezes o vídeo; duas operações máximas e resultados anteriores podem exceder 16 GiB, e a quota continua recusando a operação com 507. Não há promessa de duas ingestões de 4 GiB caberem junto do pico de remux. Quota é lógica, não uma reserva física do volume.

Outputs continuam com orçamento por clip, teto de 128 MiB e manifesto de até 16 MiB. Um lote grande pode ser recusado por quota de outputs; escolha `quantity: "few"` ou IDs explícitos na API, sem reduzir proteções. O controle de quantidade por UI não foi adicionado nesta rodada.

Vídeo/metadata/transcript/portfolio/batches concluídos permanecem íntegros e reutilizáveis após reinício. Jobs ativos e falhas recentes permanecem em memória; não há fila durável, retomada parcial ou retry automático do trabalho. Reinício sem resultado concluído exige novo POST. A interface distingue `not-started` como interrupção e permite tentar novamente. Ingestão interrompida sem metadata não é recuperada como concluída; o ID deixa de ser consultável após reinício. Graceful shutdown cancela filhos e limpa parciais; órfãos de encerramento forçado continuam sujeitos ao scanner/retenção existente.

## Verificações

```powershell
pnpm.cmd typecheck
pnpm.cmd build
$apiTests = @(rg --files apps/api/tests apps/worker/tests -g '*.test.mjs')
node --test --test-concurrency=1 $apiTests
pnpm.cmd --filter @clipador-ia/api exec tsx --test ../web/tests/long-video-polling.test.ts ../web/tests/processing.test.ts ../web/tests/upload-proxy.test.ts ../web/tests/upload-validation.test.ts ../web/tests/youtube-ingestion.test.ts
```

O tsx já estava instalado na API. O runner nativo `--experimental-strip-types` não suporta a propriedade de parâmetro da classe importada pelo novo teste; não foram instaladas dependências ou enfraquecidos tipos para contornar isso.

Scripts de validação em `scripts/long-videos/`: `validate.mjs` inicia uma API temporária isolada e fecha ao terminar; `create-hour-fixture.mjs` gera arquivo controlado sem tocar nas fontes; `web-smoke.mjs` usa serviços locais 3000/3001; `web-cancel.mjs` verifica cancelamento e processos reais. Resultados são preservados em `.data` ignorado pelo Git. Depois de build novo, uma instância `next start` deve ser reiniciada para carregar o código atual; a instância em 3000 foi reiniciada na validação.

Os [resultados reais, arquivos alterados e limites da medição](long-video-validation-2026-10-09.md) complementam esta configuração.
