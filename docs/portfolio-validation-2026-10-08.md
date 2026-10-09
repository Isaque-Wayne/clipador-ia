# Validação do ClipPortfolio — 2026-10-08

Lote final 91dd6731-c24f-4eda-a8fe-d3244ddab6e9, upload 1f5397b6-c4a3-4654-916f-1f7cb07ee477, modo many. [JSON completo](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/result.json>) contém os EditPlans, emoções, probes, previews e métricas. Todos os links de mídia abaixo apontam para o storage isolado deste teste; ele é separado da API padrão em 3001.

## Capacidade e distribuição

**16 MP4s reais concluídos**: 7 MICRO, 6 SHORT, 2 STANDARD, 1 EXTENDED. O objetivo de teste foi atendido sem quotas por perfil. Pool deduplicado de 24 candidatos: MICRO 9, SHORT 8, STANDARD 4, EXTENDED 3. Auto seleciona 8, distribuição calculada {"micro":3,"short":2,"standard":2,"extended":1}; essa seleção é um subconjunto dos MP4s efetivamente renderizados neste lote Muitos. Máximo aproveitamento seleciona 24 variações aprovadas; o lote máximo inteiro não foi renderizado. Qualidade significa critérios heurísticos locais, sujeitos à revisão de contexto.

## Métricas medidas

| Medida | Resultado |
| --- | ---: |
| Vídeo original completo | 960.689297 s |
| Sample de mídia / transcrição reutilizada | 153,970442 / 153.9483125 s |
| Idioma e transcrição | Português, 372 palavras, 39 segmentos |
| Candidatos brutos | 198 |
| Válidos antes de dedup | 107 |
| Rejeitados por qualidade | 91 |
| Duplicados removidos | 83 |
| Aprovados após dedup | 24 |
| Famílias do pool | 13 |
| Análise textual | 0.114935 s |
| Análise com medição de áudio, sem cache, mesma versão | 0.510398 s |
| Consulta da análise no lote final, com cache | 0.028577 s |
| Render de lote, wall time | 53.749013 s |
| Soma render+probe/hash dos clips | 50.019343 s |
| Total incluindo previews e recovery | 64.441840 s |
| MP4s | 133409731 bytes / 127.23 MiB |
| Manifesto | 497576 bytes |
| Frames de QA adicionais | 5830836 bytes |
| Pico RSS Node observado | 181125120 bytes / 172.73 MiB |
| Chamadas adicionais ao ASR | 0 |

A RAM dos filhos FFmpeg não foi capturada; o RSS acima mede somente Node. O tempo da análise sem cache vem de [execução da mesma versão](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-15-37-097Z/result.json>). Nenhum tempo é benchmark de máquina genérica. Os testes preservam outputs anteriores e dados originais.

## Editor e qualidade dos outputs

Presets executados: {"DYNAMIC":7,"STORY":1,"EMOTIONAL":3,"EDUCATIONAL":4,"CLEAN":1}. 22 zooms de evento foram executados; 0 pausas aparadas neste sample. A fala desse vídeo não forneceu pausas com evidência suficiente para trim. O teste sintético separado confirmou concatenação de vídeo/áudio e captions remapeadas após remover silêncio medido. Captions dinâmicas, keywords maiores e zoom foram renderizados de verdade. Cada MP4 passou por FFprobe: H.264/AAC, 1080×1920, áudio presente e duração do EditPlan com tolerância de 0,3 s. SHA-256 também foi verificado na recuperação e no GET/Range.

Testes de pixels decodificados verificam palavra ativa colorida e aumento >10% da área de um alvo estático durante o zoom de 8%. Ducking real usa um tom original gerado só para a fixture e mede energia da trilha 880 Hz durante voz vs silêncio: durante voz <80% da energia sem voz. O provider recusou o asset não aprovado antes de aceitar o catálogo autorizado da fixture. No sample real não há música licenciada disponível: clips continuam com voz original e warning, sem downloads.

