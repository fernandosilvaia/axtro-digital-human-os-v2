# Pendências Externas

Estas pendências não bloqueiam M0-M2 quando adapters fake são usados. Bloqueiam benchmark real ou produção.

## Contas e credenciais
- LiveKit Cloud e projeto de staging.
- Provider de avatar para bake-off, sem escolha definitiva antes dos testes.
- OpenAI API para benchmark de Realtime.
- STT e TTS alternativos para benchmark.
- Recall.ai para Meet, Zoom e Teams — necessário para validar o "cérebro" (M4) rodando dentro de uma call de Zoom/Meet de verdade, não só na sala hospedada do Tavus (spike D-V2-076 confirmou a viabilidade técnica via Output Media API, mas não foi testado ao vivo por falta de conta).
- Telnyx e configuração SIP de staging.
- Supabase de dev e staging.
- Secret manager escolhido.
- `SUPABASE_SERVICE_ROLE_KEY` do projeto `digital-human-os` (M4-04) — nunca configurada neste projeto até hoje; pegar em Project Settings > API do Supabase. Sem ela, o endpoint `/api/brain/[agentId]/chat/completions` não consegue resolver tenant/agente (chamada servidor-a-servidor do Tavus, sem sessão de usuário).

## Gates humanos pendentes do cérebro customizado (M4)
- Aplicar `database/supabase-only/0018_agent_brain_config.sql` e `0019_agent_brain_service_role_rpcs.sql` no Supabase real (`ovctadcrvnfpgxzplupp`) — escritas e revisadas, aplicação bloqueada pelo classificador de segurança da sessão autônoma que as escreveu (DDL em produção exige confirmação explícita, D-V2-082).
- Apontar `layers.llm.base_url` de uma persona Tavus REAL para o endpoint — nenhuma persona em produção (Aurora, Amanda, Rafaela) usa o cérebro customizado ainda; troca de LLM de uma persona ao vivo é ação que afeta clientes/prospects reais e fica reservada para decisão explícita do Fernando.
- RAG real no caminho Tavus (`portal_search_knowledge` exige `auth.uid()`, que não existe numa chamada servidor-a-servidor) — hoje o endpoint responde só com identidade + Método Silva + percepção, sem fontes de conhecimento da conta; candidato a uma RPC `_service` equivalente numa sessão futura.

## Decisões comerciais
- Limites de custo por minuto e por tenant.
- Planos, franquias, overage e política de suspensão por budget.
- Contratos e DPAs dos providers finalistas.
- Região de processamento e data residency por mercado.

## Conteúdo e propriedade intelectual
- ✅ ~~Os oito manuais do Método Silva não vieram no ZIP~~ — **RESOLVIDO 2026-07-19**: a Coleção Método Silva v3.0 completa (38 arquivos .md) foi baixada do Drive do Fernando (dono da IP, fernando@axtroai.com) para `knowledge-vault/metodo-silva/` (gitignored, repo é público) com manifesto `SHA256SUMS` de presença/versão/hash. 10 manuais de venda ingeridos no RAG do tenant demo (D-V2-073).
- Autorização documentada para qualquer voz, imagem ou réplica customizada.

## Jurídico e compliance
- Validação de disclosure, gravação e telemarketing por jurisdição.
- DPIA ou avaliação equivalente para recursos de percepção visual e biometria.
- Regras específicas para seguros, finanças, saúde, jurídico e crédito.
- Política de retenção e exclusão aprovada por counsel e clientes enterprise.

## Produto
- Definir primeiro vertical e dataset de golden conversations.
- Selecionar closers humanos para baseline comparável.
- Aprovar identidade visual e persona inicial do agente.
