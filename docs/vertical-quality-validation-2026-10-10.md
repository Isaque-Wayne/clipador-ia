# Correção de enquadramento e seleção final — 10/10/2026

Resultado: perfil social validado em 1080×1920; imagem separada das margens de
texto; limite padrão de 20; quality gate igual em todos os modos. A fonte real
produziu 18 clips elegíveis, sem preencher as duas vagas restantes.

## 1. Por que os clips anteriores pareciam deitados

FFprobe nos cinco MP4s da última validação confirmou **1080×1920, H.264/AAC**.
Não foi encontrada saída horizontal nesses cinco arquivos. A imagem horizontal
estava reduzida dentro do canvas vertical: cerca de 68% da largura, região de
27% da altura, com mais redução para reservar zoom. Headline/moldura e blur
dominavam a tela. O player da biblioteca também impunha altura fixa de 320 px.

## 2. Regras que permitiam o problema

O planner aplicava `COMMON_SAFE_AREA` à imagem inteira e o filtro sempre usava
`force_original_aspect_ratio=decrease` numa caixa pequena. Estilos DYNAMIC,
EDUCATIONAL e PODCAST ativavam layouts decorativos automaticamente. A validação
genérica admitia square/landscape conforme o plano, sem uma defesa obrigatória
na entrada social. Não se atribui a esses perfis um arquivo horizontal que não
foi observado. No modo maximum, a seleção devolvia todo o pool acima de score 40;
auto/many também tinham orçamentos por duração sem teto de 20.

## 3. Como o renderer garante 9:16

`safe-vertical-frame.ts` calcula crop proporcional e região central/importante.
FULL_VERTICAL ocupa todo o canvas. Usa crop central quando conserva ≥60% da fonte,
ou quando uma região explicitamente informada cabe inteiramente no crop. Se um
crop severo não tem essa evidência, preserva o quadro inteiro, grande e centralizado,
sobre blur levemente escurecido. A imagem não usa as margens de texto.

O renderer recusa planos square/landscape antes de adquirir recursos. Após FFmpeg,
FFprobe precisa confirmar 1080×1920, DAR 9:16, vídeo H.264, áudio AAC e duração
do plano com tolerância de 0,3 s. Falha impede rename/publicação como concluído.
Filtros preservam proporção e normalizam pixels quadrados, sem stretch.

## 4–8. Candidatos, quality gate, seleção e duplicados

Fonte horizontal real: YouTube `ac0RGoBVzhs`, previamente baixada; 1280×720,
1778,356780 s, H.264/AAC. Nenhum novo download ou ASR foi executado.
SHA-256 da fonte, preservado após cópia pelo serviço existente:
`40b7f26ebc8850eb9cf80271439f0f3d5c9368105206bed1892d2860224557ee`.

| Etapa | Quantidade |
|---|---:|
| Janelas analisadas | 1.173 |
| Rejeitadas na triagem inicial | 178 |
| Duplicadas na descoberta por perfil | 601 |
| Pool preservado para avaliação final | 394 |
| Passaram o quality gate final | 51 |
| Duplicadas removidas depois do gate | 33 |
| Clips no lote final | **18** |

Total de decisões de duplicidade: 634, em etapas distintas. O audit registra
IDs, métricas, `renderEligible`, decisão e motivos. O manifesto guarda o resumo;
cada clip e seu pacote guardam `finalQuality`. O web e a biblioteca usam o score
final quando disponível, preservando o score dos clips históricos.

| Perfil | Clips finais | Duração real dos MP4s |
|---|---:|---|
| MICRO | 6 | 12,88–14,53 s |
| SHORT | 2 | 29,91–32,35 s |
| STANDARD | 6 | 60,37–62,18 s |
| EXTENDED | 4 | 104,10–106,00 s |

Os alvos por duração são orientação. A seleção não adicionou short fraco/repetido
para atingir a distribuição sugerida. O gate exige score original ≥50, final ≥58,
hook ≥35, clareza ≥75, fechamento ≥70, contexto ≤0,25, repetição ≤0,5 e valor
informativo ≥0,5, além de rejeitar abertura fragmentária e final incompleto.

