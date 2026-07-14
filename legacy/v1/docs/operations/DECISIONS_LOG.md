# DECISIONS_LOG.md — decisões tomadas nesta arquitetura (2026-07-13)

> Complementa os ADRs (docs/adr/) com decisões menores que não mereceram ADR próprio. Formato: D-nn | decisão | alternativa rejeitada | racional curto. Tudo aqui é PROPOSTO até o fundador ratificar; o Claude Code trata como decidido salvo instrução contrária.

| ID | Decisão | Rejeitado | Racional |
|---|---|---|---|
| D-01 | PT-BR como idioma único de docs/código-comentários; identificadores em inglês | docs em EN | fundador e mercado-alvo BR; código universal |
| D-02 | Datas de cotações externas sempre registradas ("cotado em 2026-07-13") | preços sem data | briefing exige; preços de IA mudam mensalmente |
| D-03 | pnpm (não npm/yarn) + uv (não poetry/pip) | poetry | velocidade e lockfiles determinísticos |
| D-04 | Zod e Pydantic gerados dos JSON Schemas (schemas = fonte) | tipos escritos à mão 2x | um contrato, dois runtimes, zero drift |
| D-05 | IDs: UUIDv7 em tudo | serial/cuid | ordenável por tempo + índice amigável |
| D-06 | Timestamps: timestamptz UTC no banco; fuso do lead só na apresentação | horário local no DB | padrão anti-bug |
| D-07 | Soft delete apenas em leads/opportunities; hard delete (LGPD) via job de expurgo com tombstone | soft delete geral | direito de eliminação real |
| D-08 | Nomes de eventos `dominio.acao` em inglês (`session.started`) | PT nos eventos | interoperabilidade/ferramentas |
| D-09 | Sala Axtro sem login para o lead (link assinado TTL) | cadastro do lead | fricção mata show rate |
| D-10 | Follow-up por e-mail F1 sai como DRAFT p/ aprovação; autosend só F2+ com política | autosend imediato | confiança primeiro; risco reputacional |
| D-11 | Dashboard: shadcn/ui + Tailwind; tema white-label por tokens CSS por tenant | lib proprietária | velocidade + theming simples |
| D-12 | Transcript: fonte = eventos STT com timestamps; formato interno próprio + export SRT/JSON | formato do provider | independência de provider |
| D-13 | Preços/planos do produto ficam em tabela `catalog` versionada, nunca em prompt | preço no prompt | anti-alucinação (T06) |
| D-14 | Voz default do tenant zero: voz de estoque ElevenLabs PT-BR feminina ("Sofia") até fluxo de clonagem F2 | clonar voz do fundador já | consentimento/fluxo ainda não construído |
| D-15 | Simulated buyers usam LLM diferente do agente (juiz/gerador ≠ ator) | mesmo modelo | reduz viés de auto-avaliação |
| D-16 | Um repositório de docs (este) separado do repo de código; código nasce em repo novo `axtro-human-sales-ai` | docs dentro do código desde já | handoff limpo; docs viram `/docs` no repo de código no F0 |
| D-17 | Sem Kubernetes até F5 | k8s desde já | overengineering para 1 pessoa; Fly.io cobre |
| D-18 | Análise de sentimento em tempo real: heurística leve + classificador no worker; sem provider externo | API de sentiment | latência e custo |
| D-19 | WhatsApp oficial (Cloud API) só F3; F1 usa e-mail+Telegram interno p/ notificar humanos | WhatsApp não-oficial (baileys) | risco de ban inaceitável para plataforma |
| D-20 | Gravação de tela/slides do agente (apresentação calibrada) F1 = compartilhar PDF na sala; geração dinâmica de slides F4 | slides dinâmicos já | escopo MVP |
