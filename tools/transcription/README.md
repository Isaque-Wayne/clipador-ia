# Engine local de transcrição

Python x64 **3.13.15**, faster-whisper **1.2.1**, PyAV **16.1.0**,
CTranslate2 **4.8.2**, ONNX Runtime **1.30.0**. Modelo multilíngue `small`,
CPU `int8`, até quatro threads, beam size 5 e word timestamps.

O runtime completo foi extraído do [ZIP oficial do Python](https://www.python.org/ftp/python/3.13.15/python-3.13.15-amd64.zip)
após conferir seu SHA-256 contra o manifesto oficial em
`downloads/windows-3.13.15.json`. Não foi usado instalador, registro, PATH,
launcher ou instalação global. `python/`, `venv/`, modelos e o ZIP estão ignorados
no Git. Os binários devem permanecer dentro deste projeto.

`installation.json` registra versões, licenças declaradas pelos pacotes, origem,
revisão, tamanhos e SHA-256 do modelo. `requirements.lock.txt` fixa todas as
dependências instaladas; `requirements.txt` explicita engine e PyAV compatível.
As distribuições instaladas também preservam seus próprios arquivos de licença
no venv. Python: PSF-2.0; faster-whisper e modelo convertido: MIT. PyAV usa BSD;
as bibliotecas FFmpeg incluídas em seu wheel têm licenças próprias, que também
precisam ser consideradas em uma futura redistribuição dos binários.

O modelo ocupa **486.214.370 bytes** (486,2 MB), incluindo configuração,
tokenizador, vocabulário e README. Origem:
[Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small),
revisão `536b0662742c02347bc0e980a01041f333bce120`.

## Reproduzir em outra cópia do projeto

Estes comandos instalam dependências; executar somente com autorização de
instalação no ambiente de destino. Extrair o ZIP verificado em `python/` antes:

```powershell
& ./tools/transcription/python/python.exe -m venv ./tools/transcription/venv
& ./tools/transcription/venv/Scripts/python.exe -m pip install --only-binary=:all: -r ./tools/transcription/requirements.lock.txt
& ./tools/transcription/venv/Scripts/python.exe -m pip check
& ./tools/transcription/venv/Scripts/python.exe ./tools/transcription/install-model.py
```

`install-model.py` é uma ação explícita de setup, com downloads públicos;
nunca é chamado pela API. A engine recebe o diretório local do modelo,
`local_files_only=True` e `HF_HUB_OFFLINE=1`. Não usa chave ou serviço de
inferência externo. A detecção de fala usa o Silero VAD incluído na distribuição.

PyAV 19 não é compatível com a chamada `metadata_errors` desta versão de
faster-whisper. O problema foi reproduzido no smoke test e há
[registro no projeto oficial](https://github.com/SYSTRAN/faster-whisper/issues/1492).
PyAV 16.1.0 passou no teste real; não atualizar o lock sem repetir esse teste.

O entrypoint `engine.py` produz somente JSON em UTF-8 no stdout e diagnósticos
no stderr. A API inicia Python com `-I -X utf8`, `shell: false`, argumentos
separados e paths internos controlados. Alterações no modelo ou no runtime
exigem atualizar o registro e repetir a validação.