B-roll, efeitos sonoros e active speaker são infraestrutura/contratos. Busca por scene>0,3 a 2 fps no sample não encontrou mudanças; frames mostram o mesmo monólogo. Não existe cutaway contextual aprovado nem compositor de B-roll. Ausência desses recursos não bloqueia um output.

## Preservação, testes e limites

Checksums do sample e transcript.json permaneceram iguais. O SHA-256 do vídeo completo também foi comparado com metadata.json nesta entrega: 0e3e6adf617dafc38fa08cd4e810398d917533fbf36b8b30deaaad3510cc1ebd. API recriada recuperou os 16 outputs e reutilizou análise/lote; health e GET por ID passaram. Diretório .work vazio, nenhum .part no upload, outputs contêm somente MP4s e manifesto. Nenhum código de yt-dlp, remux/fallback ou engine ASR foi reescrito.

139 testes distintos passaram: 129 API/worker e 10 web. Os testes relacionados a edição/render e compatibilidade foram repetidos após o ajuste final da safe area e passaram (10/10); portfólio/edição também passaram após a seleção final (11/11). Typecheck/build dos três apps passaram. Os testes usam FFmpeg existente; não houve instalação de dependências. A interface recebeu filtros/cards e validação de contrato, mas não houve QA interativo de navegador nesta rodada.

Limites: seleção, emoção, story arc e tópicos são lexicais; erros do ASR podem afetar captions e conteúdo. Frase completa não garante raciocínio completo. A heurística de CTA pode perder passagens úteis ou deixar divulgação residual; o lote real ainda exige revisão editorial. FamilyId representa abertura compartilhada, sem agrupamento semântico avançado. Sem pitch, detecção visual, diarização, split-screen ou biblioteca de assets aprovada. Não há promessa de viralização.

Próximo passo prioritário: avaliar precisão da seleção em mais vídeos portugueses, com revisão anotada de contexto/hook/fechamento, antes de ampliar efeitos. Um provider semântico mais forte e assets musicais/contextuais aprovados podem melhorar o editor; modelos novos, APIs externas e bibliotecas exigem autorização. Os recursos locais previstos nesta rodada foram concluídos.

## Clips individuais

| # | Family | Perfil | Start–end (s) | Output (s) | Potential | Hook | Estilo |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | f_aecd12a64a9728da | MICRO | 0.00–13.21 | 13.210 | 68.02 | 25.50 | DYNAMIC |
| 2 | f_29612154d1f3b157 | EXTENDED | 77.74–152.82 | 75.080 | 66.84 | 35.50 | STORY |
| 3 | f_3fc8681124210927 | STANDARD | 7.14–67.88 | 60.740 | 63.88 | 40.50 | EMOTIONAL |
| 4 | f_29612154d1f3b157 | SHORT | 77.74–116.51 | 38.770 | 66.84 | 35.50 | EDUCATIONAL |
| 5 | f_29612154d1f3b157 | MICRO | 77.74–88.22 | 10.480 | 66.84 | 35.50 | DYNAMIC |
| 6 | f_3fc8681124210927 | MICRO | 7.14–23.00 | 15.860 | 64.86 | 40.50 | DYNAMIC |
| 7 | f_aecd12a64a9728da | SHORT | 0.00–33.20 | 33.200 | 66.82 | 25.50 | EMOTIONAL |
| 8 | f_29612154d1f3b157 | STANDARD | 77.74–134.81 | 57.070 | 66.84 | 35.50 | EDUCATIONAL |
| 9 | f_5be36aee06e6f467 | SHORT | 52.68–94.20 | 41.520 | 58.85 | 25.50 | EDUCATIONAL |
| 10 | f_88bfd4befc345d4f | MICRO | 144.23–152.82 | 8.600 | 53.20 | 25.50 | DYNAMIC |
| 11 | f_0f324aef793963d6 | SHORT | 124.24–152.82 | 28.580 | 53.40 | 25.50 | EDUCATIONAL |
| 12 | f_a3876ac8c37ab629 | MICRO | 18.12–33.20 | 15.080 | 52.71 | 25.50 | DYNAMIC |
| 13 | f_a3876ac8c37ab629 | SHORT | 18.12–52.36 | 34.240 | 48.45 | 25.50 | EMOTIONAL |
| 14 | f_a9eba468407b447a | SHORT | 102.59–134.81 | 32.233 | 44.70 | 25.50 | CLEAN |
| 15 | f_a9eba468407b447a | MICRO | 102.59–116.51 | 13.933 | 44.70 | 25.50 | DYNAMIC |
| 16 | f_0f324aef793963d6 | MICRO | 124.24–137.50 | 13.260 | 44.70 | 25.50 | DYNAMIC |

