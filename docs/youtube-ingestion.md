# Ingestão por YouTube

Upload local continua disponível em `/upload`. A página oferece **Upload de arquivo** e **Colar link do YouTube**. A troca de modo fica desabilitada durante uma operação. Sair da página encerra apenas o polling; cancelar exige a ação explícita. Veja [vídeos longos](long-videos.md).

## Fluxo

1. Web valida o formato e canonicaliza `watch`, `youtu.be` ou `shorts` pelo ID de onze caracteres.
2. `POST /api/ingestions/youtube` encaminha JSON para `POST /ingestions/youtube/jobs` da API. Retorna 202 com ID e passa a consultar `GET /api/ingestions/:id`. Corpo limitado a 4 KiB. O endpoint síncrono antigo permanece para compatibilidade.
3. API valida novamente e cria um UUID de ingestão. O mesmo UUID identifica o vídeo no storage.
4. O job executa sem manter a request inicial aberta e adquire a mesma vaga do upload local. Metadata, download, FFmpeg e FFprobe têm prazos independentes. Não há fila durável ou Redis.
5. Executável yt-dlp é verificado por SHA-256 e invocado com `spawn`, lista de argumentos e `shell: false`. Somente a URL canônica é passada, após `--`.
6. yt-dlp consulta metadados em JSON com a lista de formatos, mesmo se não houver progressivo. Um formato HTTPS MP4/WebM com áudio e vídeo juntos tem prioridade e mantém o fluxo aprovado. Sem ele, o seletor procura vídeo MP4 H.264 e áudio AAC/M4A HTTPS para remux MP4 sem reencode; prefere vídeo até 720p/60fps e áudio até 192 kbps. Se não houver vídeo nessa faixa, utiliza a menor resolução H.264 disponível. IDs são obtidos dos metadados, nunca fixados no código.
7. Tamanho estimado é validado, quando disponível, e quota é reservada antes de abrir a mídia. A duração é registrada quando conhecida; não há limite independente de duração nesta etapa. Transmissões ao vivo/em andamento são rejeitadas.
8. Após reservar quota, outro processo yt-dlp recebe novamente apenas a URL YouTube canônica e transfere o melhor progressivo do container validado usando `--output -`. Não recebe ID fixo de formato, URL assinada de mídia ou headers fornecidos pelo usuário. `--fixup never` impede correções com FFmpeg. A comunicação com o provedor, headers e desafios JS ficam com o yt-dlp e o Node existente como runtime JS.
9. Node consome stdout binário por iterador assíncrono, com backpressure e buffer de 64 KiB no wrapper. stderr é drenado separadamente e limitado à cauda de 16 KiB. O limite real e a quota continuam aplicados por chunk, independentemente da estimativa. Não há leitura do vídeo inteiro em RAM.
10. O wrapper só sinaliza EOF ao storage após receber todo stdout e confirmar encerramento com código zero. Storage grava `.part`, calcula SHA-256 sobre os mesmos bytes, publica arquivo e `metadata.json` e registra `uploaded`. Timeout, cancelamento explícito, limites e falhas encerram a árvore do subprocesso e limpam parciais antes de liberar a vaga. GET retorna `downloaded` com o upload. Desconectar o POST não cancela o job; o endpoint síncrono legado conserva seu cancelamento por desconexão.

No fallback, o próprio storage cria o diretório UUID exclusivo da operação. yt-dlp baixa cada faixa por stdout; Node grava `track-video.part` e `track-audio.part` com `wx`. FFmpeg lê somente esses arquivos locais (`-protocol_whitelist file`) e combina `0:v:0` e `1:a:0` com `-c copy`, sem filtro/reencode. A saída MP4 fragmentada (`frag_keyframe+empty_moov`) passa por stdout diretamente para `video.mp4.part`, sem outra cópia final intermediária. FFprobe confere dois streams H.264/AAC, tamanho e duração positiva coerente com a origem (tolerância de 2 s ou 5%). Somente depois são removidas as faixas e publicado o resultado final pelo storage existente.

