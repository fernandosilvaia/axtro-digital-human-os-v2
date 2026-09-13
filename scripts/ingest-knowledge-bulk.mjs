#!/usr/bin/env node
/**
 * Ingestão em lote de conhecimento (RAG) por um diretório de arquivos .md.
 *
 * POR QUE ESTE SCRIPT EXISTE
 * A única via de ingestão até aqui era a UI (/conhecimento), um formulário por
 * fonte. Carregar uma base de domínio inteira por lá é trabalho manual repetido
 * e sem registro. Este script roda EXATAMENTE o mesmo caminho do server action
 * `createKnowledgeSource`: mesmo chunking, mesmo modelo de embedding, mesmas
 * RPCs. Não existe caminho de escrita paralelo nem RPC nova: `portal_create_
 * knowledge_source` e `portal_ingest_knowledge` são gated em `auth.uid()` de
 * propósito, então o script autentica como a conta de máquina do tenant em vez
 * de contornar a regra com service_role.
 *
 * CREDENCIAIS
 * Nada é lido de arquivo nem passado por argumento. As variáveis vêm do
 * ambiente do processo, e a forma pretendida de rodar é deixando o Railway
 * injetá-las:
 *
 *   railway run -- node scripts/ingest-knowledge-bulk.mjs <dir> --dry-run
 *   railway run -- node scripts/ingest-knowledge-bulk.mjs <dir> --apply
 *
 * Exige: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * DEMO_EMAIL, DEMO_PASSWORD, OPENROUTER_API_KEY.
 *
 * NOME DA FONTE
 * Vem do nome do arquivo, sem o prefixo numérico de ordenação e sem extensão:
 * `01-limites-regulatorios.md` vira "Limites regulatorios". O prefixo é
 * PRIORIDADE, e por isso a criação é feita em ordem DECRESCENTE de nome:
 * `portal_knowledge_digest` ordena as fontes por `created_at desc`, então a
 * última criada é a primeira a entrar na janela do digest. Criando 05, 04, 03,
 * 02 e por fim 01, o arquivo 01 fica no topo. Criar na ordem natural inverteria
 * a prioridade em silêncio, que é o tipo de erro que ninguém percebe até a
 * agente citar o material menos importante primeiro.
 *
 * RE-EXECUÇÃO
 * Idempotente por nome: se a fonte já existe, o script reaproveita o id e
 * re-ingere, o que substitui a versão anterior atomicamente (a própria RPC faz
 * delete+insert sob FOR UPDATE). Nenhuma fonte é apagada por este script.
 *
 * ORÇAMENTO DE IA
 * A UI reserva orçamento em `ai_usage` antes de embedar. Este caminho de
 * operação não reserva: é carga pontual feita pelo operador, não fluxo
 * disparado por tenant. O teto por documento continua valendo porque
 * `embedChunks` aplica `assertEmbeddingInputsWithinReservedBudget` sozinho.
 */

import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

// Import pelo build, nao por "@axtro/domain" nem pelo fonte: o symlink do
// workspace existe em apps/portal e nao em scripts/, e ids.ts usa parameter
// property, que o type stripping do Node nao suporta. knowledge.ts resolve o
// pacote pelo nome porque ela propria mora dentro de apps/portal.
import { createUuidV7 } from "../packages/domain/dist/index.js";

import { chunkContent, contentSha256, embedChunks } from "../apps/portal/src/lib/knowledge.ts";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DEMO_EMAIL",
  "DEMO_PASSWORD",
  "OPENROUTER_API_KEY",
];

function fail(message) {
  console.error(`erro: ${message}`);
  process.exit(1);
}

