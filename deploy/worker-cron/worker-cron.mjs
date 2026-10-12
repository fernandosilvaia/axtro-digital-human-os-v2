// Executor de um worker agendado do portal, para rodar como cron do Railway.
//
// Substitui o agendamento do GitHub Actions, que nao roda no minuto certo (em producao
// espacou de 3 a 6 horas) e fica parado quando a conta do GitHub tem problema de cobranca.
// Faz a mesma chamada dos workflows: POST com Bearer na rota protegida do portal, mesmo
// teto de espera, sem retry, e aplica o mesmo filtro de resposta. A chamada bem-sucedida
// e o que renova o heartbeat que o /api/ready exige (janela de 720 segundos).
//
// Configuracao por variaveis de ambiente do servico:
//   WORKER         billing, reconciler ou meeting
//   WORKER_URL     https://<dominio do portal><rota do worker>
//   WORKER_SECRET  segredo Bearer do worker (referencie a variavel do servico portal)
//
// Codigo de saida 0 so quando o portal respondeu 200 e o filtro aceitou a resposta.
// O segredo nunca e escrito no log.

import { pathToFileURL } from "node:url";
import { WORKERS } from "./gates.mjs";

const MIN_SECRET_LENGTH = 24;
const MAX_BODY_CHARS = 1_000_000;

function compact(payload, names) {
  const out = {};
  for (const name of names) {
    const value = payload?.[name];
    if (typeof value === "number" || value === null) out[name] = value;
  }
  return out;
}

export async function run(env, { fetchImpl = globalThis.fetch, stdout = console.log, stderr = console.error } = {}) {
  const workerName = (env.WORKER ?? "").trim();
  const worker = Object.hasOwn(WORKERS, workerName) ? WORKERS[workerName] : null;
  if (worker === null) {
    stderr(`WORKER must be one of: ${Object.keys(WORKERS).join(", ")}`);
    return 1;
  }
  const url = env.WORKER_URL ?? "";
  if (!/^https:\/\/[^\s]+$/.test(url) || !url.endsWith(worker.path)) {
    stderr(`WORKER_URL must be an https URL ending in ${worker.path}`);
    return 1;
  }
  const secret = env.WORKER_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH || /[\r\n]/.test(secret)) {
    stderr("WORKER_SECRET is not configured or is too short");
    return 1;
  }

  const startedAt = Date.now();
  let response;
  let text;
  try {
    // redirect manual espelha o curl dos workflows: um 3xx e falha, nunca e seguido
    // (seguir reenviaria o Bearer para onde o redirecionamento apontar).
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(worker.maxTimeMs),
    });
    text = (await response.text()).slice(0, MAX_BODY_CHARS);
  } catch (error) {
    stderr(`${workerName} call failed: ${error?.name ?? "Error"}`);
    return 1;
  }

  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }

  if (response.status !== 200) {
    stderr(`${workerName} worker returned HTTP ${response.status}`);
    if (payload && typeof payload === "object") {
      stderr(JSON.stringify({ ok: payload.ok, error: typeof payload.error === "string" ? payload.error.slice(0, 200) : undefined }));
    }
    return 1;
  }
  if (!worker.gate(payload)) {
    stderr(`${workerName} response gate failed`);
    stderr(JSON.stringify(compact(payload, worker.summary)));
    return 1;
  }
  stdout(JSON.stringify({
    worker: workerName,
    status: response.status,
    durationMs: Date.now() - startedAt,
    ...compact(payload, worker.summary),
  }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.env);
}
