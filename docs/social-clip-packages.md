# Social Clip Package

Cada novo clip selecionado produz um MP4, uma capa JPG, um frame de referência e um JSON. A estrutura existente é preservada:

```text
<outputs>/<projectId>/<batchId>/
  c_<id>.mp4
  c_<id>.jpg
  c_<id>.source.jpg
  c_<id>.package.json
  manifest.json
```

O frame de referência é um asset pequeno usado na geração da capa e na revisão. Não há três cópias do vídeo. Lotes históricos sem pacote continuam legíveis; não são migrados ou re-renderizados automaticamente.

## Contratos e responsabilidades

- `social-packages/types.ts`: `SocialClipPackage`, versão, vídeo, thumbnail, frame de referência, metadata, três perfis, EditPlan, VisualCompositionPlan, ThumbnailPlan, título, descrição, estilo, score, duração, assets, checksum do conteúdo do JSON e capacidades futuras.
- `visual-composition/`: escolha determinística do template, validação, filtro de composição e overlays ASS.
- `thumbnails/`: headline, candidatos/ranking de frames, cache temporário, plano, render JPG e validação.
- `social-packages/generate-package.ts`: orquestra a capa e metadata depois da validação do vídeo.
- `clip-rendering/`: mantém render com captions, timeline, música licenciada, gate, deadlines, quotas, publicação e recuperação.
- Web `social-packages/`: preview reutilizado na Biblioteca e no resultado do processamento.

Pipeline: candidato/análise → EditPlan → VisualCompositionPlan → vídeo validado → ranking → ThumbnailPlan → capa validada → JSON → commit do pacote no manifesto. Nenhuma extração de YouTube ou nova transcrição é necessária quando a fonte e análise já estão disponíveis.

Os sidecars têm tamanho e SHA-256 próprios no manifesto. O JSON possui checksum do payload, calculado sem o próprio campo `checksum`; seu arquivo inteiro tem outro SHA-256 no resumo do manifesto. As rotas verificam tamanho/hash e mantém lease enquanto transmitem, impedindo exclusão concorrente.

## Templates

| Template | Propósito / escolha | Regras e limitações |
|---|---|---|
| FULL_VERTICAL | Prioridade para crop seguro | Imagem ocupa todo o canvas 1080×1920. Crop central conserva ≥60% da fonte, ou preserva uma região importante explicitamente informada. |
| BLURRED_BACKGROUND | Crop severo ou região importante não cabe | Fonte inteira grande, centralizada em toda a largura (ou altura para fontes muito estreitas), fundo ampliado/desfocado com escurecimento leve. |
| FOCUS_DETAIL | Detalhe explicitamente identificado | Crop 9:16 contém a região indicada; se ela não cabe, usa blur sem perdê-la. |
| TOP_BOTTOM / SPLIT | Somente conteúdo complementar aprovado | Reservados: o renderer recusa ativação enquanto não houver segundo input aprovado. Não cria assets para variar o layout. |

`safe-vertical-frame.ts` centraliza geometria proporcional e preservação da região
indicada. Sem detector visual, fontes horizontais com crop severo usam blur;
o renderer não presume rosto/falante. As margens de plataforma restringem texto,
nunca a imagem. Estilo editorial não cria headlines/molduras no vídeo. Headlines
permanecem nas capas independentes, sem herdar crop do vídeo. Nomes históricos
FULL_VIDEO, CLEAN_PODCAST, GLASS_FRAME, HEADLINE_TOP/CENTER e MEDIA_STACK permanecem
legíveis em pacotes antigos, mas não são escolhidos nos novos planos.

O perfil social exige 1080×1920 com DAR 9:16, H.264, áudio AAC e duração do plano,
confirmados por FFprobe antes de checksum/publicação. Planos square/landscape são
recusados nesta entrada do renderer; a biblioteca continua lendo arquivos históricos.

## Capas e seleção de frames

Presets: CLEAN (contido), BOLD (hook score alto, contraste e headline maiores), PODCAST (limpo, sem crop facial presumido), EMOTIONAL (menos contraste decorativo), EDUCATIONAL (conceito legível) e DYNAMIC (ênfase moderada). São seis variações da mesma identidade: Arial bold, branco, acento cyan, fundo navy, espaçamento e painéis consistentes.

A headline usa uma cláusula do título/hook/transcript existente, até seis palavras, removendo finais dependentes como “mas” ou “na”. Não inventa promessa, número ou conclusão. Duas a seis palavras são preferidas; quando só há uma palavra disponível, ela é preservada com limitação registrada. Texto sem conteúdo ou que não caiba com fonte mínima é rejeitado.

O ranking considera até sete timestamps: hook inicial, desenvolvimento, payoff/conclusão e até três eventos fortes. Timestamps fora da timeline retida são descartados. Não há frame aleatório. Para cada candidato, amostras grayscale 160×90 medem brilho, desvio/contraste, diferença Laplaciana aproximada (nitidez) e diferença em relação a 120 ms antes (estabilidade). Peso: evidência semântica 40%, nitidez 22%, contraste 16%, brilho 12%, estabilidade 10%. Empates usam o timestamp mais cedo.

