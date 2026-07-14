# TEST_STRATEGY.md

> Status: PROPOSTO. Cobertura alvo não é %, é **contratos**: todo contrato público (API, evento, schema, tool, estado) tem teste que quebra se o contrato quebrar.

## 1. Pirâmide adaptada a agentes
- **Unit (TS+Py):** lógica pura — máquina de estados do funil, cálculo SILVA, merge de SalesSessionState (state_rev), políticas de tool, validador de preço, formatação pré-TTS. Vitest (TS) e pytest (Py). Rápidos (<60s total).
- **Contract tests:** JSON Schemas do domínio validados nos dois lados (API TS e workers Py consomem os mesmos arquivos em `packages/domain/schemas`); testes geram payloads válidos/ inválidos por schema; qualquer mudança de schema sem bump de versão falha.
- **Integration:** API+Postgres (RLS! — suíte dedicada de isolamento: para cada tabela, tentar ler/escrever cross-tenant e esperar negação), Redis outbox→consumer, tool runtime→mocks de providers (nock/responses), webhooks com assinatura.
- **Realtime harness:** o mais importante e o mais difícil. Harness em `apps/realtime-worker/tests/harness/` que: sobe pipeline com providers **fake determinísticos** (FakeSTT lê script com timestamps, FakeLLM responde por tabela, FakeTTS emite áudio sintético com duração conhecida) ⇒ testa turnos, interrupção (injeta fala do lead no meio do TTS e mede corte), fallback (mata provider no meio), budgets de latência com relógio virtual. Roda em CI sem rede.
- **E2E (staging):** Playwright para dashboard + sessão real de voz curta contra staging com providers reais (smoke, 3 cenários, roda no deploy de staging, não em PR — custo).
- **Eval suites:** ver EVALUATION_FRAMEWORK (G1–G4) — tratadas como testes bloqueantes no CI.

## 2. Dados de teste
Fábricas (`packages/domain/factories`) geram tenants/leads/sessões consistentes; seed `tenant zero` (Método Silva) reproduzível por script; nunca dados reais em teste.

## 3. Regras de CI
PR: lint+typecheck+unit+contract+integration(rls)+G1; se tocar realtime ⇒ harness; se tocar prompt/motor ⇒ G2+G3. Main: tudo + build + deploy staging + E2E smoke + G4. Tempo alvo do pipeline de PR ≤ 10min (paralelizado no Turborepo cache).

## 4. Testes de carga (F2+)
k6 para API; cenário realtime: 50 sessões simultâneas sintéticas (fake lead por bot LiveKit) medindo p95 dos budgets — antes de cada aumento de plano de concorrência.

## 5. O que NÃO testamos automaticamente (e como cobrimos)
Qualidade subjetiva de prosódia/voz (→ human review semanal, EVALUATION §1.5) · Comportamento de providers reais sob falha regional (→ game days trimestrais manuais, playbooks/) · UX do lead final (→ pesquisa pós-call opcional de 1 pergunta, F3).
