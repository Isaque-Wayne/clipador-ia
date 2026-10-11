# Diagnóstico do HTTP 403 — 2026-10-10

## Conclusão e condição de parada

A tentativa `8aa1a94f-943a-4f1b-a47e-a2ce1cfb6a7c` obteve metadata e falhou em `downloading-video`, com **zero bytes recebidos**. A API estava saudável na porta 3001; web na porta 3000.

O caminho ativo continua **yt-dlp → stdout → Node → storage**. Faixas separadas continuam em temporários controlados, remux FFmpeg `-c copy`, FFprobe e publicação pelo storage existente. A factory ativa não chama o helper legado `download-media.ts`. Não houve regressão para HTTPS do Node sobre URL assinada. O diff anterior da feature mudava somente a propagação do erro de quota.

O 403 comprova uma recusa do provedor; sua razão interna **não foi determinada**. O mesmo vídeo e os mesmos formatos passaram depois, inclusive antes de alterar código. Isso demonstra intermitência nas observações, sem comprovar bloqueio permanente de formato.

Na última validação pelo web, a tentativa **`3dc31999-99a3-4d18-b559-bc035badadfd`** trouxe aviso explícito pedindo login para confirmar que não é bot e **zero formatos**. As tentativas foram interrompidas nesse ponto, conforme pedido do usuário. Nenhum cookie, login, conta, PO Token, atualização de ferramenta ou troca de cliente foi aplicado. Esse aviso posterior não comprova retroativamente a causa do 403 original. A ingestão real não está garantida enquanto esse bloqueio persistir.

## Evidência recuperada

- Vídeo: <https://www.youtube.com/watch?v=ac0RGoBVzhs>.
- Metadata original: “Ensinei o Primo Rico a Fazer PERMUTA de Verdade”, duração 1778 s, thumbnail canônica.
- Original: `2026-10-10T01:42:34.943Z` a `01:42:42.530Z` — 7,587 s; estimativa 190.166.495 bytes; recebidos 0; faixa de vídeo.
- Registro original preservado antes das alterações: `apps/api/.data/youtube-diagnostics/2026-10-10T01-49-46-838Z-403/original-attempt.json`.
- A implementação anterior não guardava lista completa de formatos, argumentos e stderr por ID. A recuperação do stdout acumulado da sessão foi truncada pelo limite da ferramenta. **O stderr e a lista exata desse ID não foram recuperados.** A consulta nova é identificada como nova, sem fingir recuperação histórica.
- Consulta nova sem baixar mídia: extractor `youtube`/`Youtube`, cliente `visionos`, disponibilidade pública, 53 formatos; sem progressivo HTTPS compatível. Havia faixas HTTPS, HLS e storyboards.
- Seleção nessa consulta: vídeo **136**, MP4/H.264 `avc1.4D401F`, 720p, 161.385.457 bytes; áudio **140**, M4A/AAC `mp4a.40.2`, 28.781.038 bytes. Soma igual à estimativa original. É uma reconstituição sustentada pelos dados, não uma substituição do stderr ausente.
- Lista completa, stderr sanitizado da consulta e argumentos estão em `fresh-format-query.json`, no mesmo diretório.
- Argumentos: configs/plugins/componentes remotos/cache desabilitados, Node como runtime JS, extractor YouTube, proxy vazio, socket timeout 15 s, retries 1; transferência com `--format <ID extraído>[protocol=https] --output - --no-progress --no-part --no-continue --fixup never -- <URL canônica>`. IDs não foram fixados no código.

Foi localizada também a tentativa posterior **`b4968fbb-b36e-4cb4-9bc1-3d350d2c3e03`**: vídeo 136 terminou com 161.385.457 bytes e o **áudio 140** falhou. Seu stderr relevante foi preservado em `available-api-stderr.json`:

```text
[youtube] ac0RGoBVzhs: Downloading visionos player API JSON
[info] ac0RGoBVzhs: Downloading 1 format(s): 140
ERROR: unable to download video data: HTTP Error 403: Forbidden
```

A expressão “video data” não identifica o tipo de faixa; o formato 140 e a etapa do registro comprovam que era áudio.

`yt-dlp.exe --version` retornou **2026.08.19**, igual ao manifesto local verificado e à release estável retornada pela API oficial: <https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19>. Não havia atualização estável disponível a aplicar. Não foi atualizada ferramenta alguma.

A consulta inicial mostrou “PO Token Providers: none”, sem erro de token obrigatório. Isso não prova necessidade de token. Os smoke tests passaram sem autenticação/token. A tentativa final demonstrou solicitação de autenticação, **sem evidência de PO Token necessário**.

## Correções locais e arquivos

Havia lacunas de diagnóstico, erros e retry; não foi encontrado bug que tivesse regredido o downloader para Node HTTPS.

Todos os caminhos API abaixo são relativos a `apps/api/src/features/youtube-ingestion/`:

