# Backlog de reconciliação de uso de IA

Este runbook cobre a observação de reservas OpenRouter em estado `unknown` no
M5-01. Uma resposta ambígua do provider continua bloqueando novo gasto de IA
do tenant. Tempo não é evidência: não existe TTL, liberação automática ou retry
que limpe a barreira.

## Fronteira disponível no M5-01

- `GET /api/internal/ai-usage` observa somente contadores agregados pelo RPC
  service-only `portal_ai_usage_reconciliation_backlog_service()`.
- O GET exige `Authorization: Bearer <AI_USAGE_RECONCILE_SECRET>`. O segredo
  configurado deve ter no mínimo 24 caracteres e a comparação é feita em tempo
  constante.
- A resposta usa `Cache-Control: no-store`. A telemetria contém somente
  contadores agregados, nunca bearer, IDs, referência da fatura, tenant, actor
  ou corpo.
- `POST /api/internal/ai-usage/manual` está deliberadamente fechado com
  `404 {"error":"not_found"}` e `Cache-Control: no-store`. A rota não lê
  headers ou body e não toca o banco, mesmo quando recebe um bearer válido.

O bearer global é suficiente para observação agregada, mas não representa uma
identidade humana nem prova aprovação independente. Portanto, ele não pode
autorizar uma transição financeira `unknown -> released|committed`.

## Observar o backlog

Configure um segredo aleatório e exclusivo como `AI_USAGE_RECONCILE_SECRET` no
Railway. Não reutilize o segredo do dispatcher de billing nem do reconciler
Tavus/Recall.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $AI_USAGE_RECONCILE_SECRET" \
  https://closer.axtroai.com/api/internal/ai-usage
```

Resposta exata de sucesso:

```json
{
  "ok": true,
  "backlog": {
    "reserved": 0,
    "providerInFlight": 0,
    "unknown": 1,
    "unknownMaxTokens": 20512,
    "unknownMaxCostUsd": 0.05,
    "oldestProviderInFlightAgeSeconds": 0,
    "oldestUnknownAgeSeconds": 900,
    "receiptCount": 4
  }
}
```

`providerInFlight` e `unknown` não devem ser alterados por inferência ou idade.
Investigue um valor persistente e preserve a fatura e a correlação do provider
no registro restrito do incidente. O endpoint não lista reservas, tenants ou
referências do provider.

## Reconciliação por fatura adiada

Os contratos SQL service-only já distinguem as duas evidências possíveis:

- `provider_invoice_no_charge`, sem tokens ou custo;
- `provider_invoice_usage_confirmed`, com tokens e custo exatos da fatura.

Isso não torna o RPC uma superfície operacional remota. Não invoque o RPC
diretamente para contornar o `404`, não reutilize um segredo de scheduler e não
use `portal_release_ai_usage_service` para uma chamada que cruzou o dispatch
fence.

A exposição remota fica adiada até M5-02 introduzir, antes da mutação:

1. identidade de operador autenticada e autorizada;
2. dupla aprovação independente para a evidência da fatura;
3. receipt append-only ligando operadores, aprovação e fingerprint da
   evidência sem armazenar segredo ou PII em logs;
4. idempotência e replay conflitante fail-closed;
5. auditoria e testes negativos de tenant, abuso e denial of wallet.

Até essa fronteira existir, um `unknown` continua consumindo capacidade. Isso é
degradação segura, não incidente a ser resolvido com liberação manual ad hoc.

## Respostas do GET

| HTTP | `error` | Ação |
|---|---|---|
| `401` | `unauthorized` | Corrigir o bearer de observação. |
| `503` | `not_configured` | Configurar o segredo de observação antes de consultar. |
| `503` | `reconciliation_unavailable` | Verificar logs e disponibilidade do RPC; não assumir backlog zero. |

O POST retorna sempre `404 not_found`, independentemente de configuração,
autenticação ou conteúdo. Qualquer procedimento de reconciliação humana deve
aguardar a fronteira M5-02 descrita acima.
