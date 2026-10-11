# Validação da Biblioteca — 9 de outubro de 2026

Horário local: America/Sao_Paulo. Os artefatos usam UTC, portanto os diretórios
de evidência criados nesta noite começam com `2026-10-10`.

## Diagnóstico e preservação

Antes da gestão havia quota de outputs fixa em 4 GiB, reserva conservadora do lote
inteiro e rollback apagando cortes do lote que não chegasse ao commit final.
Não havia listagem de projetos, consulta de todos os lotes ou exclusão manual.
Os uploads tinham retenção de 24 h; o padrão atual preserva os projetos até exclusão
explícita. Nenhum projeto real foi excluído e nenhuma dependência foi instalada.

A varredura das raízes ativas encontrou **4 projetos e 11 cortes antigos**.
Pastas de validação isoladas e backups não são incluídos nas raízes do produto.
Os diretórios reais de upload continham 3 projetos; o quarto tinha somente outputs.
`cae46657-c596-4120-83b4-23bd7552fcbe` já não possuía original/metadata no primeiro
inventário desta implementação. Seus 3 cortes permanecem íntegros/acessíveis e
o projeto é exibido com aviso. Nenhum original ausente foi apagado nesta rodada.

| Medida antes do retry real | Bytes | Aproximado |
| --- | ---: | ---: |
| Originais | 385.801.008 | 367,93 MiB |
| Transcrições/metadados/análises | 4.034.072 | 3,85 MiB |
| Outputs/manifestos | 129.547.365 | 123,55 MiB |
| Temporários | 0 | 0 |
| Total | 519.382.445 | 495,32 MiB |
| Quota uploads | 17.179.869.184 | 16 GiB |
| Quota outputs | 4.294.967.296 | 4 GiB |

O projeto real `b3cca3d0-2500-4338-8c8b-04f71a115568`, “Ensinei o Primo Rico a
Fazer PERMUTA de Verdade”, já tinha transcript e portfolio persistidos. A seleção
automática existente retorna **89 candidatos**. A fórmula antiga solicita
**4.336.166.948 bytes**, excedendo a quota de outputs mesmo sem somar os
129.547.365 bytes antigos. O disco tinha mais de 317 GiB livres. O diagnóstico
é uma reserva lógica conservadora do lote, não disco fisicamente cheio.
O erro histórico não estava persistido em log/estado disponível após reinício;
a condição foi confirmada por cálculo sobre o report real e pelo código da
reserva anterior. Não foi inventado um log histórico de backend.

A correção mantém a quota e a seleção, reserva apenas o orçamento do próximo
corte/manifesto, contabiliza bytes efetivos e persiste cada resultado validado.
Nenhum algoritmo de score, candidatos, perfil, estilo, ASR ou ingestão foi mudado.
yt-dlp, argumentos de download, progressivo/fallback, FFmpeg de ingestão, FFprobe,
storage de vídeo/checksum, concorrência de ingestão e modelos continuam os mesmos.
Em `ingest-youtube.ts` apenas se propaga o código específico de quota de uploads.

## Evidências de execução

Inventário, hashes de todos os originais presentes e dos 11 cortes antigos,
GETs de detalhes/outputs e ranges:
`apps/api/.data/library-validation/real-2026-10-10T01-15-32.922Z/result.json`.
`/library`, as 4 páginas de detalhe e o proxy `/api/projects` retornaram 200.
Os 11 MP4s serviram 206 para ranges de 32 bytes, sem novo processamento.

Fixture nativa com FFmpeg:
`apps/api/.data/library-validation/2026-10-10T01-14-52.361Z/result.json`.
O teste usa quota pequena deliberada, preserva o primeiro MP4, falha no segundo
com OUTPUT_QUOTA e persiste a causa/espaço necessário. Reinicia a API, confirma
o erro na Biblioteca e exclui **somente o projeto de teste** blocker:

- Projeto excluído `bc5e82cb-bd89-4cbc-867f-a6c9e8a22a07`.
- Espaço lógico liberado: **1.058.603 bytes**, exatamente a diferença do dashboard.
- Projeto retomado `f19551f2-5b86-4729-b43e-89a6c11037af`.
- Primeiro corte mantém path, checksum, metadata e mtime.
- Segundo corte renderiza, ASR não é reexecutado (`engineCalls = 1`).
- Original e outro projeto permanecem acessíveis; exclusão com job ativo retorna 409.
- Exclusão só de outputs libera **175.291 bytes**, preserva transcript/analysis/source.
- `.work` fica vazio e não restam partes no upload.