A reserva compartilhada conta **metadata + faixas já escritas + saída final em crescimento** antes de cada escrita. O pico pode se aproximar de duas vezes o tamanho final; a quota padrão de 16 GiB não foi aumentada. Mesmo com duas vagas, a quota pode recusar operações grandes com 507. Faixas órfãs após crash são contabilizadas, nunca recuperadas como uploads completos e removidas após a retenção existente, desde que sejam arquivos regulares controlados. Falhas não publicam metadata final. Se o filesystem impedir remoção por erro/permissões, o erro é retornado e os arquivos remanescentes continuam contabilizados.

`GET /ingestions/:id` consulta a ingestão. `GET /uploads/:id` também consulta o vídeo pelo mesmo ID. Ambos omitem caminhos internos e URLs assinadas da mídia. O registro persistente contém apenas a URL YouTube canônica e os campos públicos de origem. O consumidor de uploads já existente continua verificando a integridade antes do processamento futuro.

## Estados e persistência

`queued → fetching-metadata → downloading → downloaded`, ou `failed`. O legado começa em `pending`. Esses estados representam aquisição do vídeo e não alteram a máquina de estados do upload. `downloaded` é derivado do upload persistido, sem segunda cópia de estado no disco.

O fallback usa `downloading-video → downloading-audio → merging → downloaded`. `merging` inclui validação antes da publicação. O web usa polling e informa bytes realmente recebidos. `DELETE /ingestions/:id` cancela o job e aguarda cleanup.

Tentativas em andamento e falhas ficam somente em memória; não são retomadas após reinício. Falhas expiram pela mesma retenção e o histórico transitório é limitado a aproximadamente 100 registros. Sucessos são recuperados pelo `metadata.json` do storage comum, incluindo título, duração, thumbnail canônica e checksum. Um upload expirado também deixa de existir na consulta de ingestão.

## Segurança e limites

- Aceita apenas HTTPS e hosts exatos `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`. Credenciais, portas não padrão, domínios semelhantes, playlists sem vídeo e IDs inválidos são rejeitados. Parâmetros extras nunca chegam ao downloader.
- Configurações externas, plugins, playlists, cache e componentes remotos do yt-dlp são desabilitados; somente o extractor YouTube é habilitado. Não utiliza cookies, autenticação ou proxies fornecidos pelo usuário.
- A aplicação não faz requisições à URL final da mídia pelo HTTPS do Node. Somente a URL YouTube canônica entra no subprocesso, com argumentos separados e `shell: false`. O diagnóstico da mídia é validado, mas URLs assinadas e headers não são retornados nem persistidos. O helper HTTPS antigo permanece fora do fluxo ativo; não existe fallback para ele.
- Thumbnail é reconstruída em `i.ytimg.com` a partir do ID, em vez de exibir uma URL arbitrária do downloader.
- Metadados do subprocesso são limitados a 2 MiB e stderr a 16 KiB. Erros públicos são resumidos; diagnóstico do downloader fica no log da API.
- Reutiliza **4 GiB por arquivo**, **16 GiB de quota**, **2 vagas** e **24 horas de retenção**. Metadata: 120 s; download: 60 min/faixa; FFmpeg: 20 min; FFprobe: 120 s. Todos configuráveis. Falhas não criam entrada de upload; parciais controlados são removidos e reservas liberadas.

O yt-dlp controla DNS e redirects internos, sem o pinning do helper HTTPS anterior. A validação da URL não constitui isolamento de rede. O cancelamento Windows usa `taskkill /PID <PID criado pela aplicação> /T /F`, sem shell, para encerrar launcher e descendentes. Não instala ferramentas nem altera infraestrutura; no fluxo Windows validado, cleanup aguarda o fechamento dos processos e do terminador.

Sem progressivo ou par H.264/AAC compatível, a ingestão retorna 422. Privados, removidos, restritos, bloqueios anti-bot e mudanças do YouTube podem impedir ingestão. A ingestão conserva remux sem transcode. Depois do download, o web inicia o job separado de transcrição/portfólio/cortes. Registros históricos de validação abaixo preservam os valores usados naquela medição.

FFmpeg e FFprobe locais: build BtbN Windows x64 LGPL, `n9.0.2-22-g46d8f462ee-20261006`. Pacote obtido em `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-9.0.zip`, com SHA-256 publicado `7fd0b9102f911857e04487259c8b99f6597936bdcc4956d9eabe96245c8919f9` conferido antes de executar. Manifesto `tools/ffmpeg/installation.json` registra release, origem, hashes dos executáveis e licença LGPL v3 (`LICENSE.txt`). Ambos são verificados por hash e chamados por spawn, argumentos separados, shell: false, sem instalação global/PATH/wrapper npm. Builds para outros sistemas operacionais exigem instalação/verificação correspondente.

