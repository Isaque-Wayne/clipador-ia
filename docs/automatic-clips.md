# Primeiros cortes automáticos locais — fluxo preservado

Este documento descreve o fluxo original `/process`, preservado para compatibilidade.
O web atual usa [ClipPortfolio e editor local](clip-portfolio.md), com vários perfis
de duração e planos de edição. No fluxo original, a API reutiliza a transcrição normalizada, analisa o texto,
seleciona até três candidatos e renderiza MP4 verticais com áudio e legenda ASS
queimada. A interface mantém o Glassmorphism existente e apresenta estados reais,
cards, preview, motivo, duração, potencial e download. O worker continua sem fila;
esta fase executa na API local, sem serviço externo ou nova dependência.

## Organização e preservação

- `features/analysis`: contrato de provider, agrupamento, sinais, scoring,
  seleção e persistência.
- `features/clip-rendering`: cues, layout, ASS, composição, processo FFmpeg,
  armazenamento de outputs e streaming HTTP com Range.
- `features/processing`: gate de recurso pesado, orquestração, controllers e rotas.
- Web: `features/processing`, conectado aos dois formulários existentes.

yt-dlp, seleção progressiva/fallback, remux, preparação de áudio, engine ASR,
checksum do upload e seus limites não foram reescritos. A transcrição recebeu
apenas o gate compartilhado e passou a devolver sua instância ao registro de
rotas. O scanner reconhece `analysis.json` e seu parcial; ambos contam na quota.
Um parcial de análise após crash não invalida o vídeo original.

A busca no código atual e diretórios antigos, excluindo dependências, artefatos,
dados e arquivos de ambiente, não encontrou integração Anthropic/Claude ou face
detection reutilizável. Nenhuma chave foi lida ou usada. Um futuro provider pode
implementar `AnalysisProvider`, declarar sua `analysisVersion` e retornar o mesmo
contrato. O provider local não inventa CTA, hashtags ou compreensão semântica.
Seu título é somente um trecho extraído da primeira frase.

## Candidatos e bordas

Versão atual: `local-1.0.1`. Palavras são agrupadas por pontuação conclusiva ou
pausa observada de pelo menos 1,2 s. Reticências não contam como conclusão.
Cada unidade guarda IDs dos segmentos e timestamps originais. O algoritmo
amostra até 40 aberturas e considera até três finais próximos de 57,5 s por
abertura: no máximo 120 candidatos, sem dividir o vídeo a cada minuto.
Prefere 30–90 s; fala contínua maior que o limite sem uma borda é rejeitada.
Uma fixture/vídeo inteiro menor que 30 s pode gerar um candidato com penalidade.

As bordas usam primeira/última palavra, até 120 ms antes e 180 ms depois,
limitadas pelo silêncio entre unidades, pelo início/fim do vídeo e pela faixa de
duração. Timestamps sobrepostos não deslocam a borda para dentro de uma palavra.
Não há garantia de coerência semântica: pontuação e pausas também podem ocorrer
no meio de um raciocínio, e o ASR pode errar nomes ou pontuação.

Sobreposição = interseção temporal / duração do menor trecho. Primeiro, o
melhor score elimina candidatos com sobreposição >= 70%. Depois, a seleção
automática aceita até três, com sobreposição <= 15% entre selecionados.
Empates usam início e ID, mantendo o resultado reproduzível.

## Scoring explicável

Cada valor normalizado fica entre 0 e 1. Score = soma dos critérios × seus pesos
menos soma das penalidades × seus pesos, limitado a 0–100 e arredondado a duas
casas. Os valores são arredondados a três casas antes da soma. A resposta guarda
dimensões, pesos, explicações, penalidades e versão do método.

