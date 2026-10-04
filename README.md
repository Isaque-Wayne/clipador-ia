# Clipador IA

Fundação de um monorepo TypeScript para aprendizado e evolução do Clipador IA.
Esta fase contém somente uma página inicial, uma API com rota de saúde e o
bootstrap do worker. Não há funcionalidades de produto implementadas.

## Organização

- `apps/web`: interface com Next.js e React.
- `apps/api`: API Node.js com Fastify.
- `apps/worker`: bootstrap Node.js para futuro processamento.
- `app/`: estrutura anterior preservada; não faz parte do workspace pnpm.
- `docs/` e `packages/`: diretórios existentes, ainda sem conteúdo.
- `package-json-backup/`, `README-backup/` e `AGENTS-backup/`: diretórios vazios
  renomeados com autorização para liberar nomes de arquivos na raiz.

Cada aplicação tem suas dependências e configurações. Somente `apps/*` integra
o workspace neste momento; pacotes compartilhados serão adicionados quando
existir código realmente compartilhado.

## Ferramentas e dependências

Requisitos declarados: Node.js 22 ou superior e pnpm 10.
As dependências foram apenas declaradas, sem instalação nesta etapa.
As faixas de versões permitem atualizações compatíveis; uma instalação futura
gerará `pnpm-lock.yaml`, que deverá ser versionado para reproduzir a resolução.

Web utiliza Next.js 16 e React 19. A API utiliza Fastify 5. TypeScript está
declarado em cada aplicação; `tsx` permite executar TypeScript no desenvolvimento
da API e do worker. Não há biblioteca de UI, fila, banco, autenticação ou IA.

## Comandos preparados

Os comandos abaixo são documentação. Não foram executados. Instalar ferramentas
ou dependências exige autorização explícita; iniciar serviços também deve estar
no escopo autorizado.

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
esperada é `{"status":"ok"}`. Não há script de lint configurado nesta fase.

## Configurações e decisões

- `tsconfig.base.json` ativa tipagem estrita, tratamento cuidadoso de propriedades
  opcionais e de acesso por índice; nenhuma regra é desligada para ocultar erros.
- Web usa resolução `Bundler`; API e worker usam ESM com resolução `NodeNext`.
  Imports relativos na API usam `.js`, correspondendo aos arquivos compilados.
- Imports `import type` deixam explícito o que existe apenas para o compilador.
- A API separa criação da instância, registro de rotas e inicialização.
- `PORT` é opcional, validado na inicialização e tem padrão `3001`. Nenhum arquivo
  de ambiente foi criado ou modificado. Não existe carregador de `.env` configurado.
- A API escuta somente no endereço local. Não há integração web/API nesta fase.
- O worker não mantém um processo ocioso: executa o bootstrap e encerra.
- A interface utiliza CSS e fontes do sistema, sem dependência adicional.

## Fora do escopo atual

Upload, player, FFmpeg, filas, transcrição, IA, análise de potencial, sugestões
de edição, legendas, renderização e exportação serão tratados em etapas futuras.
Uma avaliação futura de potencial não representa garantia de viralização.