## Resultado atual: progressivo e faixas separadas

Em 2026-10-06, os três smoke tests reais em storage isolado passaram. Nenhum cookie, login ou PO Token manual foi utilizado; nenhum HTTP 403 ocorreu nessa rodada.

| Vídeo | Seleção | Container | Duração conhecida | Bytes finais | Tempo total | GET/reinício |
| --- | --- | --- | --- | --- | --- | --- |
| Me at the zoo | Vídeo 133, 240p + áudio 140 | MP4, remux | 19 s | 742.168 | 9,85 s | 200 / 200 |
| Caminandes 1 | Progressivo 18, 360p | MP4, sem merge | 90 s | 3.934.086 | 9,41 s | 200 / 200 |
| Caminandes 2 | Vídeo 136, 720p + áudio 140 | MP4, remux | 146 s | 28.686.641 | 24,99 s | 200 / 200 |

Evidências: `apps/api/.data/youtube-smoke/2026-10-06T23-34-57-689Z/<videoId>/result.json`, incluindo URLs, formatos, estados, stderr, tempos e IDs:

- Me at the zoo: `0f9ac925-a5ed-4253-990d-bc6473149937`; SHA-256 `2a4c55c6c5a5465ce9f00eb1c1507c47ce51a5a51cc58ab22ca3a36ff0974aea`.
- Caminandes 1: `da315e87-a3a1-4241-ad35-ea88b12072b1`; SHA-256 `0bde09c4145ac526a0e98cd97dae9fdc266d87de579c7a8a7abd4dd58bce53da` (igual ao teste progressivo anterior).
- Caminandes 2: `588935b5-3ad1-44b0-89d8-05b81c3a65e0`; SHA-256 `6ff4558851302d092d7517e5af3e25c2858c2d18a50747b40f97191de4bf706e`.

Hashes conferidos independentemente no disco; GET da ingestão e do upload retornaram 200, e GET após reiniciar a API preservou checksum/origem. Cada diretório contém somente `metadata.json` e `video.mp4`, sem temporários. FFprobe validou as duas saídas combinadas; não houve transcode. A recuperação após crash não retoma downloads incompletos.

Validação desta etapa: **88 testes API/worker + 7 web = 95 testes**, sem falhas; typecheck e build das três aplicações passaram. Testes do fallback usam downloads/merge simulados para falhas determinísticas, e os smoke tests acima exercitam os executáveis reais.

## Arquivos da etapa de remux

Criados na feature `apps/api/src/features/youtube-ingestion/`:

```text
services/stream-process.ts
services/ffmpeg-runner.ts
services/merge-video.ts
services/validate-merged-output.ts
utils/select-input.ts
utils/ffmpeg-command.ts
```

Outros criados: `apps/api/tests/youtube-merge.test.mjs`, `scripts/ffmpeg/record-installation.mjs`, `tools/ffmpeg/README.md`, `tools/ffmpeg/LICENSE.txt`, `tools/ffmpeg/installation.json`, `tools/ffmpeg/downloads/release.json`, `tools/ffmpeg/downloads/checksums.sha256` e os executáveis/ZIP locais ignorados pelo Git.

Alterados: `services/stream-ytdlp.ts`, `services/downloader-command.ts`, `services/youtube-downloader.ts`, `services/ingest-youtube.ts`, `utils/parse-video-info.ts`, `types/ingestion.ts` na feature; `uploads/services/persist-video-input.ts`, `temporary-video-storage.ts`, `scan-upload-storage.ts`; `scripts/youtube-ingestion/smoke-test.mjs`, `.gitignore`, `README.md` e este documento. `youtube-formats.test.mjs` não teve alteração funcional nesta etapa.

O wrapper de subprocesso foi extraído para compartilhar EOF/código zero, backpressure, cancelamento e stderr entre yt-dlp e FFmpeg/FFprobe. O storage ganhou staging opcional e validação antes da publicação; o fluxo local/progressivo não usa staging e mantém seus contratos. Não houve remoção de código existente.

## Testar manualmente

Com dependências existentes e o executável instalado/verificado, em dois terminais na raiz:

