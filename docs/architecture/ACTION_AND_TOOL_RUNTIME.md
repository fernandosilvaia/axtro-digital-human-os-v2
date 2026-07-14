# Action and Tool Runtime

## Authority model

O LLM não possui autoridade. Ele produz `action_intent`. O runtime resolve policy e executa adapters.

## Pipeline

```mermaid
sequenceDiagram
  participant L as Presenter/Fast Lane
  participant A as Action Runtime
  participant P as Policy Engine
  participant H as Human Approval
  participant T as Tool Adapter
  L->>A: action_intent
  A->>A: schema + precondition validation
  A->>P: evaluate intent and actor
  P-->>A: policy_decision
  alt approval required
    A->>H: approval request
    H-->>A: approved or denied
  end
  A->>T: idempotent execute
  T-->>A: tool_execution_receipt
  A-->>L: confirmed result for next turn
```

## Risk classes

| Classe | Exemplo | Default |
|---|---|---|
| read_public | catálogo público | automático |
| read_tenant | CRM permitido | automático com audit |
| read_pii | contato | scope e purpose |
| write_low | criar tarefa | automático configurável |
| write_high | enviar proposta, agendar externo | confirmação ou approval |
| financial | cobrança, desconto excepcional | approval e limites |
| irreversible | apagar, cancelar contrato | humano obrigatório |

## Idempotência

Todo write usa `idempotency_key` derivada de tenant, intent, target e logical attempt. Retry retorna o receipt anterior quando o efeito já ocorreu.

### Perfil de execução M0

M0 usa uma fixture de catálogo determinística dentro de `@axtro/tool-runtime`. Ela é privada, somente leitura, com contrato e argumentos em allowlist fechada. Não é um `ToolPort`, não recebe artefato de autorização do caller e não expõe adapter, callback, provider, endpoint ou credencial.

O runtime aceita somente contexto de request autenticado e `ActionIntent`. Ele cria o `PolicyDecision` e o `ToolExecutionReceipt`. Um intent negado produz receipt sem sucesso, exigência de approval produz receipt `pending`, e nenhum deles chega à fixture. Replay usa fingerprint canônico por tenant. Um resultado `unknown` bloqueia retry automático da mesma operação canônica, mesmo com nova chave de idempotência, até existir reconciliação.

O perfil de approval de M0 é uma opção fechada de composição que somente torna a policy mais restritiva para teste. Não é enviado pelo modelo nem deriva de `purpose`, argumentos ou receipt. A fixture padrão mantém o contrato `catalog.lookup` ativo: `tenant_installation`, `read_tenant`, `internal`, sem side effects e atores `presenter` ou `workflow`.

## State reduction

Somente receipt `succeeded` pode confirmar efeito. `accepted` ou `pending` atualiza estado para pendente. Timeout resulta `unknown`, exige reconciliação antes de retry cego.

## Secrets

Adapters recebem secret handles do secret broker. O modelo, logs e state não recebem secret values.

## Tool sandbox

- allowlist de egress;
- schema validation;
- request/response size limit;
- timeout;
- circuit breaker;
- redaction;
- rate and budget limit;
- audit hash.
