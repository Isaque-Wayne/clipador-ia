# Transcrição real e preparação para análise

Estado validado em **08/10/2026**: upload existente → integridade SHA-256 →
inspeção → WAV PCM mono 16 kHz → faster-whisper local → normalização → JSON
persistido → consulta/reuso após recriar a API → cleanup do áudio temporário.

A instalação está em [tools/transcription](../tools/transcription/README.md),
com modelo `small` multilíngue, CPU/int8 e downloads desabilitados no runtime.

## Rotas da API

| Método | Rota | Comportamento |
| --- | --- | --- |
| POST | `/uploads/:id/transcription` | 202 para novo trabalho; 200 e `reused: true` se já concluído e íntegro |
| GET | `/uploads/:id/transcription/status` | Etapa real, horários e erro discriminado quando houver |
| GET | `/uploads/:id/transcription` | Contrato normalizado concluído; 409 enquanto não concluído |
| DELETE | `/uploads/:id/transcription` | Cancela o trabalho em andamento e aguarda cleanup |

Os endpoints recebem apenas UUID de upload, nunca caminhos. Respostas usam
`Cache-Control: no-store`. Upload inexistente/expirado retorna 404; pedido
duplicado em andamento retorna 409; engine ocupada retorna 429. Os códigos de
falha distinguem `ENGINE_UNAVAILABLE`, `ENGINE_FAILED`, `TIMEOUT`, `CANCELLED`,
`INVALID_RESULT` e falha de preparação. Falhas assíncronas aparecem no GET de
status; não são confundidas com resultado concluído. stderr da engine é
registrado no logger da API, sem expor caminhos internos na resposta pública.

```powershell
$uploadId = 'UUID-DO-UPLOAD'
Invoke-RestMethod -Method Post "http://127.0.0.1:3001/uploads/$uploadId/transcription"
Invoke-RestMethod "http://127.0.0.1:3001/uploads/$uploadId/transcription/status"
Invoke-RestMethod "http://127.0.0.1:3001/uploads/$uploadId/transcription"
# Se necessário, para uma transcrição ainda em andamento:
Invoke-RestMethod -Method Delete "http://127.0.0.1:3001/uploads/$uploadId/transcription"
```

Não há acionamento automático após upload, botão de transcrição no web nem
worker/fila nesta fase. As novas rotas já foram consultadas na API ativa em 3001;
`/health` respondeu `ok` e o upload original respondeu `not-started`, sem iniciar
processamento do vídeo longo.

## Contrato, persistência e proteção

`Transcript` contém `language`, `languageProbability`, `duration`, `text` e
`segments`. Cada segmento tem ID, início, fim, texto e palavras com `word`,
`start`, `end`, `probability`. Confiança ausente permanece `null`. Normalização
não inventa tempos: valida finitude, limites, ordenação, IDs e probabilidades,
normaliza espaços e compõe o texto dos segmentos. Textos com substituição de
codificação inválida são rejeitados. Uma transcrição sem fala pode ser vazia.

O processo Python tem stdout limitado a 16 MiB, stderr limitado à cauda de
16 KiB e timeout de 60 min configurável por `TRANSCRIPTION_TIMEOUT_MS`, aplicado
somente ao Whisper. Preparação tem 20 min e termina antes da transcrição. O stderr
também transporta contagem real de segmentos, sem percentual estimado. Cancelamento
encerra a árvore Python no Windows. Não há comando construído por concatenação nem
shell. A engine é uma responsabilidade separada da orquestração e das routes.

O artefato é `uploads/UUID/transcript.json`, junto do vídeo e de `metadata.json`.
Inclui versão de schema, identidade da engine, checksum do vídeo, status e
SHA-256 do JSON normalizado. Só uma saída válida é publicada, com parcial criado
por `wx`, sync, publicação sem sobrescrita e remoção do parcial. Não se sobrescreve
transcrição concluída corrompida: GET/POST informam `INVALID_RESULT`.

A preparação reutiliza o pin, checksum, concorrência e reserva de quota
existentes. A reserva para JSON é conservadora; artefatos de transcrição continuam
contando no scanner mesmo quando o upload está em uso. A limpeza por retenção
reconhece somente os nomes fixos de transcrição, sem remoção recursiva. Um parcial
de transcrição após crash não invalida o vídeo original. Na próxima tentativa,
parciais conhecidos são removidos dentro do diretório UUID protegido, antes de
recriar áudio. Fora de uma tentativa, seguem a retenção normal do upload.

Etapas reais: `preparing-audio`, `transcribing`, `normalizing`, `persisting`,
`completed`, `failed`; `not-started` indica ausência de trabalho/artefato.
Etapas rápidas podem não aparecer em cada polling. Não há porcentagem estimada.
`completed` só fica público depois da liberação/cleanup da preparação.

## Teste real

Fonte: trecho de fala do upload já local `33cc339f-1dda-4e97-b71c-4d7047652618`,
sem download adicional de vídeo. Foi criada fixture por stream copy em storage
isolado, sem renderização de cortes do produto. A solicitação de 20 s resultou
em 23,97 s por alinhamento de keyframes do stream copy. O original foi conferido
por SHA-256 antes e depois e permaneceu intacto.

