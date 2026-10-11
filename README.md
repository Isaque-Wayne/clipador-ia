# Clipador IA

Monorepo TypeScript para aprendizado e evolução do Clipador IA. Upload local e
YouTube, preparação de áudio, transcrição local com timestamps, análise textual
determinística e primeiros MP4 verticais com legendas queimadas estão integrados.
Veja [cortes automáticos](docs/automatic-clips.md) para fluxo, rotas e limites.

## Organização

- `apps/web`: interface com Next.js e React.
- `apps/api`: API Node.js com Fastify.
- `apps/worker`: bootstrap Node.js para futuro processamento.
- `app/`: estrutura anterior preservada; não faz parte do workspace pnpm.
- `docs/`: documentação e validações; `packages/` permanece sem pacote compartilhado.
- `package-json-backup/`, `README-backup/` e `AGENTS-backup/`: diretórios vazios
  renomeados com autorização para liberar nomes de arquivos na raiz.

Cada aplicação tem suas dependências e configurações. Somente `apps/*` integra
o workspace neste momento; pacotes compartilhados serão adicionados quando
existir código realmente compartilhado.

## Ferramentas e dependências

Requisitos declarados: Node.js 22 ou superior e pnpm 10.
As dependências estão disponíveis no workspace, com resolução em `pnpm-lock.yaml`.
A feature de upload não acrescenta dependências.

Web utiliza Next.js 16 e React 19. A API utiliza Fastify 5. TypeScript está
declarado em cada aplicação; `tsx` permite executar TypeScript no desenvolvimento
da API e do worker. Não há biblioteca de UI, fila, banco ou autenticação. A
transcrição utiliza IA local; a análise de cortes não chama IA externa.

## Comandos preparados

Instalar ferramentas ou dependências exige autorização explícita; iniciar
serviços também deve estar no escopo autorizado. No PowerShell com scripts
bloqueados, use `pnpm.cmd` em vez de `pnpm`.

| Comando na raiz | Objetivo | Impacto / risco |
| --- | --- | --- |
| `pnpm install` | Instalar dependências | Rede, dependências, lockfile e possíveis scripts; médio |
| `pnpm typecheck` | Conferir tipos das três aplicações | Gera tipos do Next.js e possível cache TypeScript; baixo |
| `pnpm build` | Compilar as três aplicações | Gera `.next/` e `dist/`; baixo |
| `pnpm dev:web` | Iniciar interface | Processo local na porta 3000; baixo |
| `pnpm dev:api` | Iniciar API | Processo local em `127.0.0.1:3001`; baixo |
| `pnpm dev:worker` | Executar bootstrap | Imprime uma mensagem e encerra; baixo |

Após instalação autorizada, executar typecheck e build. Depois, com execução
dos serviços autorizada, conferir a página inicial e `GET /health`, cuja resposta
inclui `"status":"ok"`. Não há script de lint configurado nesta fase.

## Configurações e decisões

- `tsconfig.base.json` ativa tipagem estrita, tratamento cuidadoso de propriedades
  opcionais e de acesso por índice; nenhuma regra é desligada para ocultar erros.
- Web usa resolução `Bundler`; API e worker usam ESM com resolução `NodeNext`.
  Imports relativos na API usam `.js`, correspondendo aos arquivos compilados.
- Imports `import type` deixam explícito o que existe apenas para o compilador.
- A API separa criação da instância, registro de rotas e inicialização.
- `PORT` é opcional, validado na inicialização e tem padrão `3001`. Nenhum arquivo
  de ambiente foi criado ou modificado. Não existe carregador de `.env` configurado.
- A API escuta somente no endereço local. O web encaminha o POST de upload
  por uma Route Handler em streaming e consultas por rewrite, sem configurar CORS.
- O worker não mantém um processo ocioso: executa o bootstrap e encerra.
- A interface utiliza CSS e fontes do sistema, sem dependência adicional.

## Fora do escopo atual

Postagem automática, autenticação, cobrança, filas externas, cloud, B-roll,
thumbnails e face tracking permanecem fora do escopo. A avaliação textual de
potencial não representa garantia de viralização.

## Upload de vídeo

A página também oferece ingestão por link do YouTube, preservando upload local.
Arquitetura, instalação verificada, limites e teste manual: [ingestão YouTube](docs/youtube-ingestion.md).
Sem progressivo compatível, a ingestão pode baixar H.264/AAC separados e fazer remux MP4 com FFmpeg local, sem reencode. FFprobe valida o resultado antes da publicação.

Com as dependências existentes, execute em dois terminais na raiz:

```powershell
pnpm.cmd dev:api
pnpm.cmd dev:web
```

