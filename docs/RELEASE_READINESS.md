# Prontidão de release — 2026-08-02 (pós-hardening D-V2-100)

## Notas (0–100, com evidência — não é opinião)

| Dimensão | Nota | Evidência / o que segura a nota |
|---|---|---|
| Funcionalidade | 88 | Fluxos principais e2e verdes (CI, 17 specs); reunião externa agendada nunca validada com humano real |
| Facilidade de uso | 82 | Demo 1-clique, auto-provisão, copy corrigida; sem onboarding guiado passo-a-passo |
| Onboarding | 78 | Signup→agente ativo em minutos; sem checklist de primeiros passos |
| Design | 88 | Sistema visual consistente, validado mobile+desktop nesta rodada |
| Mobile | 84 | Landing e workspace verificados 375px; login mobile corrigido nesta rodada |
| Acessibilidade | 70 | Labels/aria nos forms, aria-live no chat; sidebar inert e sr-only por fazer |
| Frontend | 85 | Error boundary novo, estados tratados, hidratação limpa |
| Backend | 88 | Ports/adapters, falha-fechada, idempotência nos caminhos críticos |
| Banco | 90 | RLS forçada 100%, 24 migrations supabase-only aplicadas, guard monotônico |
| Segurança | 87 | Sem P0; P1s da auditoria corrigidos; riscos residuais declarados em SECURITY_REVIEW |
| Performance | 80 | Build ok, rotas dinâmicas enxutas; sem medição formal de p95 web |
| Confiabilidade | 85 | Degradação declarada em todo caminho; watchdogs; telemetria de fallback |
| Custos | 88 | TODO caminho pago com teto + ledger (novo nesta rodada); duração real de vídeo ainda é piso |
| IA | 86 | Eval golden pelo adapter real; injeção de percepção fechada; RAG do brain pendente |
| Integrações | 84 | Tavus/OpenRouter/Recall com timeout/erros tipados/testes; Recall nunca exercitado com bot agendado real |
| Testes | 88 | 532 Node + 26 Py + 17 e2e em CI |
| Observabilidade | 80 | Logs estruturados com redaction, telemetria de degradação; sem alerta proativo |
| Infraestrutura | 85 | Railway + domínio próprio + health; rollback = redeploy de commit anterior (testado na prática em D-V2-076) |
| Prontidão comercial | 80 | Cadastro→uso→limites→legal ok; SEM billing/cobrança implementada (decisão de preço pendente do Fernando) |
| **Geral** | **84** | |

## O que bloqueia cada nível seguinte

- **Primeiros clientes pagantes**: definir preço + mecanismo de cobrança
  (hoje não há billing — trial aberto com tetos diários); 1 reunião externa
  agendada validada com humano.
- **Escala inicial**: alertas proativos de custo/erro; DPIA percepção;
  bake-off formal de providers (D-V2-048); RAG no cérebro custom.
