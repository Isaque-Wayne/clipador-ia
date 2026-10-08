# FFmpeg / FFprobe locais

Build Windows x64 estático LGPL do BtbN, fornecedor indicado em https://ffmpeg.org/download.html.
Fonte e release: `installation.json`; checksum publicado: `downloads/checksums.sha256`.
O arquivo ZIP foi conferido antes de executar os binários. Hashes locais dos executáveis também foram registrados.
Versão de ambos: `n9.0.2-22-g46d8f462ee-20261006`. Licença: LGPL v3, texto em `LICENSE.txt`.

Executáveis em `bin/`, sem instalação global, alteração de PATH ou pacote npm.
O código verifica os hashes antes de cada uso e chama as ferramentas com spawn, argumentos separados e shell: false.
FFmpeg só faz remux com `-c copy`; FFprobe valida streams, tamanho e duração. Nenhum reencode de produto.
Para produção em outro sistema operacional, instalar e verificar o build correspondente; os binários desta pasta são Windows x64.
Antes de redistribuir o pacote, observar a licença e disponibilização do código-fonte correspondente indicada pelo fornecedor.
