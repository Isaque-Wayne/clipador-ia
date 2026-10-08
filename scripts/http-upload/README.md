# Validação HTTP do upload

Scripts sem dependências novas para executar web → proxy → API → streaming → storage em processos reais. Não automatizam o navegador nem substituem a verificação visual da página `/upload`.

## Executar no PowerShell

Use Node.js 24 (versão validada: 24.21.0) e as dependências já instaladas. As portas 3010 e 3011 precisam estar livres. Não encerre processos de outras sessões para liberar portas.

```powershell
pnpm.cmd --filter @clipador-ia/api build
New-Item -ItemType Directory -Force apps/api/.data | Out-Null
curl.exe --fail --location --output apps/api/.data/http-flower.mp4 https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4
$env:API_BASE_URL = 'http://127.0.0.1:3011'
pnpm.cmd --filter @clipador-ia/web build
node scripts/http-upload/run.mjs
Remove-Item Env:API_BASE_URL
pnpm.cmd build
```

O comando de download grava somente a fixture local; se ela já existir, reutilize-a. O último build restaura o endereço habitual da API nas rewrites do Next, pois esse endereço é incorporado no build. O runner não instala dependências, não utiliza o storage habitual e encerra apenas os processos que iniciou. A execução leva aproximadamente dois minutos, incluindo a espera real de 90 segundos.

Cada execução conserva seus vídeos, `results.json`, `api.log` e `web.log` em `apps/api/.data/http-runs/<data>/`. O diretório é ignorado pelo Git. Não há exclusão automática desses artefatos pelo runner. Com o limite padrão atual de 4 GiB, reserve aproximadamente 8,2 GiB de espaço livre para a execução; os resultados completos conservam aproximadamente 4,1 GiB. A quota isolada do runner é duas vezes o limite resolvido de `UPLOAD_MAX_FILE_BYTES`, para que o teste excedido alcance a validação de tamanho sem ser bloqueado antes pela quota; isso não altera a quota padrão da aplicação. Para outro limite, ajuste a estimativa de disco proporcionalmente e use o mesmo ambiente no build do web e na execução do runner.

## Responsabilidades

- `run.mjs`: cenários, assertions, checksum esperado e relatório.
- `http-client.mjs`: cliente HTTP com chunks de 64 KiB, pausa, atraso e desconexão.
- `api-process.mjs`: API isolada, configuração e amostragem de memória via IPC.
- `processes.mjs`: inicialização e encerramento dos processos de teste.
- `storage-observation.mjs`: leitura dos bytes lógicos, parciais e metadados no diretório de teste.

Os vídeos grandes usam o MP4 público da MDN como prefixo e padding em uma caixa MP4 `free`, gerado por chunks. Os testes validam transporte e integridade dos bytes; não decodificam o vídeo. A fixture pequena é mantida inteira no cliente de testes, mas o payload grande não é criado como um único Buffer.

Memória da API é amostrada a cada 200 ms (`rss`, `external`, `arrayBuffers`). Casos muito rápidos podem não conter amostras; valores ausentes não significam zero. Disco é a soma dos tamanhos dos arquivos, sem contabilizar overhead do filesystem. Cada cenário com desconexão/timeout verifica o retorno ao tamanho anterior antes de enviar um novo vídeo para confirmar a liberação da vaga.

## Verificação visual pendente

Em um navegador, abra `/upload`, selecione o MP4 pequeno, envie e confira nome, tamanho, tipo, ID e estado final exibidos pela interface. Confira o checksum no JSON da resposta pela aba Network. Confira também a rejeição de arquivo vazio, tipo inválido e tamanho superior ao limite configurado (4 GiB por padrão). O runner cobre essas respostas pela rede, mas não executa os eventos do formulário nem a renderização visual.

Resultado histórico da execução com limite de 50 MiB: [relatório](./report-2026-10-06.md). As medições daquele relatório não representam uma execução com o limite novo. O cenário próximo do limite atual não introduz atraso artificial, para não exceder deliberadamente o timeout de 90 segundos.