O ranking pesa hook, clareza, fechamento, retenção, valor, emoção e independência
de contexto; penaliza abertura morta, contexto ausente, repetição e final fraco.
Diversidade considera assunto, posição temporal, emoção, hook e duração.
Variações 42/45/48 s são suprimidas; no máximo micro + desenvolvimento realmente
distinto do mesmo momento. Empates usam conteúdo/bordas antes do UUID.

`MAX_FINAL_CLIPS=20` é o padrão, configurável entre 1 e 100. O piso não diminui no
modo maximum. Seleção manual e chamada direta do renderer também respeitam o
limite/gate. O limite vale para o lote final de um processamento; lotes históricos
não são apagados automaticamente.

## 9. Resolução e integridade reais

Os quatro pilotos definitivos — 14,40 s, 32,35 s, 60,37 s e 104,10 s — passaram
antes do lote completo. Os 18 MP4s do lote principal foram reinspecionados com
FFprobe: **todos 1080×1920, H.264/AAC**, áudio estéreo 44,1 kHz, duração esperada.
Bytes, SHA-256, tempo de render, captions e planos estão em `result.json`.

Lote principal: `1e1b9504-2d94-4cb7-ba4f-02b67003b8a1`.
Projeto isolado: `7f5fa770-90f1-4c6f-80ac-8ac50c224838`.
Vídeos principais: 500.822.160 bytes. Validação piloto + lote + verificações:
594,14 s; esse tempo não inclui a comparação de áudio e a demonstração extra.

GET do lote: 200. Para cada clip: vídeo/range 206, capa 200, metadata 200,
frame de referência 200. Hashes conferidos pelo storage e por leitura direta.
POST manual com 21 IDs: 400. `.work` terminou vazio, com zero bytes temporários.

Comparação de áudio: 1,5 s dentro de uma região contínua da timeline em cada um dos
18 clips, contra o mesmo instante da fonte; correlação mínima **0,99975089**.
É uma verificação por amostragem, não audição integral de todos os arquivos.

## 10. Resultado visual dos templates

- BLURRED_BACKGROUND: utilizado nos 18 clips automáticos da fonte com múltiplos
  participantes. Imagem ocupa toda a largura, centralizada; blur sem headline ou
  moldura no MP4. Frames revisados mostram captions moderadas, abaixo dos rostos.
- FULL_VERTICAL: demonstração adicional no trecho de 1605,15 s, com região central
  indicada manualmente. Ocupa a tela inteira, preserva o participante central e
  deixa captions abaixo de seu rosto. MP4 real validado em 1080×1920; SHA-256
  `f08977e24a8245b50a6386b70fb74e433bd4f6d08290d38960661132c9c8fd45`.
- FOCUS_DETAIL: geometria/evidência cobertas por testes. TOP_BOTTOM/SPLIT continuam
  bloqueados sem conteúdo complementar aprovado. Não foram criados assets para
  variar o layout.

Capas continuam separadas: frame forte, headline curta, JPG vertical e metadata
para as três plataformas. Não herdam o crop do vídeo e não criam três MP4s iguais.
Os quatro pilotos e a demonstração extra são artefatos de QA separados do lote
principal de 18, não candidatos adicionais da seleção final.

## 11. Testes e preservação

- API + worker: **173/173**, suíte completa com `--test-concurrency=1`.
- Web: **24/24**, incluindo score final e rejeição de `renderEligible=false`.
- Typecheck e build do monorepo: passaram nas três aplicações.
- Teste real de edição: palavra ativa, zoom mensurável, silêncio sincronizado,
  ducking de música licenciada, checksum, recovery/reuso e retry de estado antigo.
- Gate: limite em todos os modos, pool escasso sem preenchimento, dedup entre
  durações, diversidade, rejeição de contexto/hook/final/repetição, proteção do
  renderer contra bypass manual e saídas horizontais.
- Health real/API 3001, web 3000, páginas, proxy e JS/CSS: 25 verificações HTTP.
- `git diff --check`: passou; apenas avisos habituais LF/CRLF.