### 1. O jeito que você sonha em ser, você tem

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_ffb797dd18ffbbc9.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_ffb797dd18ffbbc9-preview.png>)

- ID: c_ffb797dd18ffbbc9; family: f_aecd12a64a9728da; profile: micro.
- Source: 0.000–13.210 s; output: 13.210000 s.
- Potential: 68.02; hook: 25.5; standalone: 85.
- Emoção lexical: inspiration (0.50), reflection (0.50); confiança 0.45.
- Motivo: hook/punchline. Não foi detectada referência dependente na abertura. Conectivos causais, exemplos e números observados.
- Estilo: DYNAMIC; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 3726311 bytes (3.55 MiB); render: 1.503 s.
- SHA-256: `56c9522231b100d954886df5e0c55a9fa91fdd4b09cf40de53ee6acb03dbb792`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 2. eu com 19 anos, eu já tinha uma estrutura,

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_90208b027ad5ab10.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_90208b027ad5ab10-preview.png>)

- ID: c_90208b027ad5ab10; family: f_29612154d1f3b157; profile: extended.
- Source: 77.740–152.820 s; output: 75.080000 s.
- Potential: 66.84; hook: 35.5; standalone: 85.
- Emoção lexical: confidence (0.50), energy (0.60); confiança 0.45.
- Motivo: raciocínio ou história completa. Interrogação na abertura, contraste e números são sinais textuais de atenção. Não foi detectada referência dependente na abertura.
- Estilo: STORY; efeitos executados: vertical-framing, captions, event-driven-zoom; 3 zooms; 0 trims.
- Assets: Sem música licenciada disponível: render com voz original. Sem cutaway do source aprovado/contextual: B-roll omitido..
- Tamanho: 20398127 bytes (19.45 MiB); render: 6.844 s.
- SHA-256: `8f4423026691f9f95d3fd3e185b1533af66847f3044737c427bbe708de72fc88`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 3. Eu aprendi muito jovem isso através dos livros, com

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_ee63b56ea7211f5e.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_ee63b56ea7211f5e-preview.png>)

- ID: c_ee63b56ea7211f5e; family: f_3fc8681124210927; profile: standard.
- Source: 7.140–67.880 s; output: 60.740000 s.
- Potential: 63.88; hook: 40.5; standalone: 85.
- Emoção lexical: inspiration (0.60), reflection (0.60); confiança 0.45.
- Motivo: ideia desenvolvida. Não foi detectada referência dependente na abertura. Conectivos causais, exemplos e números observados.
- Estilo: EMOTIONAL; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 2 zooms; 0 trims.
- Assets: Sem música licenciada disponível: render com voz original..
- Tamanho: 15859441 bytes (15.12 MiB); render: 5.757 s.
- SHA-256: `fd57614c4276c8dbb69c28036b2d205064ab72ae636a32653923410e79a7c266`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 4. eu com 19 anos, eu já tinha uma estrutura,

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_bc8addfe2a5b9b8e.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_bc8addfe2a5b9b8e-preview.png>)