| Arquivos | Motivo |
| --- | --- |
| `utils/select-input.ts` | Mantém o candidato preferido e deriva no máximo uma alternativa compatível por faixa. |
| `services/download-track.ts` (novo) | No máximo duas tentativas por faixa, somente após 403 confirmado; fecha/descarta parcial antes da alternativa e mantém um prazo compartilhado. Quota, cancelamento, auth, token e rate limit não disparam fallback. |
| `services/merge-video.ts` | Integra o helper e registra tentativas, mantendo remux/validação/cleanup. Progressivo conserva o caminho aprovado, sem fallback novo. |
| `types/diagnostic.ts` (novo), `types/ingestion.ts`, `services/youtube-downloader.ts`, `services/ingest-youtube.ts` | Guardam diagnóstico sanitizado no ID em memória: até 16 eventos, 100 formatos e 16 KiB de stderr por evento. Guardam a URL canônica desde o início para retry de falhas de metadata. |
| `utils/downloader-error.ts`, `routes/ingestion-routes.ts` | Propagam códigos distintos para 403, formato explicitamente bloqueado/indisponível, auth, token obrigatório, privado/restrito, rate limit e falha genérica, sem inferir token/login de um 403 isolado. |

Outros arquivos deste pedido:

| Arquivos | Motivo |
| --- | --- |
| `apps/web/src/features/youtube-ingestion/{components/youtube-ingestion-form.tsx,hooks/use-youtube-ingestion.ts,services/ingest-youtube.ts,types/ingestion.ts}` | Botão “Tentar novamente”, novo job com extração nova, URL canônica preservada no estado mesmo após reinício da API. Erro JSON do backend não vira API offline apenas por HTTP 502. |
| `apps/api/tests/youtube-recovery.test.mjs` (novo), `apps/api/tests/youtube-formats.test.mjs`, `apps/web/tests/youtube-ingestion.test.ts` | Testes de parcial descartado, limite, prazo, cancelamento/quota/auth/token, classificação, novo ID e nova extração. |
| `scripts/youtube-ingestion/diagnose-403.mjs` (novo), `scripts/youtube-ingestion/validate-web-retry.ts` (novo) | Consulta sem mídia e validação da função de retry pelo proxy real, com evidência sanitizada. |
| Este relatório | Diagnóstico, arquivos, resultados e limites. |

Os diagnósticos de falhas continuam transitórios: reiniciar a API perde os IDs em memória. Os artefatos desta investigação foram salvos separadamente. Não foi introduzida persistência nova para falhas nem alterada a política de storage.

## Validação

Os dois vídeos passaram antes e depois da correção local, em storage isolado, com o script de smoke existente. Hash independente em disco, metadata, GET de ingestão/upload e recuperação após reinício foram verificados.

| Rodada após correção | Novo ID | Bytes finais | Tempo total | Formatos |
| --- | --- | ---: | ---: | --- |
| Mesmo vídeo `ac0RGoBVzhs` | `695479d3-aac9-4676-ab20-22cb382d7bec` | 189.990.616 | 16,107 s | 136 + 140 |
| Controle `4948LkibJpw` | `64d3b8c7-2d1a-453e-a011-1df07d2b8abc` | 39.090.256 | 11,848 s | 136 + 140 |

- SHA-256 do mesmo vídeo: `40b7f26ebc8850eb9cf80271439f0f3d5c9368105206bed1892d2860224557ee`, igual às validações anteriores.
- SHA-256 do controle: `0e3e6adf617dafc38fa08cd4e810398d917533fbf36b8b30deaaad3510cc1ebd`, também igual antes/depois.
- Evidência antes: `apps/api/.data/youtube-smoke/2026-10-10T01-50-11-342Z/<videoId>/result.json`.
- Evidência depois: `apps/api/.data/youtube-smoke/2026-10-10T01-58-53-137Z/<videoId>/result.json`.
- Diretórios dos smoke tests: somente metadata e vídeo final; sem faixas/parciais abandonados. Pasta da tentativa original vazia; a final falhou antes de criar pasta de upload.
- **Fallback não foi necessário nos smoke tests reais.** Recuperação após 403 foi validada em testes com falha controlada e bytes parciais. Não se afirma que resolveu um 403 real nessa rodada.
- Retry pelo proxy: POST **202**, novo ID, polling GET **200**, mensagem de backend preservada. Porém, a extração final pediu autenticação e não transferiu mídia; não houve checksum/storage final para essa tentativa. Evidência: `apps/api/.data/youtube-diagnostics/2026-10-10T03-03-48-421Z-proxy-retry/{result,backend-attempt}.json`.
- Suíte API/worker: **158/158** passaram, log `apps/api/.data/youtube-403-api-tests.log`. Após a classificação final de formato bloqueado, **25 relacionados** reexecutados passaram.
- Suíte web: **21/21** passaram; **11 relacionados** reexecutados após o ajuste final do retry passaram.
- `pnpm.cmd typecheck` e `pnpm.cmd build`: passaram nos três apps.
- Retry validado pela função consumida pelo botão e proxy HTTP real; não houve clique automatizado no navegador.

Limitação pendente: `--ignore-no-formats-error` permite exit zero com autenticação solicitada em WARNING. Na tentativa final, a interface ainda recebeu “Não há progressivo nem par de faixas H.264/AAC compatível…”, enquanto o diagnóstico por ID conserva o aviso de login. **A implementação foi interrompida antes de tratar esse novo caso**, respeitando a condição de parada do usuário.

Não houve alteração nova em transcrição, ClipPortfolio, render, captions, FFmpeg/FFprobe, checksum, quota, concorrência ou implementação do storage. Mudanças anteriores foram preservadas e nenhum dado real foi excluído. Web atualizado e API ficaram ativos nas portas 3000 e 3001; `/health` final retornou 200/ok.