Acesse `http://localhost:3000/upload` ou o link na página inicial. Selecione um
MP4, WebM ou MOV de até 4 GiB (4.294.967.296 bytes, por padrão) e clique em **Enviar vídeo**. Confira a mensagem
de sucesso com nome sanitizado, tamanho, tipo e ID. Teste também um arquivo vazio, um formato
não suportado e um vídeo acima do limite. Parar a API permite conferir o erro
de conexão e tentar novamente depois de reiniciá-la.

O navegador envia os bytes como corpo binário, `Content-Type` do vídeo e
`X-File-Name` codificado com `encodeURIComponent`. A rota `POST /uploads/video`
recebe e grava o arquivo em streaming no armazenamento temporário e responde JSON
com `success`, `message`, `id`, `file: { name, size, type }`, `status: "uploaded"`,
`nextStep: "processing"`, `extension`, `createdAt` e `checksum: { algorithm:
"sha256", value: "<64 caracteres hexadecimais>" }`. Erros de validação usam 400,
413 ou 415; quota excedida retorna 507 com uma mensagem clara.
Limite de concorrência retorna 429; timeout de upload retorna 408.
O limite configurado (4 GiB por padrão) é aplicado pela contagem real de bytes durante a escrita,
mesmo sem Content-Length. Quando presente, Content-Length é validado antes
da gravação e comparado com o total recebido. A validação básica
confere tamanho, MIME declarado e extensão; não verifica o conteúdo ou codec.
O conteúdo é salvo em `apps/api/.data/uploads/<UUID>/video.<extensão>`, com criação
exclusiva de diretório e arquivo, sem sobrescrita. A gravação começa em `.part`,
com flush, e promove o arquivo usando hard link exclusivo no mesmo filesystem.
Depois remove o nome `.part`. `metadata.json` é publicado por último como
marcador de conclusão. O caminho usa apenas UUID
gerado no servidor e extensão permitida, nunca o nome fornecido pelo cliente.
Nomes com separadores ou caracteres de controle são rejeitados; outros caracteres
inseguros e nomes reservados são sanitizados nos metadados. A pasta `.data/`
é ignorada pelo Git e não é servida publicamente. O web inicia o pipeline
de cortes após receber a confirmação, conforme a documentação de cortes.
O parser do Fastify entrega o stream sem montar um Buffer do vídeo. A escrita
aguarda cada chunk, respeita backpressure e trata escritas curtas do filesystem.
O SHA-256 é atualizado com os mesmos chunks gravados e finalizado somente após
o fim válido do stream e sync do arquivo. Não há segunda leitura completa para
calcular o hash. A Route Handler do web encaminha `request.body` diretamente;
o rewrite instalado do Next.js mantinha uma cópia em memória e não é usado no POST.

`config/upload-limits.mjs` é a fonte de verdade dos padrões de `UPLOAD_MAX_FILE_BYTES`
e `UPLOAD_QUOTA_BYTES` e da validação dessas variáveis de ambiente.
A API, a validação do navegador, o texto do formulário e o limite de proxy do
Next.js reutilizam esse módulo. O arquivo `.d.mts` fornece os tipos sem repetir
o valor. A API lê os limites na inicialização; o web lê `UPLOAD_MAX_FILE_BYTES`
durante o build e incorpora o mesmo valor no proxy e no bundle do navegador por
`NEXT_PUBLIC_UPLOAD_MAX_FILE_BYTES` (derivada automaticamente, não configure separadamente).
Use o mesmo `UPLOAD_MAX_FILE_BYTES` ao iniciar a API e ao construir/iniciar o web.
Reinicie a API e refaça o build do web após alterar esse limite. `UPLOAD_QUOTA_BYTES`
controla o armazenamento da API e não é exposta ao navegador.
O upload local tem prazo padrão de 30 minutos. Aceitar até 4 GiB não garante
concluir o envio em qualquer conexão. Download e processamento têm prazos próprios;
veja [vídeos longos e jobs](docs/long-videos.md).

### Consulta e limites do armazenamento provisório

Use o ID exibido no cartão de sucesso:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/uploads/SEU-ID
```

Também é possível consultar `http://localhost:3000/api/uploads/SEU-ID` pelo proxy.
`GET /uploads/:id` retorna `{ success: true, upload: { id, file, status, nextStep,
createdAt, extension, checksum } }`, sem caminhos internos. ID inválido retorna 400;
desconhecido ou expirado retorna 404.