```powershell
pnpm.cmd dev:api
pnpm.cmd dev:web
```

Abra `http://localhost:3000/upload`, selecione **Colar link do YouTube**, informe um link público acessível e clique em **Importar do YouTube**. Confira título/duração/thumbnail quando disponíveis, ID e estado final. Repita com um link inválido e confirme que o upload local ainda funciona.

Diretamente pela API:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:3001/ingestions/youtube -ContentType application/json -Body '{"url":"https://www.youtube.com/watch?v=SEU_VIDEO_ID"}'
Invoke-RestMethod http://127.0.0.1:3001/ingestions/SEU_UUID
```

Teste real isolado, após build da API:

```powershell
pnpm.cmd --filter @clipador-ia/api build
node scripts/youtube-ingestion/smoke-test.mjs
node scripts/youtube-ingestion/smoke-test.mjs https://www.youtube.com/watch?v=jNQXAC9IVRw https://www.youtube.com/watch?v=JOhiWY7XmoY https://www.youtube.com/watch?v=Z4C82eyhwgU
node scripts/youtube-ingestion/diagnose.mjs https://www.youtube.com/watch?v=JOhiWY7XmoY
```

O smoke test aceita até três URLs, usa Caminandes 1 por padrão e inicia somente sua própria API em porta aleatória. Conserva evidência em `apps/api/.data/youtube-smoke/<data>/<videoId>/result.json`, separada do storage isolado `uploads/`. Registra formatos, seleção prevista nos metadados, stderr do download (incluindo formato efetivamente escolhido), tempos, bytes recebidos/armazenados e GET por ID. Em caso de sucesso, verifica hash independente em disco e recuperação por HTTP após reinício. A segunda extração pode encontrar formatos diferentes; o container é fixado para manter MIME/extensão corretos, mas a resolução não é garantida. Falha de qualquer cenário resulta em exit code 1.

`diagnose.mjs` consulta somente metadados/formatos estruturados, sem transferir mídia. Ambos usam o executável verificado, não instalam ferramentas e não alteram o storage habitual.

### Histórico e resultado real da transferência por stdout

O teste autorizado fora da sandbox em 2026-10-06 retornou **422 em 2,33 segundos**. yt-dlp 2026.08.19 informou `This video is unavailable` para `BaW_jenozKc`. Metadados não foram obtidos, o download não iniciou, tamanho/duração/checksum não foram gerados e nenhum vídeo ou metadata de upload foi criado. A tentativa ficou `failed`. Evidência: `apps/api/.data/youtube-smoke/2026-10-06T18-07-06-734Z/result.json`.

Em 2026-10-06, a transferência por Node do Caminandes 1 retornou HTTP 403. Transferindo pelo próprio yt-dlp 2026.08.19, no mesmo ambiente e sem cookies/PO Token fornecidos pela aplicação, o teste real passou:

| Vídeo / ID YouTube | Duração | Formatos | Resultado | Tempo total |
| --- | --- | --- | --- | --- |
| Me at the zoo / jNQXAC9IVRw | 19 s | 24; nenhum progressivo compatível | 422, requer etapa futura para faixas separadas | 3,46 s |
| Caminandes 1 / JOhiWY7XmoY | 90 s | 31; progressivo 18 MP4 360p | 200, download e persistência concluídos | 10,11 s |
| Caminandes 2 / Z4C82eyhwgU | 146 s | 47; nenhum progressivo compatível | 422, requer etapa futura para faixas separadas | 3,67 s |

Caminandes 1: **3.934.086 bytes**, transferência incluindo nova extração em **5,38 s**; ID `62bc4bd9-cc89-40e7-801f-715e01d37207`; SHA-256 `0bde09c4145ac526a0e98cd97dae9fdc266d87de579c7a8a7abd4dd58bce53da`. GET da ingestão e upload retornaram 200; após reiniciar a API, GET da ingestão retornou 200 com o mesmo checksum. Hash foi conferido independentemente lendo o arquivo salvo. Evidências em `apps/api/.data/youtube-smoke/2026-10-06T23-13-46-378Z/`.

Os outros dois testes retornaram metadata pública e GET de ingestão 200/failed, mas GET de upload 404, zero bytes armazenados e nenhum parcial. Não houve necessidade demonstrada de PO Token nesses testes; ausência de progressivo não prova necessidade de token. Não foram testadas as faixas separadas. O detalhe específico que causava o 403 anterior não foi isolado; o sucesso confirma que delegar comunicação/transferência ao yt-dlp resolveu aquele caso.

Validação da etapa anterior de stdout: **80 testes da API/worker e 7 do web passaram,
sem falhas (87 ao todo)**. `pnpm.cmd typecheck` e `pnpm.cmd build` passaram para as
três aplicações. Os testes incluem regressões do upload local. Não foi executada
validação visual em navegador nesta etapa.

## Arquivos da mudança para stdout

Criados: `services/downloader-command.ts` (argumentos e executável comuns), `services/stream-ytdlp.ts` (stream e ciclo de vida do processo), `apps/api/tests/youtube-stream.test.mjs` (11 testes com subprocessos Node locais).

Alterados na feature: `run-ytdlp.ts`, `youtube-downloader.ts`, `utils/parse-video-info.ts`, `utils/downloader-error.ts`, `ingest-youtube.ts` e o helper inativo `download-media.ts` (compatibilidade com dispose assíncrono). Fora da feature: `uploads/services/persist-video-input.ts`, `youtube-formats.test.mjs`, `scripts/youtube-ingestion/smoke-test.mjs` e este documento. Não houve instalação, remoção de arquivos ou alteração do fluxo local.

Os testes novos cobrem leitura antes do término do processo, buffers limitados/backpressure, stderr separado/limitado, saída não zero após bytes, processo encerrado por sinal, falha ao iniciar, cancelamento, timeout, quota, limite configurável, checksum, limpeza e desconexão HTTP. O teste de limite usa 128 bytes em subprocesso isolado por variável de ambiente, exercitando o mesmo controle de 4 GiB sem escrever gigabytes no disco.

## Arquivos desta etapa

Criados:

```text
config/
  youtube-url.mjs
  youtube-url.d.mts