**Validação visual limitada:** o skill `computer-use:computer-use` foi inicializado,
mas a ferramenta interrompeu as ações ao não determinar com confiança a URL atual
da janela Chrome. Nenhuma ação posterior de UI foi executada. As páginas/proxies,
contratos de galeria (24 cortes), MP4s/ranges foram validados programaticamente;
não se afirma clique/playback interativo ou responsividade visual nesta rodada.

## Arquivos e motivos

Criados:

- `apps/api/src/features/library/services/library-files.ts`: preflight de árvore,
  proteção contra links/paths externos e exclusão controlada com bytes liberados.
- `apps/api/src/features/library/services/library-service.ts`: inventário,
  detalhes, todos os lotes, dashboard, escopos de exclusão e retry por projeto.
- `apps/api/src/features/library/controllers/serve-original.ts`: player original
  com ranges e checksum no mesmo handle, protegendo o projeto durante leitura.
- `apps/api/src/features/library/routes/library-routes.ts`: contratos HTTP e
  confirmação explícita; sem lógica de filesystem nas routes.
- `apps/api/src/features/clip-rendering/services/output-usage.ts`: uso real de
  arquivos, temporários, quota configurável e espaço físico via statfs.
- `apps/api/src/features/processing/services/processing-state.ts`: estados/seleção/
  estilo e causa da falha em disco, com hash e limite de tamanho.
- `apps/web/src/app/library/page.tsx` e `library/[id]/page.tsx`: rotas do produto.
- `apps/web/src/features/library/types.ts` e `services/library-api.ts`: contratos,
  validação externa e formatação de bytes/duração.
- `apps/web/src/features/library/components/library-page.tsx`: filtros, busca,
  ordenação, projetos e dashboard integrado ao Glassmorphism.
- `project-page.tsx`: original, transcript/candidatos, galeria de todos os lotes,
  pagination, download e retry explícito sem auto-processar ao abrir.
- `storage-dashboard.tsx`, `delete-dialog.tsx`, `library.module.css`: quotas
  separadas, confirmação nativa com foco/cancelamento e aparência do produto.
- `apps/api/tests/library.test.mjs`, `apps/web/tests/library.test.ts`: segurança,
  persistência, cálculo, galeria e retry com fixture real.
- `scripts/library/validate.mjs`, `watch-retry.mjs`: inventário read-only,
  integridade e acompanhamento da validação real.
- `docs/library.md` e este relatório: comandos, contratos, limites e evidências.

Alterados:

- `uploads/config/storage-policy.ts`: encerra retenção automática padrão.
- `uploads/services/upload-coordinator.ts`, `receive-video.ts`: leases de jobs,
  streams e exclusão, serialização/atualização de quota e escrita de estado.
- `uploads/services/scan-upload-storage.ts`: estados e seus parciais contam na quota.
- `uploads/services/storage-quota.ts`, `uploads/routes/upload-routes.ts`:
  `UPLOAD_STORAGE_QUOTA` e orientação de gestão manual.
- `analysis/services/analysis-service.ts`, `transcription/services/transcription-service.ts`:
  protegem o projeto durante todo o job; ASR propaga quota específica.
- `processing/services/processing-service.ts`, `types.ts`, `processing-error.ts`:
  seleção/preferências persistidas, status/retry/cache e detalhes de quota.
- `processing/controllers/processing-controller.ts`, `routes/processing-routes.ts`:
  preservam detalhes de erro e registram Biblioteca com os serviços existentes.
- `clip-rendering/services/clip-storage.ts`, `render-clips.ts`, `types.ts`:
  contabilidade, commit por corte, requestedIds e reutilização de lote parcial.
  Playback valida o manifesto e checksum do MP4 solicitado, evitando reler todos
  os MP4s de uma galeria grande a cada range. Outros clips corrompidos não impedem
  assistir um MP4 íntegro; um arquivo alterado é bloqueado em 409.