Cada upload possui `metadata.json` com ID, nome sanitizado, extensão, MIME,
tamanho, data, status e próximo passo. Na inicialização, a API reconstrói o
índice antes de aceitar requisições. A leitura valida dados externos, limita o
JSON a 4 KiB, confere o ID do diretório, extensão permitida e tamanho do vídeo,
e não publica propriedades extras. Vídeos ausentes, parciais, JSON inválido ou
tamanho divergente não entram no índice. Há aviso de uploads incompletos no log
de inicialização. Uploads anteriores a esta etapa, sem JSON, são órfãos: não há
informação suficiente para recuperar seus metadados originais. Metadados da etapa
anterior sem checksum continuam recuperáveis com `checksum: null`; nenhum hash
é inventado ou calculado retroativamente. Checksums presentes precisam declarar
SHA-256 e conter exatamente 64 caracteres hexadecimais. A recuperação restaura
o hash conhecido, sem reler o vídeo para recalculá-lo.

### Retenção, quota e segurança

| Configuração no ambiente da API | Padrão | Uso |
| --- | --- | --- |
| `UPLOAD_CLEANUP_INTERVAL_MS` | `900000` (15 minutos) | Frequência da varredura; projetos não expiram |
| `UPLOAD_MAX_FILE_BYTES` | `4294967296` (4 GiB) | Limite por vídeo; API e build do web |
| `UPLOAD_QUOTA_BYTES` | `17179869184` (16 GiB) | Limite lógico de arquivos |
| `OUTPUT_STORAGE_QUOTA_BYTES` | `4294967296` (4 GiB) | Limite lógico independente dos cortes |
| `UPLOAD_MAX_CONCURRENT` | `2` | Quantidade máxima de uploads ativos |
| `UPLOAD_TIMEOUT_MS` | `1800000` (30 minutos) | Upload local e endpoint YouTube síncrono legado |

Valores devem ser inteiros positivos; intervalo e timeout não podem exceder `2147483647`
ms. Configuração inválida impede a inicialização. A API não carrega `.env`
automaticamente; defina as variáveis no terminal antes de iniciar.

Exemplo de configuração em PowerShell (antes do build do web e da inicialização da API):

```powershell
$env:UPLOAD_MAX_FILE_BYTES = '4294967296'
$env:UPLOAD_QUOTA_BYTES = '17179869184'
pnpm.cmd build
```

A quota de 16 GiB suporta dois vídeos máximos simultâneos com metadados e margem
para uploads anteriores. Ela não reserva espaço físico nem garante espaço livre
no disco; gravação pode falhar antes se o disco estiver cheio. Quatro vídeos de
exatamente 4 GiB não cabem juntos com seus JSON. Uma quota customizada menor que
o tamanho de um vídeo mais seus metadados bloqueia esse envio com 507, sem
ser aumentada automaticamente.

A varredura ocorre na inicialização, periodicamente e antes de novo upload.
**Projetos salvos não expiram automaticamente.** A Biblioteca em `/library`
permite consultar e excluir projetos/cortes após confirmação. `UPLOAD_RETENTION_MS`
não controla mais a API padrão; políticas explícitas de `retentionMs` permanecem
apenas para callers internos/testes isolados. A exclusão manual valida UUID,
caminhos canônicos e todos os filhos antes de remover arquivos regulares via
`unlink` e diretórios vazios via `rmdir`, sem remoção recursiva. Links/junctions
e conteúdo desconhecido bloqueiam a operação. Jobs e players ativos protegem
o projeto. Veja [Biblioteca e armazenamento](docs/library.md).

A quota conta vídeos, JSON, parciais e outros arquivos regulares existentes,
por tamanho lógico (não por blocos físicos ou espaço livre do disco). Antes
de gravar, reserva espaço para o JSON com hash e maior representação de tamanho;
depois limita os bytes recebidos com reservas compartilhadas. Um Content-Length
conhecido é reservado antecipadamente; sem ele, a reserva cresce antes da escrita
de cada chunk. A seção crítica coordena varredura, limpeza, reservas e índice;
as gravações acontecem em paralelo. Diretórios ativos são excluídos da varredura,
e suas reservas contam na quota sem contar novamente seus parciais.
Excesso conhecido é rejeitado antes de criar diretório; excesso durante o stream
retorna 507 e remove o parcial. Conteúdo inseguro impede iniciar ou continuar gravando.

O limite de concorrência é por instância da API, sem fila de espera: novas
requisições recebem 429 enquanto todas as vagas estiverem ocupadas. Vagas e
reservas são liberadas ao concluir, falhar ou cancelar. O timeout começa após
a admissão e inclui preparação e escrita. A espera por novos chunks observa
cancelamento sem destruir o HTTP antes de responder 408. Operações de filesystem
já em curso terminam antes da limpeza; o deadline é cooperativo, não um mecanismo
para interromper syscalls do sistema. Um commit completo que termina na fronteira
do timeout pode permanecer como upload completo. O cliente e o proxy do upload
local derivam seu prazo da configuração central, com margem de 30 e 15 segundos.
O YouTube usado pelo web retorna um ID imediatamente e usa polling independente.

