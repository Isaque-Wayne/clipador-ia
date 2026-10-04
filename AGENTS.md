# Instruções para agentes — Clipador IA

## Modo equilibrado

Antes de ações de baixo risco, informar brevemente o que será feito, o motivo
e o risco; executar em seguida e apresentar o resultado. Não exigir autorização
separada para cada pequena ação já abrangida pelo pedido.

Ações normalmente de baixo risco: ler e listar arquivos, analisar código,
criar pastas e arquivos que não sobrescrevam conteúdo, adicionar código em
arquivos recém-criados, consultar versões, executar typecheck, lint ou build.
Não instalar dependências implicitamente ao executar verificações.

Pedir autorização explícita antes de excluir, sobrescrever conteúdo importante,
mover ou renomear código existente, alterar significativamente a arquitetura,
instalar/remover/atualizar dependências ou ferramentas, modificar bancos ou
executar migrations, alterar ambiente real, secrets ou credenciais, executar
comandos destrutivos, commit, push, merge, rebase, reset, deploy ou alterações
de infraestrutura. Em dúvida sobre risco relevante, explicar e aguardar.

Para risco médio ou alto, apresentar arquivos afetados/criados, motivo, impacto,
riscos e validação antes de executar. Perguntas não significam autorização.

## Escopo e preservação

- Preservar `app/` intacto e os diretórios de backup até nova autorização.
- A fundação em `apps/` foi autorizada; instalação de ferramentas e dependências
  não foi autorizada nesta etapa.
- Não implementar funcionalidades de produto sem pedido específico.
- Não descartar alterações existentes nem enviar mensagens externas sem autorização.

## Arquitetura e TypeScript

- Monorepo pnpm: `apps/web`, `apps/api` e `apps/worker`.
- Uma feature por pasta principal; responsabilidades diferentes em arquivos
  diferentes. Criar subpastas apenas para submódulos relevantes.
- Evitar arquivos gigantes, depósitos genéricos de código e fragmentação sem motivo.
- Páginas e layouts em `apps/web/src/app`; features futuras em `src/features`.
- API: separar criação, registro de rotas e inicialização em `src/server`.
- Criar pacotes compartilhados somente com necessidade real.
- Priorizar tipos claros, funções pequenas, `import type`, validação de dados
  externos e tratamento de `null`/`undefined`. Evitar `any` e não enfraquecer
  TypeScript para eliminar erros.
- Explicar brevemente decisões importantes para apoiar o aprendizado do usuário.
- Não acrescentar IA, FFmpeg, filas, banco, autenticação, UI library ou Turborepo
  sem necessidade concreta e aprovação.

## Validação e comunicação

- Executar verificações adequadas somente quando ferramentas e dependências
  estiverem disponíveis, respeitando o escopo autorizado.
- Informar limitações reais; não afirmar que typecheck/build passaram sem execução.
- Não iniciar servidores se isso não estiver autorizado no pedido.
- Manter documentação e comandos coerentes com a implementação.
- Não garantir viralização em funcionalidades futuras de análise de potencial.