- ID: c_bc8addfe2a5b9b8e; family: f_29612154d1f3b157; profile: short.
- Source: 77.740–116.510 s; output: 38.770000 s.
- Potential: 66.84; hook: 35.5; standalone: 85.
- Emoção lexical: confidence (0.50); confiança 0.45.
- Motivo: explicação rápida. Interrogação na abertura, contraste e números são sinais textuais de atenção. Não foi detectada referência dependente na abertura.
- Estilo: EDUCATIONAL; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 2 zooms; 0 trims.
- Assets: Sem cutaway do source aprovado/contextual: B-roll omitido..
- Tamanho: 10972149 bytes (10.46 MiB); render: 4.226 s.
- SHA-256: `3a4bbc2954619d04afcad998134d52157786da8a572f4489223ade53be846200`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 5. eu com 19 anos, eu já tinha uma estrutura,

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_47de1802acb3787f.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_47de1802acb3787f-preview.png>)

- ID: c_47de1802acb3787f; family: f_29612154d1f3b157; profile: micro.
- Source: 77.740–88.220 s; output: 10.480000 s.
- Potential: 66.84; hook: 35.5; standalone: 85.
- Emoção lexical: sem evidência lexical; confiança 0.
- Motivo: hook/punchline. Interrogação na abertura, contraste e números são sinais textuais de atenção. Não foi detectada referência dependente na abertura.
- Estilo: DYNAMIC; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 3136339 bytes (2.99 MiB); render: 1.393 s.
- SHA-256: `287ecb0e1b3cc47bb71eea80b8b8cdba8af8d2b121c9f14f013fe664e2ee0caa`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 6. Eu aprendi muito jovem isso através dos livros, com

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_d249381ffea6e0af.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_d249381ffea6e0af-preview.png>)

- ID: c_d249381ffea6e0af; family: f_3fc8681124210927; profile: micro.
- Source: 7.140–23.000 s; output: 15.860000 s.
- Potential: 64.86; hook: 40.5; standalone: 85.
- Emoção lexical: inspiration (0.50), reflection (0.50); confiança 0.45.
- Motivo: hook/punchline. Não foi detectada referência dependente na abertura. Conectivos causais, exemplos e números observados.
- Estilo: DYNAMIC; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 3788508 bytes (3.61 MiB); render: 1.982 s.
- SHA-256: `eb6302816d01ecd43a6ee5fe1bd1a4aae4dea5efee5164adb4d0a8136d0aacea`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 7. O jeito que você sonha em ser, você tem

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_fe2d5790296039dd.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_fe2d5790296039dd-preview.png>)

- ID: c_fe2d5790296039dd; family: f_aecd12a64a9728da; profile: short.
- Source: 0.000–33.200 s; output: 33.200000 s.
- Potential: 66.82; hook: 25.5; standalone: 85.
- Emoção lexical: inspiration (0.60), reflection (0.60); confiança 0.45.
- Motivo: explicação rápida. Não foi detectada referência dependente na abertura. Conectivos causais, exemplos e números observados.
- Estilo: EMOTIONAL; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 2 zooms; 0 trims.
- Assets: Sem música licenciada disponível: render com voz original..
- Tamanho: 8655239 bytes (8.25 MiB); render: 3.677 s.
- SHA-256: `4249bde946b324cfe41d0a70d2dfc7ca0fd1a9fb879bdf681f8168cf3095ef5f`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 8. eu com 19 anos, eu já tinha uma estrutura,

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_5b50493069cad3bc.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_5b50493069cad3bc-preview.png>)