Não há autenticação, análise de conteúdo/codec ou coordenação entre
processos: use **uma instância da API por diretório**, em filesystem local com
suporte a hard links. O vídeo não é agregado em RAM; existem buffers limitados
dos streams e do transporte. A varredura a cada envio cresce com a quantidade de
arquivos. O checksum registra os bytes recebidos; não é comparado com um hash
do cliente. A pasta deve ser privada e não
modificada por outros processos; verificações de caminho não eliminam corridas
contra um usuário local com permissão de escrita. Flush reduz risco de perda,
mas não oferece garantia completa contra falha física do disco ou energia.
Em erro do stream, excesso de tamanho/quota, vazio ou cancelamento, o arquivo
é fechado e apenas os parciais criados pela operação são removidos dentro do
diretório UUID validado. Nenhum checksum incompleto é publicado no índice.
Se o cliente já desconectou, não é possível entregar uma resposta de erro.
Falhas HTTP com corpo ainda incompleto encerram a conexão após a resposta.
Uma falha após promover o vídeo e antes de concluir os metadados pode deixar
um vídeo completo órfão. Diretórios vazios, falhas na própria remoção e crashes
abruptos permanecem contabilizados pelos arquivos existentes; não são apagados
por idade na configuração padrão.
Falha de storage retorna 500 sem expor caminhos; falha na recuperação impede
iniciar a API e falha na limpeza periódica é registrada no log.
Um timeout no cliente pode ocorrer depois de a API salvar o arquivo; repetir
o envio cria outro upload.

### Estado e consumo seguro

Os status persistidos são `uploaded`, `queued`, `processing`, `failed` e
`completed`. O POST continua retornando `uploaded`. As transições são internas,
através de `transitionUpload(id, status)`, sem endpoint de mutação público:

| Origem | Destinos permitidos |
| --- | --- |
| `uploaded` | `queued`, `failed` |
| `queued` | `processing`, `failed` |
| `processing` | `completed`, `failed` |
| `completed` | `failed` (por exemplo, corrupção posterior) |
| `failed` | nenhum |

Transições inválidas retornam erro 409. A atualização usa JSON parcial e troca
atômica do metadado existente, antes de atualizar o índice. Status são contratos
do storage. O pipeline atual usa status próprio, sem fila ou transporte para o worker.

`consumeUpload(id, callback)` protege o arquivo da limpeza, abre um handle somente
para leitura e chama `verifyUploadIntegrity` antes do callback. Essa função relê
o vídeo em streaming e compara tamanho e SHA-256 persistido, além de detectar
mudanças durante a verificação. O callback recebe o mesmo handle verificado,
não um caminho interno; deve ler desde a posição zero (por exemplo, `readFile`
ou `createReadStream({ start: 0, autoClose: false })`) e concluir o consumo antes
de retornar. O handle é fechado automaticamente. Usar um handle não impede
alterações in-place por outro processo: o diretório continua exigindo controle privado.

Integridade é recalculada somente quando há consumo explícito, nunca em GET,
limpeza ou recuperação do índice. Cada novo consumo verifica novamente porque
o arquivo pode ter sido alterado desde o anterior. Checksum inválido ou arquivo
indisponível bloqueia o callback e marca `failed` de forma persistente. Uploads
legados sem checksum são rejeitados no consumo com 409 e exigem novo envio.
Status `failed` não pode ser consumido. Uma exceção do callback após verificação
não altera status automaticamente; a futura integração decide o resultado.
Consumo não pode ocorrer duas vezes ao mesmo tempo no mesmo upload, e transições
externas são bloqueadas enquanto ele está em uso. O pin é liberado ao retornar
ou falhar; um arquivo expirado fica protegido apenas enquanto estiver em uso.
O consumo é uma função interna, sem rota pública; preparação, ASR e render o
reutilizam para verificar integridade e proteger o source durante o processamento.

Para conferir recuperação, envie um vídeo, guarde o ID, reinicie apenas a API
e repita `GET /uploads/:id`. Para testar retenção curta em ambiente de teste,
configure `UPLOAD_RETENTION_MS=10000` e `UPLOAD_CLEANUP_INTERVAL_MS=1000` antes
de iniciar; isso também pode remover uploads antigos existentes na pasta.

### Preparação do worker

