# ADR-033: OpenRouter como primeiro provider real, atrás de um port de texto do control-plane

**Status:** aceito (2026-07-16) · **Decisor:** Fernando (autorização explícita) + sessão autônoma
**Relacionados:** D-V2-019, D-V2-048, D-V2-064, ADR-032

## Contexto

O usuário autorizou a primeira integração de provider real (chave OpenRouter no
Doppler `axtro-human-digital-os`). Os contratos de provider de M0-M2
(`@axtro/provider-contracts`) têm `providerMode: "fake"` fechado no tipo — de
propósito (D-V2-019): o pipeline realtime de voz/avatar segue fake até o
bake-off credenciado (D-V2-048), que continua pendente e humano-gated.

O primeiro uso real de LLM não é o pipeline realtime: é o **chat de teste de
agente do portal** — texto, request/response, control-plane.

## Decisão

1. Novo pacote `@axtro/provider-openrouter` com um port mínimo próprio
   (`TextGenerationPort`), separado dos ports realtime congelados. Egress fixo
   em `https://openrouter.ai`, chave só via option (lida de env pelo chamador),
   fetch injetável para testes, timeout obrigatório, caps fechados de
   mensagens/tamanho/max_tokens, corpo de erro do provider nunca repassado.
2. O portal usa o port numa server action (`sendAgentPreviewMessage`) com:
   system prompt que impõe disclosure de IA, proíbe citar preços (fontes não
   conectadas) e proíbe prometer ações; teto diário de 500k tokens por tenant;
   uso registrado em `cost_events` via RPC (`portal_log_ai_usage`) com
   `unit_cost=0, source='estimated'` — tokens são medidos, o rating em USD
   fica para o rate card real.
3. Os contratos fake de M0-M2 não foram tocados. O bake-off (D-V2-048) e a
   entrada de voz/avatar reais continuam pendentes e fora deste ADR.

## Consequências

- Primeira dependência de rede real do produto; a disponibilidade do chat de
  teste depende do OpenRouter (falha vira erro amigável, nunca resposta
  inventada).
- `packages/config` (M0) continua aceitando só `provider_mode=fake` — o portal
  não passa por esse loader; quando o realtime for real, aquele contrato
  precisará de revisão própria.
- Armadilha registrada: RPCs `SECURITY DEFINER` com `search_path=''` quebram o
  trigger de reconciliação de `cost_events` (migration 0009 referencia a
  tabela sem qualificar) — `portal_log_ai_usage` usa `search_path='public'`.
