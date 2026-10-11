# Validação dos Social Clip Packages — 10/10/2026

Implementação e planos: [social-clip-packages.md](social-clip-packages.md).

Fonte real já salva: `ac0RGoBVzhs`, “Ensinei o Primo Rico a Fazer PERMUTA de Verdade”, 1778,45 s, 1280×720. SHA-256 da fonte: `b8ddd55425e01c1c28ea0f12cd1d759189e524faf8c28380854bc17f79d0b195`.

Foram reutilizados os timestamps, candidatos e transcrição existentes. O teste usa uma cópia isolada via serviço de upload, sem nova ingestão, ASR ou alteração dos projetos salvos. Os cinco trechos pertencem a famílias diferentes. PODCAST e os demais estilos foram solicitados editorialmente no teste; não há classificação visual de gênero/emoção.

## Renders finais

| Clip | Perfil | Estilo | Template | Duração final | Capa | Render do vídeo |
|---|---|---|---|---:|---:|---:|
| `c_47741063aa2cfaf1` | MICRO | DYNAMIC | HEADLINE_TOP | 14,85 s | 77,7 KiB | 7,4 s |
| `c_bc88bad2ddce844b` | SHORT | PODCAST | CLEAN_PODCAST | 39,03 s | 130,4 KiB | 15,6 s |
| `c_55016a92ac8d7c67` | STANDARD | EDUCATIONAL | GLASS_FRAME | 59,73 s | 74,6 KiB | 33,4 s |
| `c_d0cd91425fbcc62c` | EXTENDED | EMOTIONAL | BLURRED_BACKGROUND | 106,87 s | 70,9 KiB | 43,5 s |
| `c_7b32350da95e87c1` | SHORT | CLEAN | BLURRED_BACKGROUND | 35,90 s | 121,9 KiB | 14,4 s |

Todos: MP4 1080×1920, H.264/AAC, captions queimadas, duração dentro da tolerância de 0,3 s, SHA-256 validado. Capas: JPG 1080×1920, decode válido, fonte/estimativa de largura/área segura validadas, abaixo de 1 MiB. JSON: checksum do payload e do arquivo validados. Um vídeo/capa por pacote, com três perfis e metadata por plataforma.

A execução final levou 143,18 s depois dos planos prontos, incluindo capas, validação e GETs. Outputs: 134.469.554 bytes. `.work` vazio e `temporaryBytes = 0` ao concluir. Cada arquivo tem bytes/checksum/timestamp registrado no resultado.

## Artefatos para revisão

Pasta: `apps/api/.data/social-package-validation/2026-10-10T14-00-56.380Z/`.

- [QA visual: capas, frames originais, vídeos, títulos e razões](../apps/api/.data/social-package-validation/2026-10-10T14-00-56.380Z/qa.html).
- [Resultado completo: bytes, hashes, tempos e ranking](../apps/api/.data/social-package-validation/2026-10-10T14-00-56.380Z/result.json).
- [GETs, downloads e serviços locais](../apps/api/.data/social-package-validation/2026-10-10T14-00-56.380Z/api-checks.json).
- Outputs: `outputs/c1a48c7c-d5dd-49bf-be14-d45b6a426567/aa0d379d-00a3-4981-adc8-93d1d40f1372/`: cinco MP4, cinco capas, cinco frames de referência, cinco JSON e um manifesto.
- Snapshots para revisar captions: `qa-video-c_<id>.jpg`, cinco arquivos na pasta de QA.

As cinco capas e os cinco snapshots de vídeo foram inspecionados visualmente. O ajuste final usa uma cláusula curta para evitar headlines truncadas; zooms têm margem reservada na área da imagem principal. A revisão não incluiu reprodução interativa completa no navegador nem publicação em plataformas.

## Checks executados

- Suíte completa API/worker: **166/166** passaram.
- Web: **23/23** passaram.
- Testes incluem timeline/captions/zoom/ducking reais, recuperação e reuso, timeout/cancelamento, quota, descarte de temporários, checksum, rollback multiasset, traversal/symlink, exclusão de sidecars e cache sem extração duplicada.
- `pnpm.cmd typecheck`: passou nas três aplicações.
- `pnpm.cmd build`: passou nas três aplicações.
- Fastify inject: saúde 200, vídeos 206 por Range, capas/metadata 200 para os cinco pacotes. Uma verificação adicional confirmou Biblioteca com cinco cards e os 15 downloads de capa/frame/metadata em 200 com attachment.
- Serviços locais: API `/health` 200; web `/library`, `/upload` e `/api/projects` 200; dez assets JS/CSS do build 200 após reinício da instância web previamente autorizada.
- `git diff --check`: sem erros de whitespace.

Nenhuma dependência foi instalada/atualizada. `app/`, backups, ingestão por YouTube, ASR e decisões do ClipPortfolio foram preservados nesta etapa. Lotes antigos continuam aceitos sem exigir capa ou JSON novos.

## Arquivos da implementação

Novos módulos API:

- `visual-composition/{types,planner,validation,filter-graph,overlays-ass}.ts`;
- `thumbnails/{types,headline,frame-ranking,frame-cache,planner,image-validation,renderer}.ts`;
- `social-packages/{types,platform-profiles,generate-package,validation,serve-artifact,future-providers}.ts`.

Integrações API:

- `editing/planning/prepare-render-plans.ts` e `editing/rendering/{render-plan,ffmpeg-plan}.ts`;
- `clip-rendering/types.ts`, `services/{render-clips,clip-storage,render-commands,output-usage}.ts`;
- `processing/routes/processing-routes.ts`;
- `library/services/{library-service,library-files}.ts`.

Web:

- novos `social-packages/{types,parse-package,package-preview}.ts/tsx` e CSS;
- cards/parsers/tipos em `library/` e `processing/`.

Validação:

- `apps/api/tests/social-packages.test.mjs`, `apps/web/tests/social-packages.test.ts`;
- ajustes nas fixtures de `clip-rendering.test.mjs` e `library.test.mjs` para os sidecars e reserva de quota;
- `scripts/social-packages/{validate-real,inspect-frames,verify-api}.mjs`;
- os dois documentos desta entrega.

## Limites e próximo passo

Ranking visual usa sinais baratos, sem reconhecimento de rosto/expressão. Headline/descrição dependem da análise textual já existente. As margens são presets internos conservadores e precisam de revisão na plataforma real. MEDIA_STACK é um contrato conceitual e sua ativação é recusada até haver provider de asset auxiliar aprovado. FOCUS_DETAIL e HEADLINE_CENTER exigem informação visual explícita e não são escolhidos pelo provider atual.

Há interfaces futuras para imagem/vídeo/avatar/voz, sem implementações. Não há editor manual, ZIP nem publicação automática. Próximo passo recomendado: revisão humana de frame/headline/template e regeneração versionada do pacote, mantendo as mesmas validações e commit atômico.