O cache temporário usa fonte/projectId + checksum + timestamp em milissegundos + resolução. Promises compartilhadas impedem extração duplicada concorrente. Apenas o frame vencedor é extraído em maior resolução, copiado como referência e usado para a capa. O cache é limpo em `finally`; cleanup do `.work` também reconhece exclusivamente os novos nomes controlados, inclusive após falha/reinício.

JPG: 1080×1920, qualidade FFmpeg `q:v=3`, máximo 1 MiB. Validação: arquivo regular sem symlink, tamanho, marcadores/dimensões JPEG, decode FFmpeg, checksum, fonte mínima 64 px, até três linhas, estimativa conservadora da largura e posição na safe area. Isso não é OCR nem garantia de leitura para qualquer aparelho.

## Plataformas e safe areas

Os três perfis compartilham os arquivos. YouTube recebe title/description e cover candidate; Reels recebe caption/cover com prévia central 4:5; TikTok recebe caption/cover candidate. Export: MP4 H.264/AAC, 1080×1920, 30 fps. A seleção e publicação são manuais.

| Perfil | Esquerda | Direita | Topo | Base | Caption Y |
|---|---:|---:|---:|---:|---:|
| YouTube Shorts | 10% | 18% | 12% | 23% | 69% |
| Instagram Reels | 10% | 18% | 14% | 25% | 68% |
| TikTok | 10% | 22% | 16% | 28% | 68% |
| Interseção usada no arquivo compartilhado | 10% | 22% | 16% | 28% | 68% |

São presets internos conservadores e configuráveis, não especificações oficiais de pixels fixos. Botões, descrição, avatar e controles variam por dispositivo, comprimento da legenda e recursos ativados. A [documentação oficial do TikTok para anúncios](https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads?lang=en) também descreve essa variação; não foi tratada como regra de export orgânico. A [documentação do YouTube](https://support.google.com/youtube/answer/72431?hl=en) descreve capas de Shorts e as condições da conta/Studio. A prévia 4:5 do perfil Reels é uma configuração de revisão, não garantia da grade de todos os dispositivos.

## Blur e glass

O FFmpeg divide o vídeo/frame. A cópia de fundo é ampliada, reduzida para 270×480, desfocada com `gblur`, ampliada para a saída e escurecida. A fonte nítida preserva a proporção em primeiro plano. A redução torna o blur mais barato. O [filtro gblur está documentado pelo FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#gblur).

Overlays tipados: title-bar, label, card, speaker-name, topic, badge e callout. O renderer usa vetores ASS arredondados, preenchimento translúcido e borda suave. O uso automático atual limita-se a title-bar quando o template precisa; speaker-name exige nome real, e os demais ficam preparados para informação contextual futura. Glass aqui é a composição de transparência/borda sobre o fundo desfocado, não blur independente por painel.

## API, UI e export

Rotas GET sob `/uploads/:projectId/clips/:batchId/:clipId/`:

- `file`: MP4, incluindo ranges existentes;
- `thumbnail`: JPG;
- `source-frame`: JPG original selecionado;
- `metadata`: JSON completo.

`?download=1` envia attachment com nome controlado. Rotas inválidas/artefatos ausentes retornam erro; hash divergente bloqueia leitura. O web constrói URLs locais e rejeita destinos externos no resumo.

Os cards mostram tabs Vídeo/Capa, template, estilo da capa, plataformas, duração, perfil e score, motivo/timestamp e links para baixar vídeo/capa/metadata. Um botão único “Baixar pacote” pode consumir o mapa de arquivos; ZIP ainda não foi implementado. `capabilities` registra regeneração, escolha de frame e troca de template como futuras, sem ações falsas na UI.

`GeneratedImageProvider`, `GeneratedVideoProvider`, `AvatarProvider` e `VoiceProvider` são somente interfaces. Nenhum SDK, dependência, serviço pago, stock, avatar ou síntese foi adicionado.

## Validação reproduzível

```powershell
pnpm.cmd --filter @clipador-ia/api build
node scripts/social-packages/validate-real.mjs
pnpm.cmd typecheck
pnpm.cmd build
$tests = @(rg --files apps/api/tests apps/worker/tests -g '*.test.mjs')
node --test --test-concurrency=1 $tests
.\apps\api\node_modules\.bin\tsx.cmd --test apps/web/tests/*.test.ts
```

O script cria uma pasta isolada em `.data/social-package-validation/<timestamp>`, copia a fonte via fluxo de upload existente, reutiliza análise/transcrição, gera cinco trechos de famílias diferentes (MICRO, SHORT/PODCAST, STANDARD/EDUCATIONAL, EXTENDED/EMOTIONAL e SHORT/CLEAN), valida todos os hashes, testa GETs com Fastify inject e escreve `qa.html` + `result.json`. O estilo podcast é solicitado editorialmente; emoção continua sendo sinal lexical, sem reconhecimento facial. É possível fornecer outro diretório de upload com `metadata.json`, `portfolio.json`, `transcript.json` e vídeo como argumento.

Limitações: sem análise semântica nova, detecção de rosto/expressão, OCR, assets auxiliares automáticos, editor manual, ZIP ou publicação. O próximo passo é revisão humana de frame/headline/template usando os planos persistidos, com nova versão de pacote e a mesma validação/publicação.