/** `01-limites-regulatorios.md` -> `Limites regulatorios` */
function displayNameFor(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).replace(/^\d+[-_]/, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  const prefix = args.find((a) => a.startsWith("--prefix="))?.slice("--prefix=".length) ?? "";
  if (!dir) fail("uso: node scripts/ingest-knowledge-bulk.mjs <diretorio> [--apply] [--prefix=Texto ]");

  const missing = REQUIRED_ENV.filter((name) => (process.env[name] ?? "").trim().length === 0);
  if (missing.length > 0) {
    fail(`variaveis ausentes no ambiente: ${missing.join(", ")}. Rode via "railway run --".`);
  }

  // Decrescente de proposito: ver a nota "NOME DA FONTE" no topo do arquivo.
  const entries = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort().reverse();
  if (entries.length === 0) fail(`nenhum .md em ${dir}`);

  const documents = [];
  for (const entry of entries) {
    const content = (await readFile(path.join(dir, entry), "utf8")).trim();
    if (content.length === 0) continue;
    documents.push({
      file: entry,
      displayName: `${prefix}${displayNameFor(entry)}`,
      content,
      chunks: chunkContent(content),
    });
  }

  console.log(`diretorio: ${dir}`);
  console.log(`arquivos: ${documents.length}\n`);
  for (const doc of documents) {
    const firstChunk = doc.chunks[0] ?? "";
    console.log(`  ${doc.file}`);
    console.log(`    nome    : ${doc.displayName}`);
    console.log(`    chars   : ${doc.content.length}`);
    console.log(`    chunks  : ${doc.chunks.length} (${doc.chunks.map((c) => c.length).join(", ")})`);
    // O digest entrega os primeiros ~600 chars da fonte. Mostrar esse recorte
    // no dry-run e evitar a ilusao de que o documento inteiro chega na call.
    console.log(`    digest  : ${JSON.stringify(firstChunk.slice(0, 120))}...`);
  }
  if (!apply) {
    console.log("\n(dry-run: nada foi escrito. Repita com --apply para ingerir.)");
    return;
  }

  // Resolve a partir de apps/portal pelo mesmo motivo do import de domain no
  // topo: o symlink do workspace nao existe em scripts/.
  const requireFromPortal = createRequire(new URL("../apps/portal/package.json", import.meta.url));
  const { createClient } = requireFromPortal("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email: process.env.DEMO_EMAIL,
    password: process.env.DEMO_PASSWORD,
  });
  if (signInError) fail(`login falhou: ${signInError.message}`);
  console.log(`\nautenticado como ${session.user.email}\n`);

  const apiKey = process.env.OPENROUTER_API_KEY;
  let created = 0;
  let reingested = 0;

  for (const doc of documents) {
    let sourceId = createUuidV7();
    const { error: createError } = await supabase.rpc("portal_create_knowledge_source", {
      p_id: sourceId,
      p_display_name: doc.displayName,
      p_source_type: "document",
      p_data_classification: "internal",
    });

    if (createError) {
      if (!createError.message.includes("already exists")) {
        fail(`criar "${doc.displayName}": ${createError.message}`);
      }
      // Ja existe: reaproveita o id e re-ingere, substituindo a versao.
      const { data: existing, error: lookupError } = await supabase
        .from("knowledge_sources")
        .select("id")
        .eq("display_name", doc.displayName)
        .single();
      if (lookupError || !existing) fail(`"${doc.displayName}" ja existe mas nao foi possivel localizar o id`);
      sourceId = existing.id;
      reingested += 1;
      console.log(`  ~ ${doc.displayName} (ja existia, re-ingerindo)`);
    } else {
      created += 1;
      console.log(`  + ${doc.displayName}`);
    }

    const { chunks, inputTokens } = await embedChunks(apiKey, doc.chunks);
    const { error: ingestError } = await supabase.rpc("portal_ingest_knowledge", {
      p_source_id: sourceId,
      p_version_id: createUuidV7(),
      p_version: "1",
      p_content_hash: contentSha256(doc.content),
      p_chunks: chunks,
    });
    if (ingestError) fail(`ingerir "${doc.displayName}": ${ingestError.message}`);
    console.log(`    ${chunks.length} chunks, ${inputTokens} tokens de entrada`);
  }

  console.log(`\nok: ${created} fonte(s) criada(s), ${reingested} re-ingerida(s).`);
  await supabase.auth.signOut();
}

await main();
