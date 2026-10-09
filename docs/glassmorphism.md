# Sistema visual Glassmorphism

O visual usa fundo grafite, luz ambiente discreta, superfícies translúcidas e
acento lavanda suave. A mudança é de apresentação: hooks, serviços, validação,
rotas de API, storage e processamento foram preservados.

## Arquivos criados

- `apps/web/src/styles/tokens.css`: identidade e valores compartilhados.
- `apps/web/src/styles/surfaces.css`: quatro níveis de superfície e fallbacks.
- `apps/web/src/styles/controls.css`: botões, inputs, foco, erros e status.
- `apps/web/src/components/site-header.tsx` e `site-header.module.css`: header
  compartilhado, sticky, navegação e marca.
- `docs/glassmorphism.md`: este registro.

## Arquivos visuais alterados

- `apps/web/src/app/globals.css` e `layout.tsx`.
- `apps/web/src/app/page.tsx` e `page.module.css`.
- `apps/web/src/app/upload/page.tsx` e `page.module.css`.
- `apps/web/src/features/product-intro/components/product-preview.tsx` e
  `product-preview.module.css`.
- `apps/web/src/features/video-input/components/video-input.tsx` e
  `video-input.module.css`.
- `apps/web/src/features/video-upload/components/video-upload-form.tsx` e
  `video-upload-form.module.css`.
- `apps/web/src/features/video-upload/components/upload-result.tsx` e
  `upload-result.module.css`.
- `apps/web/src/features/youtube-ingestion/components/youtube-ingestion-form.tsx`
  e `youtube-ingestion.module.css`.

## Tokens e uso

| Responsabilidade | Tokens principais |
| --- | --- |
| Fundo | `--background`, `--background-light` |
| Vidro | `--glass-background`, `--glass-panel-background`, `--glass-elevated-background`, `--glass-subtle-background`, `--glass-opaque` |
| Bordas e iluminação | `--glass-border`, `--glass-highlight`, `--hover-border` |
| Blur | `--blur` (18px), `--blur-elevated` (24px) |
| Sombras | `--shadow`, `--shadow-elevated`, `--shadow-inset` |
| Raios | `--radius`, `--radius-control`, `--radius-small` |
| Texto | `--text-primary`, `--text-secondary` |
| Interação | `--accent`, `--accent-ink`, `--hover`, `--focus`, `--duration` |
| Estados | `--success`, `--error`, `--error-background`, `--error-border` |
| Espaçamento e largura | `--space-1` a `--space-8`, `--page-width`, `--form-width` |

Use `glass-surface` nos painéis externos, `glass-panel` nos resultados,
`glass-subtle` em áreas secundárias e `glass-elevated` no header e em futuros
elementos flutuantes. Os painéis internos não adicionam blur: bordas, preenchimento
e highlights dão profundidade sem multiplicar filtros.

Use `button-primary`, `button-secondary` e `button-ghost` para as hierarquias de
ação. Foco, hover, active e disabled estão centralizados. O seletor de origem
mantém seu estado acessível por `aria-pressed`; status e erros preservam regiões
de anúncio. Não há porcentagens ou etapas de processamento fictícias.

## Responsividade e acessibilidade

- Hero em duas colunas no desktop e uma coluna abaixo de 760px.
- Navegação e espaçamento compactos no celular, controles com altura mínima
  de 44px e textos longos com quebra nos resultados.
- Header e painéis usam fundo opaco e desativam blur em larguras até 600px.
- Sem suporte a `backdrop-filter`, os níveis de vidro usam fundo opaco.
  Há também a propriedade prefixada para implementações WebKit.
- `prefers-reduced-transparency` torna superfícies opacas quando suportado.
- `prefers-reduced-motion` remove transições; não há animações contínuas.
- Foco visível, link para pular ao conteúdo, bordas em modo de cores forçadas
  e scrollbar com cores nativas, sem diminuir sua largura.

## Validação

Executados em 08/10/2026, sem instalar dependências:

- `pnpm.cmd typecheck`: passou em web, API e worker.
- `pnpm.cmd build`: passou em web, API e worker.
- `node --test apps/web/tests/*.test.ts`: 7 testes passaram.
- `git diff --check`: sem erros de whitespace.

Os testes cobrem validação e proxies de upload/YouTube, incluindo stream,
cancelamento, erros e parsing dos resultados; não substituem um envio real
nem a inspeção interativa no navegador. A revisão visual em diferentes larguras
e os estados interativos ainda dependem de um servidor local autorizado.

O Node emite um aviso já existente sobre inferência de módulo nos testes;
nenhuma configuração de pacote foi alterada para silenciá-lo. Não houve medição
de GPU ou validação em dispositivos físicos. O blur fica limitado a duas
superfícies externas por página e é desativado no celular por precaução de custo.