| Critério | Peso | Sinal local |
| --- | ---: | --- |
| hookStrength | 16 | Base 0,25 + pergunta 0,35 + contraste 0,20 + números 0,20 |
| standaloneClarity | 16 | 0,25 para referência dependente na abertura; senão 0,85 |
| informationValue | 14 | Base 0,25 + causalidade/exemplo 0,40 + números 0,35 |
| curiosity | 8 | Pergunta 1; contraste 0,5; senão 0,15 |
| emotion | 6 | Vocabulário emocional 0,85; senão 0,10 |
| storytelling | 8 | Expressão narrativa 0,90; senão 0,15 |
| surprise | 6 | Contraste 0,75; senão 0,10 |
| retentionPotential | 12 | Média de hook, clareza, densidade e conclusão |
| conclusionQuality | 8 | Pontuação + marcador 1; só pontuação 0,70; senão 0,10 |
| speechDensity | 6 | Palavras/s divididas por 2,5, limitadas a 1 |

| Penalidade | Peso | Valor |
| --- | ---: | --- |
| slowStart | 8 | 0,6 se preenchimento ou primeira frase > 45 palavras |
| missingContext | 14 | 1 se conectivo/pronome dependente na abertura |
| unfinishedThought | 15 | 0,8 se ausência de pontuação conclusiva |
| excessiveSilence | 12 | clamp((proporção de lacunas − 0,30) / 0,40) |
| repetition | 10 | clamp((repetição de tokens > 3 caracteres − 0,30) / 0,40) |
| weakEnding | 8 | 0,7 se sinal de conclusão < 0,5 |
| tooShort | 12 | clamp((30 − duração) / 20) |
| tooLong | 15 | clamp((duração − 90) / 30) |

`clamp` limita a 0–1. As listas de conectivos e expressões estão em
`analysis/services/local-signals.ts`. Números/listas, contraste, experiência
passada e emoção são proxies lexicais, não medidas comprovadas de viralização
ou previsão estatística de retenção.

## Rotas

| Método e caminho | Resultado |
| --- | --- |
| POST `/uploads/:id/process` | Inicia fluxo automático; 202, ou 200 se reutilizado |
| GET `/uploads/:id/process/status` | Etapa, erro específico e contagem real de renders |
| DELETE `/uploads/:id/process` | Cancela trabalho ativo e aguarda cleanup |
| POST `/uploads/:id/analysis` | Analisa transcrição já concluída ou reutiliza cache; 200 |
| GET `/uploads/:id/analysis/status` | Status e versão |
| GET `/uploads/:id/analysis` | Report e candidatos |
| GET `/uploads/:id/analysis/candidates/:candidateId` | Candidato individual |
| POST `/uploads/:id/analysis/select` | `{ "candidateIds": ["c_..."] }`, de 1 a 3 |
| GET `/uploads/:id/clips` | Último lote concluído, metadados e report |
| GET `/uploads/:id/clips/:batchId/:candidateId/file` | MP4; Range simples e `?download=1` |

POST de análise é curto e síncrono sobre texto já disponível; não dispara ASR.
IDs inválidos, inexistência, seleção incompatível, concorrência e corrupção têm
respostas próprias. Render em andamento não é interrompido por fechar a página.
Cancelar explicitamente é possível pela API. Reiniciar após falha reutiliza ASR e
análise íntegros, sem reingestão. Falhas de processamento são exibidas pelo web
com mensagem/código; falha de conexão e timeout de consulta são distintos.

Etapas: preparing-audio, transcribing, transcribed, analyzing, selecting-clips,
rendering-subtitles (construção das cues/ASS), rendering-clips (FFmpeg com ASS),
completed ou failed. Etapas textuais podem ser rápidas demais para aparecer numa
consulta periódica. Não há porcentagem artificial. A contagem de cortes avança
quando cada arquivo é validado.

## Render, legendas e armazenamento

FFmpeg/FFprobe existentes e verificados por SHA-256. MP4 H.264 (`libopenh264`),
AAC 192 kb/s, 1080×1920, yuv420p e até 30 fps. O áudio é transcodificado para AAC
para obter cortes precisos/compatíveis; não há normalização, mudança de ganho,
música ou filtros de áudio no render. O vídeo é transcodificado porque composição
vertical e legendas queimadas exigem decodificação.