apps/api/src/features/uploads/
  services/persist-video-input.ts
  utils/parse-upload-source.ts
apps/api/src/features/youtube-ingestion/
  controllers/ingestion-controller.ts
  routes/ingestion-routes.ts
  services/download-media.ts
  services/ingest-youtube.ts
  services/run-ytdlp.ts
  services/verify-downloader.ts
  services/youtube-downloader.ts
  types/ingestion.ts
  utils/media-url.ts
  utils/parse-video-info.ts
apps/web/src/features/video-input/
  components/video-input.tsx
apps/web/src/features/youtube-ingestion/
  components/youtube-ingestion-form.tsx
  components/youtube-ingestion.module.css
  hooks/use-youtube-ingestion.ts
  services/ingest-youtube.ts
  types/ingestion.ts
  utils/parse-ingestion-result.ts
apps/web/src/app/api/ingestions/youtube/route.ts
apps/api/tests/youtube-ingestion.test.mjs
apps/api/tests/youtube-security.test.mjs
apps/web/tests/youtube-ingestion.test.ts
scripts/youtube-ingestion/smoke-test.mjs
docs/youtube-ingestion.md
tools/yt-dlp/
  yt-dlp.exe (local, ignorado pelo Git)
  installation.json
  SHA2-256SUMS
  release.json
  README.md
```

Alterados:

```text
.gitignore
README.md
apps/api/src/server/create-server.ts
apps/api/src/server/register-routes.ts
apps/api/src/features/uploads/routes/upload-routes.ts
apps/api/src/features/uploads/services/receive-video.ts
apps/api/src/features/uploads/services/read-upload-stream.ts
apps/api/src/features/uploads/types/upload.ts
apps/api/src/features/uploads/utils/parse-upload-metadata.ts
apps/web/next.config.ts
apps/web/src/app/upload/page.tsx
apps/web/src/features/video-upload/components/video-upload-form.tsx
```

`persist-video-input` extrai o trecho de persistência comum para abrir mídia somente
depois de reservar quota. `receive-video` mantém o controle compartilhado de vaga,
timeout e operações. `read-upload-stream` agora também verifica `source.errored`,
pois um erro pode ocorrer enquanto o arquivo está sendo escrito; a persistência
captura eventos nesse intervalo para impedir erro solto. A regressão é coberta pelo
teste de download interrompido. O formulário local apenas comunica seu estado
ocupado ao seletor de modos; seu fluxo de envio permanece disponível.
