# ADR-051: Admissão de participante vindo do CRM para a closer da Billion Leads Pro

**Status:** Proposed (rascunho para revisão do dono; nada implementado)
**Date:** 2026-10-19
**Related:** ADR-038, ADR-036, ADR-050, Constitution Arts. 3, 6, 7, 9, 10, 15

## Context

A closer da Billion Leads Pro deve falar em vídeo com o cliente logo depois do cadastro no CRM. Quem se cadastra é usuário do CRM, não do portal. A ADR-038 só deixa criar recurso pago (Tavus) depois de uma admissão durável com aviso de IA entregue e consentimento por finalidade. A rota `apps/portal/src/app/api/leads/video-session/route.ts` (Raissa) está fechada de propósito com `runtime_admission_required` porque um segredo estático de serviço não carrega esse recibo da pessoa. A closer da Billion tem o mesmo problema e não pode reusar aquela rota.

## Decision (proposta)

1. **Chamador de máquina próprio.** O backend do CRM chama o portal com um segredo exclusivo da Billion, rotacionável e separado do `RAISSA_TOOLS_SECRET`. O segredo identifica o serviço, nunca a pessoa.
2. **Admissão emitida no servidor.** O CRM envia, por chamada assinada, um identificador opaco da conta (`crm_account_ref`), idioma, interesse (CRM ou Leads), estados declarados e etapa do funil. Nunca senha, cartão, documento ou texto livre do cliente. O portal grava a admissão antes de qualquer gasto, com idempotência por cadastro (o mesmo cadastro devolve a mesma admissão).
3. **Aviso de IA gravado antes do canal.** O cliente vê, no painel do CRM, um rótulo permanente curto ("Bia, consultora de IA da Billion") e confirma o início da conversa. O portal grava a entrega do aviso (versão, instante, `crm_account_ref`). Sem esse recibo não existe concessão de canal (ADR-038). A closer não nega ser IA se perguntada.
4. **Consentimento por finalidade.** `essential_processing` é obrigatório. Gravação, transcrição e análise visual só entram com evidência própria; sem ela a capacidade é removida antes de escolher o provedor.
5. **Tetos e chaves.** Teto de sessões por conta (padrão: 2 por dia) e teto diário do tenant no ledger existente; reserva de efeito pago no padrão da ADR-036; chave de desligamento por agente e por canal; falha fechada.
6. **Rota nova.** `POST /api/closers/billion/video-session`, que substitui o `false` fixo por uma verificação real da admissão. A rota da Raissa continua fechada.
7. **Migração forward-only 0079** com a tabela de admissão (tenant, `crm_account_ref` com hash, idioma, versão do aviso, recibo, estado, expiração), RLS forçada, mutação só por RPC de serviço e recibos append-only. Aplicada no banco hospedado só com autorização do dono.
8. **Etapas do funil.** O gatilho (`platform_pipeline_sync`: `trial`, `proposal`, checkout abandonado) vive no CRM e só pede admissão; o portal decide.

## Alternatives considered

1. Reusar o segredo da Raissa: rejeitado, não prova aviso nem consentimento por pessoa.
2. Criar o usuário do CRM como usuário do portal: rejeitado, mistura bases e amplia a superfície de autenticação.
3. Omitir o aviso de IA: rejeitado. Contraria a ADR-038, a doutrina da closer ("nunca finge ser humana") e leis de aviso de bot (Califórnia, Maine, Utah). O rótulo permanente na tela evita que a closer precise anunciar a si mesma na fala.

## Consequences

O canal fica disponível só com admissão provada. Custa uma migração, uma rota, testes e trabalho no CRM (outro repositório). Mensagens proativas (WhatsApp, SMS, e-mail) ficam fora desta ADR e pedem consentimento de contato próprio.

## Revisit trigger

Quando o CRM puder emitir um recibo assinado de consentimento verificável de forma independente, ou quando houver canal público de consumidor para a closer.