A execução paralela inicial teve uma falha no teste antigo de upload com prazo
de 50 ms. O teste isolado passou e a suíte completa com concorrência controlada
passou. Nenhum código de ingestão foi alterado para acomodá-lo.

Ingestão, downloader, transcrição, armazenamento/checksum, quota, concorrência,
cleanup e biblioteca mantêm os serviços existentes. Mudanças no storage limitam-se
a validar/preservar as novas métricas no manifesto. Estados de versões antigas
refazem seleção no retry; estados atuais retomam IDs/outputs pendentes. Fonte e
ASR permanecem disponíveis, sem reextração de URL assinada.

Arquivos desta correção, agrupados pelo motivo:

| Área / arquivos | Motivo |
|---|---|
| `visual-composition/{safe-vertical-frame,planner,filter-graph,validation,types}.ts` | Geometria central, imagem grande, templates simples e leitura histórica. |
| `editing/planning/prepare-render-plans.ts`, `editing/rendering/ffmpeg-plan.ts` | Plano coerente com o enquadramento e versão de cache nova. |
| `portfolio/services/{final-quality,final-selection,refine-boundaries,portfolio-provider}.ts`, `portfolio/types.ts` | Gate, TOP limitado, dedup/diversidade, bordas seguras, faixas e desempate estável. |
| `clip-rendering/services/{render-clips,validate-social-output,render-commands,clip-storage}.ts`, `clip-rendering/types.ts` | Defesa na entrada, FFprobe obrigatório, cache e persistência das métricas. |
| `processing/services/{processing-service,processing-state}.ts`, `processing/types.ts` | Seleção manual segura e retry de versões antigas. |
| `thumbnails/planner.ts`, `social-packages/{types,generate-package}.ts` | Capa independente e score/quality auditáveis. |
| `library/services/library-service.ts`, web `processing/services/processing-api.ts` | Exibir/ordenar score final sem quebrar históricos. |
| Web `social-packages/{parse-package,package-preview}.tsx/ts`, CSS do pacote e biblioteca | Novos nomes de template e player com proporção vertical. |
| Testes de portfolio, edição, social packages, final quality e web processing | Cobrir as regras corrigidas e regressão. |
| `scripts/social-packages/`, docs de portfolio/social package e este relatório | Evidência reproduzível e comandos coerentes. |

Não houve instalação, atualização de ferramenta, alteração de credenciais,
commit, deploy ou reescrita do pipeline. Alterações anteriores do workspace foram
preservadas.

## 12. Limitações e arquivos de revisão

O gate usa sinais textuais locais e pontuação do ASR. Não comprova compreensão
semântica, ideia completa em todos os casos ou retenção real; pode produzir falsos
positivos/negativos e favorece sinais informativos explícitos. Não há detector de
rosto/active speaker: crop horizontal automático severo continua conservador.
A demonstração de crop não representa rastreamento automático. Margens são presets
internos conservadores e variam em relação à UI real das plataformas.

Os frames foram inspecionados visualmente; HTTP/assets foram verificados. Não foi
realizada uma sessão interativa de navegador nem audição integral dos 18 clips.
Outputs históricos continuam preservados; novos processamentos usam o renderer
`vertical-quality-ffmpeg-1.1.1` e análise `portfolio-local-1.1.1`.

Artefatos na pasta
`apps/api/.data/vertical-quality-validation/2026-10-10T19-10-30.602Z/`:

- `qa.html`: os 18 clips, snapshots com legendas, capas e metadata.
- `review.html`: comparação de enquadramento e demonstração FULL_VERTICAL.
- `result.json`: dimensões reais, bytes, hashes, durações, templates, GET e cleanup.
- `selection-audit.json`: decisões de qualidade/dedup e candidatos selecionados.
- `media-verification.json`: amostragem de áudio e MP4 do crop em tela cheia.
- `pilot.json`: quatro durações antes do lote completo.

Logs finais e HTTP ficam no diretório pai da validação. Todos os testes reais usam
pastas isoladas; não substituíram nem excluíram os projetos da biblioteca principal.
