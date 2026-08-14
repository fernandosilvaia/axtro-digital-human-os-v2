# ARCHITECTURE — mapa de entrada

**Canônicos (fonte da verdade):** `ARCHITECTURE_CONSTITUTION.md` (18 artigos + ADRs em
`docs/adr/`), `docs/architecture/SYSTEM_ARCHITECTURE.md`. Este arquivo é o mapa de 2 minutos.

## Duas camadas

1. **Kernel M0-M3** (`packages/`, `apps/api|realtime-worker|...`): plataforma genérica de
   funcionários digitais — domínio, contratos (48 schemas), tenancy/RLS, Action Runtime,
   Turn Coordinator, percepção, Role Pack de vendas, avaliação. 100% fake-first, verde,
   congelada por release gates (M1-11, M2-13, M3).
2. **Produto** (`apps/portal/`): Next.js 16 + Supabase real — auth, dashboard, agentes,
   conhecimento (RAG real), equipe, chat com Cérebro Método Silva, vídeo Tavus por persona,
   modo apresentação. Deploy Railway.

## Fluxos principais do portal

- **Chat de teste:** server action → cérebro (2 msgs system) → RAG (`portal_search_knowledge`)
  → OpenRouter → ledger. Mock determinístico com `PORTAL_FAKE_PROVIDERS=1`.
- **Vídeo/apresentação:** `agent_video_config` → persona Tavus (prompt=cérebro, percepção
  emocional, tools de slides) → sala Daily; cliente escuta `conversation.tool_call` e devolve
  `tool_result`. Contexto por chamada = digest de conhecimento + roteiro do deck.
- **Conhecimento:** chunk ~1200 → embeddings (OpenRouter ou fake) → RPCs de ingestão/busca/
  digest com revogação imediata.
- **Dados:** tudo via RPCs `SECURITY DEFINER` keyed em `auth.uid()` (D-V2-058);
  migrations portáveis em `database/migrations/`, específicas de Supabase em
  `database/supabase-only/` (estado no README da pasta).

## O Cérebro (Método Silva)

`apps/portal/src/lib/brain/metodo-silva.ts` — prompts nos 9 blocos do "System Prompt Silva";
manuais completos como fontes RAG do tenant; cofre local gitignored `knowledge-vault/`
(IP proprietária, repo público). Decisões: D-V2-073/074/075, ADR-035.
