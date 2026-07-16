# Relatório de execução autônoma — telas do portal

**Data:** 2026-07-16 · **Branch:** `feat/portal-operational-screens` · **Escopo:** construir as telas operacionais do portal com dados reais, em modo autônomo.

## 1. Implementado

### Backend / dados
- 4 RPCs `SECURITY DEFINER` no Supabase (`portal_tenant_overview`, `portal_list_agents`, `portal_list_knowledge_sources`, `portal_update_tenant_profile`) — tenant resolvido por `auth.uid()`, sem `service_role`, escrita restrita a `tenant_admin`, validação de entrada no SQL (D-V2-058).
- Helper `app.portal_caller_tenant()` como único ponto de resolução usuário→tenant nas RPCs.

### Bugs corrigidos (todos achados testando de verdade no navegador)
- Corrida de provisionamento: layout e página renderizam em paralelo no App Router; primeiro dashboard pós-signup mostrava "não provisionada". Provisionamento movido para dentro do `fetchTenantOverview` cacheado (D-V2-059).
- `.scrim` sem estilo base fora do media query mobile quebrava o grid no desktop (página "preta" — conteúdo empurrado pra fora do viewport).
- Formulário de configurações mostrava valor antigo do select após salvar (input não-controlado não remonta); corrigido com `key` derivada dos valores do servidor.
- E-mail longo estourava o rodapé da sidebar (user-chip sem coluna flex).

### Frontend
- Design system completo em CSS puro (tokens, cards, tabelas, badges, botões, formulários, skeletons, empty states, animações com `prefers-reduced-motion`).
- `AppShell` com sidebar de navegação (ícones SVG inline), chip de usuário com papel, logout, e drawer mobile com scrim + `aria-expanded`.
- 4 telas: Visão geral (métricas reais + primeiros passos + dados da conta), Agentes (lista/empty state), Conhecimento (lista/empty state com classificação de dados), Configurações (edição real com feedback "✓ Salvo" e validação).
- Estados de loading (`loading.tsx` com skeletons por rota), estados vazios com orientação, error banners com `role="alert"`.
- Responsivo: desktop / tablet / mobile (grid 4→2→1, drawer), testado em 375×812.
- Acessibilidade: skip link, `aria-current` na navegação, labels em todos os campos, foco visível, `lang="pt-BR"`.

### Design / identidade
- Favicon SVG com gradiente da marca (`app/icon.svg`), marca "A" consistente nas telas de auth e sidebar.
- Metadata completa: título por página, descrição, OG tags, `themeColor`, `robots: noindex` (app logado).

### Testes / verificação
- Fluxo e2e completo verificado no navegador contra o Supabase real: signup → confirmação → login → provisionamento → 4 telas → edição de configurações persistida no banco (verificada via SQL) → drawer mobile.
- Pipeline verde: lint, `tsc --build`, 393 testes Node + 26 Python, 9 validadores, build do portal com 10 rotas.

## 2. Pronto, falta conectar

| Item | O que falta |
|---|---|
| Claims de tenant no JWT | Habilitar o Auth Hook no dashboard (D-V2-057) — 1 clique |
| Criação de agentes na UI | Provedores de voz/avatar conectados (chaves via Doppler, fim da fase) |
| Ingestão de conhecimento na UI | Mesmo gate de provedores + política de upload |
| E-mails de confirmação em produção | SMTP próprio no Supabase |
| Deploy | Aviso prévio obrigatório antes de criar infra |

## 3. Adaptado

- Dados via RPCs `SECURITY DEFINER` em vez de RLS-por-claim direto no PostgREST — as policies existentes usam setting transacional que não existe em requisições PostgREST, e o hook de claims segue com gate manual (D-V2-058).
- SEO/AEO limitado a metadata + noindex: o portal é aplicação logada; landing pública pertence ao projeto `axtroai`.
- Ideias disruptivas (lead scoring, resumos automáticos etc.): a fundação já existe no monorepo (M3: evaluation, pilot-gate, knowledge-engine); expor isso na UI exige sessões/chamadas reais, que dependem de provedores — implementá-las agora seria UI sobre dados fabricados, o que o projeto proíbe (evidência íntegra). Ficou o dashboard de saúde com métricas reais que crescem conforme o uso.

## 4. Não implementado (e por quê)

- Recuperação de senha — priorizado o fluxo principal; sem risco de regressão (item 4 do checklist).
- Tour guiado interativo — substituído por card "Primeiros passos" (mais simples, sem dependência de biblioteca).
- Multi-tenant por usuário/convites — exige remodelagem consciente (ADR-032 registra o trigger).
- Rate limiting próprio nas RPCs — risco baixo hoje; documentado como dívida.

## 5. Riscos e dívidas técnicas

Ver `RISCOS_E_PENDENCIAS.md` (mantido como documento vivo).

## 6. Para produção

- **Branch:** `feat/portal-operational-screens`
- **Diff:** ~20 arquivos no `apps/portal` (design system, shell, 4 telas, dados, ações) + docs; nenhum pacote do core tocado.
- **Testes:** todos verdes (393 Node, 26 Python, 9 validadores, build/typecheck do portal).
- **Migrations:** nenhuma migration portátil nova; objetos Supabase-only aplicados no projeto real e documentados (D-V2-056/058). Comando local continua `pnpm db:migrate` (inalterado).
- **Deploy:** ainda não há pipeline de deploy do portal — bloqueado por aviso prévio. Quando autorizado: build com `pnpm --filter @axtro/portal run build`, runtime Node ≥24, variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (modelo em `apps/portal/.env.example`).
- **Checklist pré-publicação:** habilitar Auth Hook → SMTP próprio → revisar advisors do Supabase → smoke e2e (signup→login→editar configurações) → definir domínio e atualizar Site URL/Redirect URLs no Supabase Auth.
- **PR:** ver status na descrição do PR da branch.
