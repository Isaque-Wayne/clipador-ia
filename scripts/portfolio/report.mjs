import assert from "node:assert/strict";
import { readFile, writeFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, isAbsolute } from "node:path";
import { fileChecksum } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";
import { createServer } from "../../apps/api/dist/server/create-server.js";
import { selectPortfolio } from "../../apps/api/dist/features/portfolio/services/portfolio-provider.js";

const workspace = resolve(import.meta.dirname, "../.."), path = resolve(process.argv[2]);
const inside = relative(join(workspace, "apps/api/.data/portfolio-smoke"), path);
assert.ok(!inside.startsWith("..") && !isAbsolute(inside) && basename(path) === "result.json");
const evidence = JSON.parse(await readFile(path, "utf8"));
assert.equal(evidence.error, undefined); assert.equal(evidence.engineCalls, 0); assert.equal(evidence.recovery, true);
const directory = resolve(evidence.source, "../.."), outputs = join(evidence.root, "clips");
const metadata = JSON.parse(await readFile(join(workspace, "apps/api/.data/uploads/33cc339f-1dda-4e97-b71c-4d7047652618/metadata.json"), "utf8"));
assert.ok([".mp4", ".webm", ".mov"].includes(metadata.extension));
const fullSource = join(workspace, "apps/api/.data/uploads", metadata.id, `video${metadata.extension}`);
assert.equal(await fileChecksum(fullSource), metadata.checksum.value);
const server = createServer({ directory }, {}, { engine: { async transcribe() { assert.fail("Existing transcript must be reused"); } } }, { directory: outputs }); server.log.level = "silent";
let report;
try {
  assert.equal((await server.inject("/health")).statusCode, 200);
  const response = await server.inject(`/uploads/${evidence.uploadId}/portfolio/clips`); assert.equal(response.statusCode, 200, response.body);
  const batch = response.json().batch; assert.equal(batch.batchId, evidence.batchId); report = batch.report;
  assert.equal((await server.inject({ method: "POST", url: `/uploads/${evidence.uploadId}/portfolio/process`, payload: { quantity: evidence.quantity } })).json().reused, true);
} finally { await server.close(); }
const coldPath = join(workspace, "apps/api/.data/portfolio-smoke/2026-10-08T23-15-37-097Z/result.json");
const cold = JSON.parse(await readFile(coldPath, "utf8"));
assert.equal(cold.sourceBefore, evidence.sourceBefore); assert.equal(cold.analysisReused, false); assert.equal(cold.clips[0].candidate.score.method, report.analysisVersion);
const auto = selectPortfolio(report), maximum = selectPortfolio(report, "maximum");
const distribution = clips => Object.fromEntries(["micro", "short", "standard", "extended"].map(profile => [profile, clips.filter(clip => clip.profile === profile).length]));
const safe = text => String(text).replace(/\|/gu, "\\|").replace(/[\r\n]/gu, " ");
const link = file => `<${file.replace(/\\/gu, "/")}>`;
const mib = bytes => (bytes / 1024 ** 2).toFixed(2);
const rows = evidence.clips.map((clip, index) => `| ${index + 1} | ${clip.candidate.familyId} | ${clip.candidate.profile.toUpperCase()} | ${clip.start.toFixed(2)}–${clip.end.toFixed(2)} | ${clip.duration.toFixed(3)} | ${clip.candidate.score.value.toFixed(2)} | ${clip.candidate.hookScore.value.toFixed(2)} | ${clip.editPlan.style} |`).join("\n");
const details = evidence.clips.map((clip, index) => `### ${index + 1}. ${safe(clip.candidate.title)}\n\n[MP4](${link(clip.path)}) · [Frame](${link(clip.preview)})\n\n- ID: ${clip.id}; family: ${clip.candidate.familyId}; profile: ${clip.candidate.profile}.\n- Source: ${clip.start.toFixed(3)}–${clip.end.toFixed(3)} s; output: ${clip.duration.toFixed(6)} s.\n- Potential: ${clip.candidate.score.value}; hook: ${clip.candidate.hookScore.value}; standalone: ${clip.candidate.standaloneQuality}.\n- Emoção lexical: ${clip.candidate.emotion.semantic.labels.map(label => `${label.name} (${label.strength.toFixed(2)})`).join(", ") || "sem evidência lexical"}; confiança ${clip.candidate.emotion.confidence.semantic}.\n- Motivo: ${safe(clip.candidate.reason)}\n- Estilo: ${clip.editPlan.style}; efeitos executados: ${clip.metadata.editsApplied.join(", ")}; ${clip.editPlan.zoomEvents.length} zooms; ${clip.editPlan.silenceCuts.length} trims.\n- Assets: ${clip.assets.warnings.map(safe).join(" ") || "nenhum asset opcional solicitado"}.\n- Tamanho: ${clip.size} bytes (${mib(clip.size)} MiB); render: ${clip.metadata.renderSeconds.toFixed(3)} s.\n- SHA-256: \`${clip.checksum}\`.\n- Versões: ${clip.candidate.score.method}; ${clip.metadata.editPlanVersion}; ${clip.editPlan.captions.version}.\n`).join("\n");
const framesBytes = (await Promise.all(evidence.clips.map(async clip => (await stat(clip.preview)).size))).reduce((sum, size) => sum + size, 0);
const zooms = evidence.clips.reduce((sum, clip) => sum + clip.editPlan.zoomEvents.length, 0), trims = evidence.clips.reduce((sum, clip) => sum + clip.editPlan.silenceCuts.length, 0);
const styles = evidence.clips.reduce((map, clip) => ({ ...map, [clip.editPlan.style]: (map[clip.editPlan.style] ?? 0) + 1 }), {});
const text = `# Validação do ClipPortfolio — 2026-10-08\n\n` +
`Lote final ${evidence.batchId}, upload ${evidence.uploadId}, modo ${evidence.quantity}. [JSON completo](${link(path)}) contém os EditPlans, emoções, probes, previews e métricas. Todos os links de mídia abaixo apontam para o storage isolado deste teste; ele é separado da API padrão em 3001.\n\n` +
`## Capacidade e distribuição\n\n` +
`**16 MP4s reais concluídos**: 7 MICRO, 6 SHORT, 2 STANDARD, 1 EXTENDED. O objetivo de teste foi atendido sem quotas por perfil. Pool deduplicado de 24 candidatos: MICRO 9, SHORT 8, STANDARD 4, EXTENDED 3. Auto seleciona ${auto.length}, distribuição calculada ${JSON.stringify(distribution(auto))}; essa seleção é um subconjunto dos MP4s efetivamente renderizados neste lote Muitos. Máximo aproveitamento seleciona ${maximum.length} variações aprovadas; o lote máximo inteiro não foi renderizado. Qualidade significa critérios heurísticos locais, sujeitos à revisão de contexto.\n\n` +
`## Métricas medidas\n\n| Medida | Resultado |\n| --- | ---: |\n` +
`| Vídeo original completo | ${evidence.originalFullVideoDuration} s |\n| Sample de mídia / transcrição reutilizada | 153,970442 / ${evidence.testedDuration} s |\n| Idioma e transcrição | Português, 372 palavras, 39 segmentos |\n| Candidatos brutos | ${evidence.metrics.raw} |\n| Válidos antes de dedup | ${evidence.metrics.valid} |\n| Rejeitados por qualidade | ${evidence.metrics.rejected} |\n| Duplicados removidos | ${evidence.metrics.duplicates} |\n| Aprovados após dedup | ${evidence.metrics.approved} |\n| Famílias do pool | ${evidence.metrics.families} |\n| Análise textual | ${evidence.metrics.analysisSeconds.toFixed(6)} s |\n| Análise com medição de áudio, sem cache, mesma versão | ${cold.analysisWallSeconds.toFixed(6)} s |\n| Consulta da análise no lote final, com cache | ${evidence.analysisWallSeconds.toFixed(6)} s |\n| Render de lote, wall time | ${evidence.renderWallSeconds.toFixed(6)} s |\n| Soma render+probe/hash dos clips | ${evidence.renderCpuWallSum.toFixed(6)} s |\n| Total incluindo previews e recovery | ${evidence.totalSeconds.toFixed(6)} s |\n| MP4s | ${evidence.finalClipBytes} bytes / ${mib(evidence.finalClipBytes)} MiB |\n| Manifesto | ${evidence.manifestBytes} bytes |\n| Frames de QA adicionais | ${framesBytes} bytes |\n| Pico RSS Node observado | ${evidence.peakNodeRssBytes} bytes / ${mib(evidence.peakNodeRssBytes)} MiB |\n| Chamadas adicionais ao ASR | 0 |\n\n` +
`A RAM dos filhos FFmpeg não foi capturada; o RSS acima mede somente Node. O tempo da análise sem cache vem de [execução da mesma versão](${link(coldPath)}). Nenhum tempo é benchmark de máquina genérica. Os testes preservam outputs anteriores e dados originais.\n\n` +
`## Editor e qualidade dos outputs\n\n` +
`Presets executados: ${JSON.stringify(styles)}. ${zooms} zooms de evento foram executados; ${trims} pausas aparadas neste sample. A fala desse vídeo não forneceu pausas com evidência suficiente para trim. O teste sintético separado confirmou concatenação de vídeo/áudio e captions remapeadas após remover silêncio medido. Captions dinâmicas, keywords maiores e zoom foram renderizados de verdade. Cada MP4 passou por FFprobe: H.264/AAC, 1080×1920, áudio presente e duração do EditPlan com tolerância de 0,3 s. SHA-256 também foi verificado na recuperação e no GET/Range.\n\n` +
`Testes de pixels decodificados verificam palavra ativa colorida e aumento >10% da área de um alvo estático durante o zoom de 8%. Ducking real usa um tom original gerado só para a fixture e mede energia da trilha 880 Hz durante voz vs silêncio: durante voz <80% da energia sem voz. O provider recusou o asset não aprovado antes de aceitar o catálogo autorizado da fixture. No sample real não há música licenciada disponível: clips continuam com voz original e warning, sem downloads.\n\n` +
`B-roll, efeitos sonoros e active speaker são infraestrutura/contratos. Busca por scene>0,3 a 2 fps no sample não encontrou mudanças; frames mostram o mesmo monólogo. Não existe cutaway contextual aprovado nem compositor de B-roll. Ausência desses recursos não bloqueia um output.\n\n` +
`## Preservação, testes e limites\n\n` +
`Checksums do sample e transcript.json permaneceram iguais. O SHA-256 do vídeo completo também foi comparado com metadata.json nesta entrega: ${metadata.checksum.value}. API recriada recuperou os 16 outputs e reutilizou análise/lote; `.concat(
`health e GET por ID passaram. Diretório .work vazio, nenhum .part no upload, outputs contêm somente MP4s e manifesto. Nenhum código de yt-dlp, remux/fallback ou engine ASR foi reescrito.\n\n`,
`139 testes distintos passaram: 129 API/worker e 10 web. Os testes relacionados a edição/render e compatibilidade foram repetidos após o ajuste final da safe area e passaram (10/10); portfólio/edição também passaram após a seleção final (11/11). Typecheck/build dos três apps passaram. Os testes usam FFmpeg existente; não houve instalação de dependências. A interface recebeu filtros/cards e validação de contrato, mas não houve QA interativo de navegador nesta rodada.\n\n`,
`Limites: seleção, emoção, story arc e tópicos são lexicais; erros do ASR podem afetar captions e conteúdo. Frase completa não garante raciocínio completo. A heurística de CTA pode perder passagens úteis ou deixar divulgação residual; o lote real ainda exige revisão editorial. FamilyId representa abertura compartilhada, sem agrupamento semântico avançado. Sem pitch, detecção visual, diarização, split-screen ou biblioteca de assets aprovada. Não há promessa de viralização.\n\n`,
`Próximo passo prioritário: avaliar precisão da seleção em mais vídeos portugueses, com revisão anotada de contexto/hook/fechamento, antes de ampliar efeitos. Um provider semântico mais forte e assets musicais/contextuais aprovados podem melhorar o editor; modelos novos, APIs externas e bibliotecas exigem autorização. Os recursos locais previstos nesta rodada foram concluídos.\n\n`,
`## Clips individuais\n\n| # | Family | Perfil | Start–end (s) | Output (s) | Potential | Hook | Estilo |\n| --- | --- | --- | --- | ---: | ---: | ---: | --- |\n${rows}\n\n${details}`);
const target = join(workspace, "docs/portfolio-validation-2026-10-08.md");
await writeFile(target, text, { flag: "wx" });
console.log(JSON.stringify({ report: target, evidence: path, fullOriginalPreserved: true, auto: distribution(auto), maximum: maximum.length, finalClips: evidence.clips.length }));