- `clip-rendering/controllers/serve-clip.ts`: proteção durante streaming.
- `youtube-ingestion/services/ingest-youtube.ts`: somente código da quota de uploads.
- `apps/web/next.config.ts`: proxies de `/projects` e `/storage` para a mesma API.
- `apps/web/src/components/site-header.tsx`/`.module.css`: Biblioteca na navegação.
- `apps/web/src/features/processing/types.ts`, `services/processing-api.ts`,
  `hooks/use-processing.ts`, `components/processing-panel.tsx`: detalhes de quota,
  botão Gerenciar armazenamento e clips parciais preservados em falha.
- `apps/api/tests/clip-rendering.test.mjs`, `upload-storage.test.mjs`: expectativas
  da nova persistência e do código de quota específico.
- `README.md`, `docs/automatic-clips.md`, `youtube-ingestion.md`,
  `video-processing.md`, `clip-portfolio.md`: comandos e ciclo atual coerentes.

## Verificações

- `pnpm.cmd typecheck`: passou nas três aplicações.
- `pnpm.cmd build`: passou nas três aplicações, incluindo `/library` e `/library/[id]`.
- Suíte API/worker: **151 passaram, 0 falhas**, incluindo 10 testes de Biblioteca.
- Suíte web: **18 passaram, 0 falhas**, incluindo 3 testes de Biblioteca.
- `git diff --check`: sem erro de whitespace; apenas avisos de normalização CRLF.
- Log de suíte: `apps/api/.data/library-api-tests.log`.

O teste de UI interativa permanece limitado pela ferramenta. Exclusão inteira é
segura por preflight/leases, mas não uma transação de árvore com rollback: se um
unlink falhar, o servidor reporta DELETE_PARTIAL e bytes efetivamente liberados.
Não há banco, fila, autenticação, limpeza por idade nem remoção isolada do original.

## Retry real concluído

O projeto real terminou **89/89 cortes**, lote
`68353639-3976-4210-bcee-2715e7859a5c`, em **750,542 s (12 min 30,542 s)**.
ASR e portfolio já existentes foram reutilizados. A seleção continua a mesma;
nenhum dado real foi excluído e a quota permanece 4 GiB.

Evidência completa:
`apps/api/.data/library-validation/retry-real-2026-10-10T01-17-29.553Z/result.json`.
Os três originais presentes mantêm os hashes do inventário inicial; os 11 cortes
antigos e os 89 novos tiveram checksum confirmado. O web serviu um range de
1.024 bytes com 206. No upload restam apenas metadata, portfolio, estado do job,
transcript e MP4; `.work` está vazio e não há `.part` abandonado.

Depois de reiniciar a API, GET recuperou os 89 cortes persistidos e POST retry
retornou **`reused: true`**, no mesmo batch, sem transcrição/análise/render novos.
A seleção exata também é mantida quando o cache é reutilizado.

| Medida final após cache | Bytes | Aproximado |
| --- | ---: | ---: |
| Originais | 385.801.008 | 367,93 MiB |
| Transcrições/metadados/análises/estado | 4.036.401 | 3,85 MiB |
| Outputs/manifestos | 2.482.022.473 | 2,31 GiB |
| Temporários | 0 | 0 |
| Total | 2.871.859.882 | 2,67 GiB |
| Projetos | 4 | 100 cortes no total |

Após os ajustes finais, typecheck passou novamente; build das três aplicações
passou, API recompilou com o ajuste de cache e os 20 testes relacionados a
Biblioteca/render/edição passaram. A fixture final também verifica que modificar
os bytes de um corte bloqueia aquele player, preservando o acesso ao outro.
O problema OUTPUT_QUOTA foi resolvido neste cenário real; a quota continua
rejeitando escrita que realmente exceda os limites lógicos/físicos.

Inventário final após carregar o último build web:
`apps/api/.data/library-validation/real-2026-10-10T01-36-30.247Z/result.json`.
Confirma 4 projetos, hashes dos 100 MP4s, ranges 206 de todos, páginas 200 e uso
estável. Serviços ativos: web em 127.0.0.1:3000 e API em 127.0.0.1:3001 (`/health` 200).
Nenhum processo nativo gerenciado ficou executando após a conclusão.