`jobs/video-job.ts` cria um job `process-video`, com ID próprio, `uploadId`,
data e status `pending`. `processors/video-processor.ts` representa a preparação
e mantém o job pendente com processamento desabilitado. Não existe transporte
API → worker, fila, descoberta de arquivos ou execução automática de jobs.
Não é necessário iniciar o worker para usar o upload.

Por padrão, o proxy aponta para `http://127.0.0.1:3001`. Se mudar a porta da API,
defina `API_BASE_URL` no ambiente do web antes de iniciar ou compilar o Next.js.
Nenhum arquivo de ambiente é carregado pela API automaticamente.

Validação sem iniciar servidores:

```powershell
pnpm.cmd typecheck
pnpm.cmd build
node --test apps/api/tests/video-upload.test.mjs apps/api/tests/upload-storage.test.mjs apps/api/tests/upload-stream.test.mjs apps/api/tests/upload-lifecycle.test.mjs apps/api/tests/upload-limits.test.mjs apps/api/tests/youtube-ingestion.test.mjs apps/api/tests/youtube-security.test.mjs apps/worker/tests/video-job.test.mjs
node --experimental-strip-types --test apps/web/tests/upload-proxy.test.ts apps/web/tests/upload-validation.test.ts apps/web/tests/youtube-ingestion.test.ts
```

O teste usa `Fastify.inject` sobre a API compilada e cobre recebimento, formatos,
limites, persistência dos bytes, consulta, nomes maliciosos, colisões, falhas de
storage, recuperação do índice e preservação de `/health` e `/about`. Os testes
de armazenamento cobrem JSON persistente, expiração, limpeza periódica, quota
concorrente, parciais, entradas inválidas e segurança de caminhos. O teste do
worker cobre criação e permanência do job pendente. Os testes criam pastas
isoladas `clipador-*-test-*` no temporário do sistema e preservam as pastas de
teste. Os testes de retenção removem apenas seus uploads gerados para validar
a limpeza autorizada. Typecheck e build geram os artefatos usuais. O typecheck web usa os
tipos gerados em `.next/types`, excluindo a cópia de desenvolvimento para evitar
declarações duplicadas quando as duas pastas existem. Os testes de streaming
cobrem SHA-256, escrita antes do fim da fonte, backpressure, vazio, interrupção,
cancelamento, limite sem Content-Length, quota durante envio, remoção do parcial,
falha de sync, escritas curtas e recuperação do checksum. Os testes do proxy
conferem encaminhamento do mesmo stream, respostas de erro e cancelamento.
O comando nativo de teste TypeScript do proxy exige Node 22.6+; foi validado
com Node 24, sem instalar ferramenta. Nenhum teste inicia servidor de rede.
Os testes de ciclo de vida cobrem gravações paralelas, limite 429, timeout 408,
remoção de parcial, liberação de vagas, reservas compartilhadas, proteção contra
limpeza, integridade válida e inválida, consumo de arquivo corrompido e transições
persistentes de status. Não foi feito teste de carga nem medição de throughput.

Para comparar manualmente o SHA-256 local com o retornado pelo GET:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\caminho\video.mp4'
```

O PowerShell pode exibir letras maiúsculas; a API retorna letras minúsculas.

Inspeção técnica e preparação de áudio foram adicionadas como primeiro bloco
do processamento. Veja [pipeline de vídeo](docs/video-processing.md) para
arquitetura, contratos, quota, timeout e smoke test da preparação.

Transcrição real local com faster-whisper foi integrada e validada. Veja
[transcrição e análise](docs/transcription.md) para rotas de início/status/resultado,
persistência, word timestamps, recuperação, métricas reais e limitações; e
[engine local](tools/transcription/README.md) para versões, origem, licenças e setup.

O fluxo pós-transcrição, scoring explicável, seleção, MP4 verticais, legendas ASS,
outputs persistentes e cards do web estão em [cortes automáticos](docs/automatic-clips.md).

O fluxo atual do web foi ampliado para [ClipPortfolio e editor local](docs/clip-portfolio.md):
múltiplas durações, famílias, emoção lexical/energia medida, seleção variada,
EditPlans, captions dinâmicas, zoom e pacing conservador. O fluxo anterior continua
disponível. Resultados reais por clip e limitações estão na
[validação do portfólio](docs/portfolio-validation-2026-10-08.md).

O suporte a vídeos de até uma hora, prazos independentes, jobs, polling, progresso
real e cancelamento de processos estão em [vídeos longos](docs/long-videos.md), com
[diagnóstico](docs/long-video-diagnosis-2026-10-08.md) e
[resultados de validação](docs/long-video-validation-2026-10-09.md).