- ID: c_5b50493069cad3bc; family: f_29612154d1f3b157; profile: standard.
- Source: 77.740–134.810 s; output: 57.070000 s.
- Potential: 66.84; hook: 35.5; standalone: 85.
- Emoção lexical: confidence (0.50), energy (0.50); confiança 0.45.
- Motivo: ideia desenvolvida. Interrogação na abertura, contraste e números são sinais textuais de atenção. Não foi detectada referência dependente na abertura.
- Estilo: EDUCATIONAL; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 3 zooms; 0 trims.
- Assets: Sem cutaway do source aprovado/contextual: B-roll omitido..
- Tamanho: 15488635 bytes (14.77 MiB); render: 5.393 s.
- SHA-256: `41563d10f51d51b9e9bdfec2edff24ca6eff0c251a3c04baffcd32b3927beefc`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 9. Eu vejo a riqueza dessa forma, prosperidade.

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_70a477add8ee3ffc.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_70a477add8ee3ffc-preview.png>)

- ID: c_70a477add8ee3ffc; family: f_5be36aee06e6f467; profile: short.
- Source: 52.680–94.200 s; output: 41.520000 s.
- Potential: 58.85; hook: 25.5; standalone: 85.
- Emoção lexical: reflection (0.50); confiança 0.45.
- Motivo: explicação rápida. Não foi detectada referência dependente na abertura. Conectivos causais, exemplos e números observados.
- Estilo: EDUCATIONAL; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 11485807 bytes (10.95 MiB); render: 4.048 s.
- SHA-256: `b60719f93792298d9af61a7ae04645b099ae2aa1ced16f9854ac9a2b7a9f39ee`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 10. Falar em livro, estou terminando de organizar um livro

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_d0ae743a4961d0a4.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_d0ae743a4961d0a4-preview.png>)

- ID: c_d0ae743a4961d0a4; family: f_88bfd4befc345d4f; profile: micro.
- Source: 144.230–152.820 s; output: 8.600000 s.
- Potential: 53.2; hook: 25.5; standalone: 85.
- Emoção lexical: energy (0.50); confiança 0.45.
- Motivo: hook/punchline. Não foi detectada referência dependente na abertura. Média dos sinais de abertura, clareza, densidade e fechamento.
- Estilo: DYNAMIC; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 2951206 bytes (2.81 MiB); render: 1.160 s.
- SHA-256: `753f155f1f129841719d8057566985afd6f015f640adba6bc54bcb81077cdaa0`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 11. Já tive vários casos de sucesso pelo Brasil todo,

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_cec06f1d370166ee.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_cec06f1d370166ee-preview.png>)

- ID: c_cec06f1d370166ee; family: f_0f324aef793963d6; profile: short.
- Source: 124.240–152.820 s; output: 28.580000 s.
- Potential: 53.4; hook: 25.5; standalone: 85.
- Emoção lexical: energy (0.60); confiança 0.45.
- Motivo: explicação rápida. Não foi detectada referência dependente na abertura. Média dos sinais de abertura, clareza, densidade e fechamento.
- Estilo: EDUCATIONAL; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 2 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 8611083 bytes (8.21 MiB); render: 2.891 s.
- SHA-256: `d794019a4fc23e2f9c47ff0324619df27936198e3557e31e281c5f157fd27822`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 12. Li muito livros ali dos americanos, até hoje, nós

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_257ca302e98a1b5e.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_257ca302e98a1b5e-preview.png>)

- ID: c_257ca302e98a1b5e; family: f_a3876ac8c37ab629; profile: micro.
- Source: 18.120–33.200 s; output: 15.080000 s.
- Potential: 52.71; hook: 25.5; standalone: 85.
- Emoção lexical: inspiration (0.50), reflection (0.50); confiança 0.45.
- Motivo: hook/punchline. Não foi detectada referência dependente na abertura. Conectivos causais, exemplos e números observados.
- Estilo: DYNAMIC; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 3999739 bytes (3.81 MiB); render: 1.756 s.
- SHA-256: `9a64de059926cfe9eabb6b9324cd1213b53b7782b44964ea791dd8f02f4be56f`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 13. Li muito livros ali dos americanos, até hoje, nós

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_85a8926dc5078d13.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_85a8926dc5078d13-preview.png>)