Se crop central retiver >= 68% da área, utiliza crop. Senão, escala proporcional
e padding escuro. Não detecta rostos. Para fontes horizontais, padding mantém o
quadro inteiro. O limiar mede área, não reconhece conteúdo importante.

Cues usam palavras reais, até cinco palavras/32 caracteres por grupo, com pausa
e pontuação. Arial 60 px, branco em negrito, contorno preto 4 px; margens laterais
130 px e inferior 470 px em canvas 1080×1920. São margens provisórias para reduzir
interferência de interfaces sociais, não um contrato universal dessas plataformas.
Não foi implementado destaque animado da palavra atual. Textos são escapados
para impedir injeção de tags ASS; nome de arquivo é ID controlado.

```
apps/api/.data/uploads/<uploadId>/analysis.json
apps/api/.data/clips/.work/<batchId>/      # ASS/MP4 parciais, removidos ao terminar
apps/api/.data/clips/<uploadId>/<batchId>/ # MP4 finais + manifest.json
```

Análise: checksum do envelope, hash da transcrição, hash do vídeo e versão;
escrita parcial com sync e rename. Mudança de versão invalida apenas o cache
da análise. Resultados antigos continuam disponíveis; um novo lote não os apaga.
Outputs: IDs controlados, caminhos canônicos sem symlink/junction, JSON limitado,
validação de resolução/codecs/duração e SHA-256 de cada MP4. O lote é promovido
somente depois de todos os cortes concluírem. Leitura/recuperação verifica hash.

Gate compartilhado permite **um trabalho pesado** (preparação/ASR ou render)
por instância; renders sequenciais, duas threads, sem vídeo inteiro em RAM.
Pipeline aceita um vídeo por vez, sem fila; conflito retorna 409/429. Use uma
instância da API por diretório privado, como no storage existente.

Limites atuais: render 5 min/corte e 60 min/lote, configuráveis. Outputs têm quota
lógica separada de 4 GiB e orçamento calculado por duração, teto 128 MiB por MP4
e até 16 MiB de manifesto. O render não herda o antigo deadline de preparação.
Veja [vídeos longos](long-videos.md). O limite de arquivo do FFmpeg
pode encerrar saída antes do fim; FFprobe rejeita duração truncada antes do commit.
Avisos do OpenH264 sobre profile/controle de bitrate foram observados; os MP4
passaram na validação, mas bitrate é alvo, não tamanho garantido.

Cleanup remove somente temporários reconhecidos dentro do batch UUID e aguarda
o processo fechar antes de remover arquivos. Após crash, a inicialização limpa
`.work`; outputs concluídos não têm expiração automática. Se a quota de outputs
esgotar, novos renders falham com OUTPUT_QUOTA e preservam os antigos. A retenção
de uploads/transcrições/análise continua 24 h; MP4 concluído pode ser consultado
mesmo após o source expirar. Não foi adicionado endpoint de exclusão de outputs.

## Validação reproduzível

```powershell
pnpm.cmd typecheck
pnpm.cmd build
node --test --test-concurrency=1 apps/api/tests/*.test.mjs apps/worker/tests/*.test.mjs apps/web/tests/*.test.ts
node scripts/processing/smoke-test.mjs UUID-DE-UPLOAD-COM-FALA-PORTUGUESA
```

A suíte cobre frases/pausas, janelas limitadas, soma do score, penalidades,
supressão/overlap, bordas, reticências, persistência/corrupção/versão, argumentos
FFmpeg, cues/ASS, processo falhando/cancelado/timeout, quota, temporários
controlados, pipeline com fixture pequena usando FFmpeg real, GET/Range/download,
rollback, reuso e recuperação. O smoke preserva o source, extrai uma amostra
com stream copy, transcreve realmente, produz até três MP4, verifica FFprobe/SHA,
extrai frames com legenda, recria o servidor e confirma cache/cleanup.

Não houve instalação de dependências, integração externa, alteração de secrets,
commit, push, deploy ou mudança nos backups nesta fase. A expansão semântica com
LLM e composição guiada por rostos são evoluções futuras, não bloqueios deste MVP.
