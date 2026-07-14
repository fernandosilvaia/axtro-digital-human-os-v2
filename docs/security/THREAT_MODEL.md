# Threat Model

## Ativos críticos
- tenant data and PII;
- conversation media and transcripts;
- provider credentials;
- tool execution authority;
- pricing and commercial limits;
- agent deployment configurations;
- audit trail integrity;
- brand voice and avatar identity.

## Ameaças principais

| ID | Ameaça | Controle principal | Teste |
|---|---|---|---|
| T01 | cross-tenant SQL access | RLS + composite tenancy integrity | negative integration suite |
| T02 | cache or pool tenant leakage | transaction-local context + namespacing | tenant alternation stress |
| T03 | prompt injection via RAG | untrusted boundary + allowlisted actions | adversarial document corpus |
| T04 | tool injection from transcript | registered contracts only | spoken fake command test |
| T05 | announcement before action success | receipt-gated speech | timeout and unknown receipt eval |
| T06 | duplicate external write | idempotency ledger | retry storm |
| T07 | malicious meeting participant | admission, role and rate policy | participant spoof tests |
| T08 | bot hijack or meeting URL abuse | URL validation and scoped token | malicious URL fixtures |
| T09 | scene sandbox escape | CSP, sandbox, allowlist | browser security suite |
| T10 | model exfiltrates PII | minimization, provider policy, redaction | canary PII tests |
| T11 | secret in prompt or log | secret references and scanners | synthetic secret scan |
| T12 | late audio after barge-in | generation cancellation IDs | delayed provider replay |
| T13 | two presenters speak | atomic floor CAS | concurrency test |
| T14 | fake specialist source | provenance and source allowlist | poisoned result test |
| T15 | daemon gains tenant credentials | brokered action runtime | credential access test |
| T16 | denial of wallet | budgets, quotas, circuit breaker | cost flood simulation |
| T17 | denial of service by long call | duration and resource limits | max-duration test |
| T18 | hidden biometric processing | purpose policy and detector registry | capability audit |
| T19 | deepfake misuse of custom replica | consent evidence and revocation | deployment gate |
| T20 | event tampering | append-only audit hashes and auth | integrity verification |
| T21 | deletion incomplete at provider | deletion workflow and receipts | provider fake reconciliation |
| T22 | stale suggestion changes direction | context version and TTL | delayed suggestion test |
| T23 | provider SDK compromise | adapter isolation, egress and pinning | supply-chain review |
| T24 | approval bypass | server-side state machine | crafted API call test |
| T25 | support operator overreach | scoped admin and audit | privilege test |

## Abuse cases

- Cliente tenta fazer agente ignorar políticas.
- Tenant configura prompt para ocultar que é IA.
- Documento diz para enviar dados a endpoint externo.
- Participante pede que o bot faça cobrança sem confirmação.
- Provider entrega vídeo incorreto ou de outra sessão.
- Axtro Agent envia sugestão depois do contexto mudar.

## Residual risk

Rosto e voz convincentes criam risco de personificação mesmo com disclosure. A mitigação exige autorização, naming claro, provenance de réplica, revogação e monitoramento de uso, além de controles técnicos.