- ID: c_85a8926dc5078d13; family: f_a3876ac8c37ab629; profile: short.
- Source: 18.120–52.360 s; output: 34.240000 s.
- Potential: 48.45; hook: 25.5; standalone: 85.
- Emoção lexical: inspiration (0.50), reflection (0.50); confiança 0.45.
- Motivo: explicação rápida. Não foi detectada referência dependente na abertura. Conectivos causais, exemplos e números observados.
- Estilo: EMOTIONAL; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: Sem música licenciada disponível: render com voz original..
- Tamanho: 9114127 bytes (8.69 MiB); render: 3.252 s.
- SHA-256: `d161856a58f10c3c523a3cbfd4a7f87ec89b99f16a1b3ebfceb2f2585f9849b1`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 14. Você que é novo aqui no meu canal.

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_a12e101e54722b5e.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_a12e101e54722b5e-preview.png>)

- ID: c_a12e101e54722b5e; family: f_a9eba468407b447a; profile: short.
- Source: 102.590–134.810 s; output: 32.233333 s.
- Potential: 44.7; hook: 25.5; standalone: 85.
- Emoção lexical: energy (0.50); confiança 0.45.
- Motivo: explicação rápida. Não foi detectada referência dependente na abertura. Média dos sinais de abertura, clareza, densidade e fechamento.
- Estilo: CLEAN; efeitos executados: vertical-framing, captions; 0 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 7853569 bytes (7.49 MiB); render: 3.059 s.
- SHA-256: `c8c4c1a631d797db775b95b2440c01325669eb5a58ed0a9f39fa4dde917c4817`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 15. Você que é novo aqui no meu canal.

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_64ebff83d8e8df01.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_64ebff83d8e8df01-preview.png>)

- ID: c_64ebff83d8e8df01; family: f_a9eba468407b447a; profile: micro.
- Source: 102.590–116.510 s; output: 13.933333 s.
- Potential: 44.7; hook: 25.5; standalone: 85.
- Emoção lexical: sem evidência lexical; confiança 0.
- Motivo: hook/punchline. Não foi detectada referência dependente na abertura. Média dos sinais de abertura, clareza, densidade e fechamento.
- Estilo: DYNAMIC; efeitos executados: vertical-framing, active-word-captions; 0 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 3838545 bytes (3.66 MiB); render: 1.612 s.
- SHA-256: `b5fcf0e69c9d533f119f40e77952047c0240ebaafc2bf971c937439f01f4401e`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.

### 16. Já tive vários casos de sucesso pelo Brasil todo,

[MP4](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/clips/1f5397b6-c4a3-4654-916f-1f7cb07ee477/91dd6731-c24f-4eda-a8fe-d3244ddab6e9/c_3bb16af4858ea02b.mp4>) · [Frame](<C:/Users/Isaque Neiva/Documents/clipador ia/apps/api/.data/portfolio-smoke/2026-10-08T23-21-52-124Z/c_3bb16af4858ea02b-preview.png>)

- ID: c_3bb16af4858ea02b; family: f_0f324aef793963d6; profile: micro.
- Source: 124.240–137.500 s; output: 13.260000 s.
- Potential: 44.7; hook: 25.5; standalone: 85.
- Emoção lexical: energy (0.50); confiança 0.45.
- Motivo: hook/punchline. Não foi detectada referência dependente na abertura. Média dos sinais de abertura, clareza, densidade e fechamento.
- Estilo: DYNAMIC; efeitos executados: vertical-framing, active-word-captions, event-driven-zoom; 1 zooms; 0 trims.
- Assets: nenhum asset opcional solicitado.
- Tamanho: 3530906 bytes (3.37 MiB); render: 1.467 s.
- SHA-256: `ef4c7dd2e98989550854177c4f5d3c281db6cf45f2d90134af60257b433ca5e7`.
- Versões: portfolio-local-1.0.2; social-edit-1.0.1; caption-plan-1.0.1.
