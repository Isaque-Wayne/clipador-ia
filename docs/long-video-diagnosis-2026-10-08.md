# Diagnóstico antes das alterações

Web e API responderam em 127.0.0.1:3000 e 3001. `/health`: 200.

O vídeo YouTube `ac0RGoBVzhs`, upload `a97d4726-ba58-4b64-8f91-c045742cb99e`, tem 1778,35678 segundos (29min38s). A ingestão e a inspeção já estavam concluídas. O GET de transcrição retornou:

```json
{"stage":"failed","startedAt":"2026-10-08T23:37:38.721Z","finishedAt":"2026-10-08T23:42:38.765Z","error":{"code":"TIMEOUT","message":"Tempo máximo da transcrição excedido."}}
```

Falha após **300,044 s**, também propagada ao processamento original. O portfolio ainda não havia começado. A mensagem real era “transcrição”, não “transmissão”.

| Etapa | Limite anterior | Origem | Relação com esta falha |
|---|---:|---|---|
| POST YouTube no proxy Next | 120 s | `apps/web/src/app/api/ingestions/youtube/route.ts` | Ingestão já concluída; não causou esta falha |
| Requests de status/start/result | 15 s | `apps/web/src/features/processing/services/processing-api.ts` | Requests curtas; independentes do job existente |
| Ingestão/storage/metadata/download/merge | 90 s compartilhados | `uploads/config/storage-policy.ts`, `services/receive-video.ts` | Fragilidade adicional, não a causa observada |
| yt-dlp socket | 15 s inativo, 1 retry | `youtube-ingestion/services/downloader-command.ts` | Não era orçamento total; preservado |
| FFprobe e FFmpeg de preparação/merge | Sem limite próprio | `youtube-ingestion/services/ffmpeg-runner.ts` | Dependiam do limite externo |
| Preparação + callback Whisper/análise/render | 300 s | `video-preparation/config/preparation-policy.ts`, `uploads/services/receive-video.ts` | Outro teto de 5 min que também impediria transcrição longa |
| Job de transcrição (incluía preparação) | 300 s | `transcription/services/transcription-service.ts` | **Mensagem exata observada, timer criado antes da preparação** |
| Python/faster-whisper | 300 s | `transcription/services/faster-whisper-engine.ts` → `python-runner.ts` | Terceiro teto de 5 min; inicia após preparação |
| Análise | Preparação externa de 300 s | `analysis/services/analysis-service.ts` | Não alcançada |
| Render | 120 s/corte + preparação 300 s/corte | `processing/services/processing-service.ts`, `clip-rendering/services/render-clips.ts` | Não alcançado; sem orçamento próprio de lote |

O job de transcrição começa antes do timer de preparação e antes do processo Python. Sua mensagem e os timestamps identificam o timer que disparou nesta tentativa. Não houve necessidade de adivinhar nem de reproduzir uma falha de cinco minutos que já estava disponível na API.

Benchmark prévio: 153,970442 s de vídeo, 38,9939992 s de transcrição, Python pico 725721088 bytes (~692 MiB). Projeção linear: 30 min ~7,6 min; 60 min ~15,2 min. Conteúdo, VAD, temperatura/carga e hardware alteram esse fator; não é garantia.

Alteração autorizada pelo pedido: configurar prazos independentes, delimitar a preparação sem incluir Whisper, reutilizar os jobs de transcrição/processamento e adicionar job de ingestão com polling. Manter limite de arquivo 4 GiB, storage 16 GiB e outputs 4 GiB, modelo, faixas progressivas/separadas, checksum, quotas, captions e presets.
