# Validação dos primeiros cortes — 08/10/2026

Implementação: `local-1.0.1`, render `vertical-ass-1.0.0`.

## Teste real

Source público em português já ingerido no projeto:
`33cc339f-1dda-4e97-b71c-4d7047652618`, duração original **960,689297 s**.
Para limitar processamento, o smoke extraiu por stream copy uma amostra solicitada
de 150 s a partir de 30 s. O arquivo resultante mediu **153,970442 s** por causa
dos limites de keyframe do stream copy; as bordas abaixo são relativas à amostra,
não offsets absolutos do vídeo original. O source foi verificado por SHA-256 antes
e depois e permaneceu intacto.

Comando executado sobre API compilada, sem serviço externo:

```powershell
node scripts/processing/smoke-test.mjs 33cc339f-1dda-4e97-b71c-4d7047652618
```

Transcrição real: pt, 39 segmentos, **372 palavras** com timestamps.
Engine: faster-whisper small multilingual, CPU/int8, execução 38,817935 s,
tempo observado do serviço 38,993999 s, CPU acumulada 150,296875 s,
peak working set 725.721.088 bytes (~692,10 MiB).

Análise: **75 candidatos**, **70 suprimidos por sobreposição**, cinco restantes.
Onze extensões de janela foram rejeitadas por limite de duração; esse número
não representa candidatos completos descartados. Scores dos cinco restantes:
66,84; 63,88; 58,79; 58,04; 53,40. A seleção automática manteve dois trechos
sem sobreposição; os demais conflitaram com os selecionados.

| Corte | Start | End | Duração MP4 | Score | Render | Bytes | Cues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `c_133740894c8ec2b5` | 77,74 s | 137,50 s | 59,768133 s | 66,84 | 5,094697 s | 15.177.904 | 38 |
| `c_369e4afa85d7203b` | 7,14 s | 67,88 s | 60,768157 s | 63,88 | 5,164739 s | 14.927.568 | 35 |

Ambos: MP4 real, **1080×1920**, vídeo **H.264**, áudio **AAC**, composição
proporcional com padding, áudio presente, legenda ASS queimada. FFprobe validou
resolução, streams e duração; SHA-256 conferido; GET de arquivo com Range retornou
206 e 64 bytes. Os frames extraídos dos MP4 finais foram inspecionados visualmente:
texto branco grande, contorno preto e afastamento das bordas/base.

Checksums:

- Corte 1: `7a0f3a23d186b42e1ddbdc0da313d64075ce42565c15833a0e943005cba12653`
- Corte 2: `f10a1e21e7e9d204699e264e2dc94099462b363c17047540ce31f23c1a97d108`

Tempo total do smoke após a extração da amostra: **51,953538 s**. O tempo de
render inclui FFmpeg, inspeção e checksum. Os valores refletem esta máquina e
esta amostra, não uma promessa de performance para vídeos longos ou outros PCs.

## Artefatos locais

Raiz: `apps/api/.data/processing-smoke/2026-10-08T18-10-13-205Z/`.
Upload de teste: `1f5397b6-c4a3-4654-916f-1f7cb07ee477`.
Lote: `549e8986-0232-49ea-85ac-12e9968b054f`.

- `result.json`: todas as métricas, candidatos/scores, metadados FFprobe,
  checksums, caminhos, cues e confirmações.
- `uploads/<uploadId>/`: somente metadata.json, video.mp4, transcript.json,
  analysis.json; nenhum `.part`/WAV abandonado.
- `clips/<uploadId>/<batchId>/`: dois MP4 finais e manifest.json.
- `.work/`: vazio ao concluir.
- `<candidateId>-preview.png`: frames com legendas extraídos dos MP4.

Esses dados são de teste e estão ignorados pelo Git; não foram misturados com o
armazenamento do servidor de uso normal. Rotas foram exercitadas com Fastify.inject
na mesma implementação do backend. Depois de fechar e recriar a instância, GET
dos cortes retornou os mesmos dados e POST de processamento/análise reutilizou
os resultados, sem nova chamada da engine. Não foi simulado corte de energia.

## Verificações finais

- `pnpm.cmd typecheck`: passou para web, API e worker.
- `pnpm.cmd build`: passou para web, API e worker.
- `node --test --test-concurrency=1 apps/api/tests/*.test.mjs apps/worker/tests/*.test.mjs apps/web/tests/*.test.ts`:
  **127 testes passaram**, zero falhas, zero skipped, ~19,87 s.
- Log completo: `apps/api/.data/processing-validation-final.log`.
- `/health` na API local: ok; `/upload` no web atualizado: HTTP 200.
- Consulta de status via rewrite do Next em `/api/uploads/:id/process/status`:
  HTTP 200, stage not-started para o source original não processado.
- Web em 127.0.0.1:3000; API em 127.0.0.1:3001.
- `git diff --check`: passou. yt-dlp, video-preparation, config de ingestão,
  manifests de dependências e lockfile não foram alterados nesta fase.

Não foi executado teste visual interativo dos novos cards no navegador. Os cards
foram compilados/typechecked; parsing e distinção de erros do cliente foram
testados, e os frames dos vídeos finais foram vistos. Os testes existentes de
ingestão foram preservados e passaram; este smoke partiu de source já ingerido,
sem repetir download externo do YouTube.

## Limites e continuidade

Scoring é lexical e determinístico: pode selecionar fala promocional, referências
dependentes ou raciocínio cuja conclusão o ASR pontuou incorretamente. Requer
revisão humana antes de publicar. Sem face tracking e sem destaque animado da
palavra; padding mantém todo o quadro horizontal. Outputs têm quota de 4 GiB e
não são apagados automaticamente. A interface inicia até três cortes por vídeo,
com um trabalho pesado por vez.

Não surgiu bloqueio de serviço/chave/dependência para este MVP. Um próximo avanço
de compreensão semântica pode usar outro AnalysisProvider mediante escolha e
autorização explícita do serviço e credencial. Nenhuma autorização adicional foi
necessária para a implementação local concluída.