| Medida | Resultado |
| --- | --- |
| Vídeo de teste | 23,970442 s; 884.513 bytes |
| Áudio WAV | 23,939813 s; 766.152 bytes temporários |
| Idioma | `pt`; probabilidade fornecida pela engine 0,9967806 |
| Segmentos/palavras | 4 / 57 |
| Timestamps | presentes nas 57 palavras, com confiança da engine |
| Transcrição e preparação | 7,3699933 s; aproximadamente 3,25× a duração do áudio |
| Fator de tempo real | 0,308 |
| Engine Python | 6,2866 s de parede; 21,8281 s de CPU somadas entre threads |
| Pico de memória Python | 725.585.920 bytes, aproximadamente 692 MiB de working set |
| Tempo total do smoke | 7,4735 s, incluindo verificações posteriores |
| Cleanup | nenhum `.part`; somente vídeo, metadata e transcrição |
| Recuperação/reuso | GET 200 após recriar API; POST 200 reutilizou sem outra chamada à engine |

Trecho reconhecido: “O jeito que você sonha em ser, você tem que ter ali um
trabalho muito forte aqui mental.” O texto integral, todas as palavras e métricas
estão em `.data/transcription-smoke/2026-10-08T15-01-51-734Z/result.json`; a
transcrição persistida pertence ao upload de teste
`3da80e4c-e176-4fcf-9df6-5b311d2034f5` desse storage isolado.

Smoke test reproduzível, usando um upload local com fala (cria artefatos isolados):

```powershell
pnpm.cmd --filter @clipador-ia/api build
node scripts/transcription/smoke-test.mjs UUID-DO-UPLOAD
```

Os POST/GET do smoke usam Fastify.inject e a engine Python real. Recuperação
foi testada fechando a instância e criando outra sobre o mesmo storage; não foi
necessário reiniciar a API que o usuário está usando. Não é benchmark de vídeo
longo nem medição de acurácia de reconhecimento.

## Validação automatizada

- 115 testes API/worker/web passaram, sem skips, incluindo os 9 novos testes.
- Um teste existente de upload com prazo de 30 ms falhou em uma repetição
  paralela sob carga; passou isoladamente. A conferência final usa
  `--test-concurrency=1`, sem alterar o teste nem o timeout de produção.
- Typecheck e build passaram nos três apps.
- `pip check` passou; versões completas em `requirements.lock.txt`.
- Testes de transcrição cobrem normalização/UTF-8, timestamps, resultado
  inválido, falha de subprocesso, limite de stdout, timeout, cancelamento,
  persistência, corrupção, recuperação, reuso, quota, cleanup, shutdown e rotas.
- Regressão de ingestão preserva progressivo, faixas separadas, remux, metadata,
  storage, checksum, quota, concorrência e recuperação.

## Arquivos desta fase

Criados:

- `apps/api/src/features/transcription/types/status.ts`.
- `apps/api/src/features/transcription/services/python-runner.ts`,
  `faster-whisper-engine.ts`, `transcript-persistence.ts`,
  `transcription-service.ts`, `transcription-error.ts`.
- `apps/api/src/features/transcription/controllers/transcription-controller.ts`.
- `apps/api/src/features/transcription/routes/transcription-routes.ts`.
- `apps/api/src/features/analysis/contracts.ts`, `candidate.ts`, `scoring.ts`.
- `apps/api/tests/transcription.test.mjs`.
- `scripts/transcription/smoke-test.mjs`.
- `tools/transcription/engine.py`, `install-model.py`, `requirements.txt`,
  `requirements.lock.txt`, `installation.json`, `README.md` e manifesto em
  `downloads/windows-3.13.15.json`; runtime/venv/modelo são artefatos locais ignorados.
- `docs/transcription.md`.

Alterados: `transcription/types/transcript.ts`,
`transcription/services/normalize-transcript.ts`,
`uploads/services/scan-upload-storage.ts`, `server/create-server.ts`,
`server/register-routes.ts`, `.gitignore`, README e `docs/video-processing.md`.
Mudanças visuais anteriores do web foram preservadas e não fazem parte desta fase.

## Limitações e próximo passo

Coordenação em um processo, uma transcrição ativa por vez e sem fila durável.
Transcrições concluídas sobrevivem a reinício; trabalhos em andamento e histórico
de falha/cancelamento ficam em memória. Após reinício, um trabalho interrompido
sem artefato concluído aparece `not-started` e requer novo POST. Não há retomada
parcial nem retry automático do trabalho. O web retoma consultas transitórias e
identifica `not-started` após reinício como interrupção. Os antigos três limites
de cinco minutos foram substituídos por [prazos independentes](long-videos.md).

O modelo/alinhamento pode cometer erros, gerar palavras de duração zero ou
confianças baixas. Esses valores reais são preservados, sem inventar timestamps.
Probabilidade de idioma não é taxa de acerto. Desempenho depende do hardware e
da mídia; a medição usa uma única amostra curta com quatro threads.

`AnalysisProvider` já recebe `AnalysisInput` com upload e transcrição e promete
retornar `CutCandidate[]`. Cada candidato liga início/fim aos IDs dos segmentos,
título, motivo e score opcional com dimensões explicáveis. Só os contratos foram
criados: não há provedor de IA, chave, scoring em execução ou renderização.

Próximo passo exato: implementar um provedor local inicial que agrupe segmentos
em candidatos com contexto e duração controlada, valide limites contra a
transcrição e retorne justificativas por candidato. Depois avaliar os candidatos
em fala real antes de conectar um provedor externo ou renderizar cortes.
