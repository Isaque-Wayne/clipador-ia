# yt-dlp local

Executável autorizado instalado em `tools/yt-dlp/yt-dlp.exe`, sem instalação global.

- Versão: **2026.08.19**.
- SHA-256: `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`.
- Release oficial: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
- Executável oficial: https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe
- Manifesto oficial: https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/SHA2-256SUMS

O SHA-256 foi comparado ao manifesto oficial antes de executar `--version`. O arquivo `installation.json` registra versão, origem e hash esperado; a API confere novamente o executável contra esse registro antes de cada invocação. `SHA2-256SUMS` conserva o manifesto publicado e `release.json` a resposta da API oficial do GitHub. O executável é ignorado pelo Git; os registros podem ser versionados. Não há auto-update, download de scripts remotos ou instalação implícita.

O binário oficial inclui Python e EJS. A integração usa o Node já instalado como runtime JavaScript. Não requer FFmpeg para os formatos suportados nesta etapa. Referência: https://github.com/yt-dlp/yt-dlp/wiki/EJS

Em produção, provisione o binário oficial compatível com o sistema operacional e um `installation.json` correspondente, após verificar o SHA-256 publicado. `YTDLP_PATH` permite configurar o caminho do executável; seu manifesto deve ficar ao lado dele. Permissões devem impedir alteração desses arquivos pelo processo da API. Uma atualização exige nova verificação e atualização do registro; não é feita pela aplicação. Verifique as licenças da distribuição utilizada: o executável Windows inclui componentes sob GPLv3+, conforme documentação do projeto.
