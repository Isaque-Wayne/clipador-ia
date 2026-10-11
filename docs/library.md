# Biblioteca e armazenamento

`/library` lista projetos nas raízes ativas de uploads e cortes da API. Os dados
são reconstruídos dos arquivos; não há banco nem dependência de um índice apenas
em memória. Pastas de testes/smokes e backups fora dessas raízes não são projetos
de produção e não são varridas pela Biblioteca.

A listagem mostra origem, título, thumbnail YouTube quando disponível, duração,
data, estado, bytes originais/outputs, cortes, transcrição e análise. Filtra por
estado/título e ordena por data, espaço ou quantidade. Metadata malformada e
outputs órfãos aparecem com avisos. Parciais sem metadata não são projetos válidos;
seus bytes continuam contabilizados no dashboard. Uploads locais sem thumbnail
mostram um placeholder. Nenhuma imagem de preview nova é gerada automaticamente.

`/library/:id` abre o original, transcrição e candidatos persistidos e **todos**
os lotes de cortes, com paginação de 12 players. Abrir/assistir/baixar não inicia
transcrição, análise nem renderização. Metadata/checksums ficam em disclosures.
Players usam ranges; o arquivo é validado por checksum no servidor antes de servir.

## API

| Método | Endpoint | Resultado |
| --- | --- | --- |
| GET | `/projects` | Projetos persistidos |
| GET | `/projects/:id` | Detalhes, candidatos, transcrição e cortes |
| GET | `/projects/:id/outputs` | Todos os cortes históricos |
| GET | `/projects/:id/original` | Original com ranges |
| GET | `/storage/usage` | Uso e quotas independentes, espaço físico livre |
| DELETE | `/projects/:id` | Excluir projeto completo |
| DELETE | `/projects/:id/outputs` | Excluir todos os cortes/lotes do projeto |
| POST | `/projects/:id/retry` | Reutilizar resultados e continuar pendentes |

DELETE exige JSON `{ "confirm": true }`. Nenhum endpoint recebe um path do cliente.
UUIDs e nomes são validados, as raízes são canônicas, junctions/symlinks não são
seguidos e todos os filhos são verificados antes da primeira exclusão. Remoção
é exclusivamente por arquivos conhecidos e diretórios vazios. Jobs, preparação,
ingestão gravando e streams de playback possuem proteção coordenada; exclusão
é bloqueada em 409 enquanto o projeto está em uso. Deve-se aguardar ou cancelar
explicitamente pelos endpoints existentes. O servidor não cancela implicitamente.

A UI exige confirmação com título, escopo e estimativa atual de espaço. Exclusão
de outputs preserva vídeo, transcript e análise e invalida estados/cache de jobs.
Excluir só o original **não é oferecido**, pois re-renderização depende dele.
Na exclusão completa, todos os outputs do ID são removidos antes dos arquivos do
upload; outros IDs são preservados. Falha retorna `DELETE_PARTIAL` e `freedBytes`,
sem afirmar sucesso completo. A exclusão de uma árvore inteira não é uma transação
do filesystem: `unlink` é individual; pré-validação e bloqueio protegem consistência
contra os serviços da mesma API. Bibliotecas com arquivos inválidos exibem avisos.
Use uma instância da API por storage privado; não há coordenação entre processos
nem garantia contra um usuário local alterando os paths simultaneamente.

## Quotas e recuperação

Uploads usam `UPLOAD_QUOTA_BYTES`: **16 GiB** padrão. Outputs usam
`OUTPUT_STORAGE_QUOTA_BYTES`: **4 GiB** padrão, inteiro positivo de bytes, validado
no startup. São quotas lógicas; não representam a capacidade física do disco.
Outputs/manifestos e `.work` contam juntos. Cada clip reserva seu orçamento por
duração + até 16 MiB de manifesto antes do render, mais até 32 MiB quando houver
asset musical local para copiar. O storage verifica espaço
físico via `statfs` com margem de 64 MiB; falta física retorna `DISK_FULL`.
Os limites `-fs`, quota durante upload, streaming, checksums e cleanup próprio
continuam ativos. Nenhuma quota é aumentada automaticamente.

`UPLOAD_STORAGE_QUOTA` identifica uploads cheios; `OUTPUT_QUOTA` equivale a
quota lógica dos cortes. O status de erro de output contém `usedBytes`,
`limitBytes`, `requiredBytes` (estimativa conservadora do próximo corte/manifesto)
e `projectCount` (projetos com diretório de outputs). O web oferece Biblioteca
e Tentar novamente. Armazenamento não é tratado como API offline.

Cada corte validado recebe MP4 com checksum e commit em manifesto antes do
próximo. `requestedIds` registra a seleção completa mesmo em lotes parciais.
Estados `processing-portfolio.json`/`processing-legacy.json` são persistidos
atomicamente, limitados a 128 KiB, com hash, checksum da fonte, seleção, estilo,
quantidade e causa real da falha. Seu tamanho conta na quota de uploads.
No restart, uma tentativa não concluída exige retry explícito. Não há fila nem
retomada automática. Falha de disco ao salvar o estado é registrada; o manifesto
dos cortes já publicados continua sendo a fonte para recuperação.

Retry reutiliza ASR/análise existentes e MP4s do mesmo lote **somente** se fonte,
report, versão de render, preferências, seleção, plano e hashes forem compatíveis.
Clips concluídos permanecem no mesmo path sem cópia/re-render. Renderiza apenas
os pendentes; mudança de plano/versão inicia outro lote. O manifesto atualizado
é substituído atomicamente após o link exclusivo do novo MP4. Crash entre link e
commit pode deixar arquivo não referenciado; ele não é apresentado como corte
concluído nem substituído silenciosamente. A exclusão explícita de outputs permite
resolver esse estado preservando o original e os artefatos de análise.

Projetos salvos não expiram por idade na API padrão. Cleanup de parciais criados
pela operação e de `.work` após crash permanece; não apaga lotes concluídos.
Não se adicionou retenção automática/favoritos. Artefatos removidos por versões
anteriores não são recriados a partir de um corte.

## Verificação

```powershell
pnpm.cmd typecheck
pnpm.cmd build
node --test --test-concurrency=1 apps/api/tests/library.test.mjs
pnpm.cmd --filter @clipador-ia/api exec tsx --test ../web/tests/library.test.ts
node scripts/library/validate.mjs
```

O último comando requer API/web locais e verifica projetos reais sem excluir
dados. O teste nativo usa apenas fixtures: cria quota cheia após o primeiro clip,
reinicia a API, exclui outro projeto de teste, retoma o segundo, verifica mtime,
checksum e metadata do primeiro, testa ranges e exclusão só de outputs. Os
resultados são gravados em `.data/library-validation/*/result.json`.
