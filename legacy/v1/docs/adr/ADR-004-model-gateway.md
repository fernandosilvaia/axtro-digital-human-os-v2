# ADR-004 — Model Gateway fino próprio (roteamento por task_class, hedging, custo por sessão)
**Status:** Aceito · 2026-07-13
**Contexto:** Múltiplos LLMs por função (realtime barato/rápido, raciocínio, judge, embeddings), necessidade de hedging de latência no realtime, custo rastreado por tenant/sessão, pin de versão por tenant.
**Decisão:** Módulo interno (~pequeno, em `packages/` TS + cliente Py) com: roteamento por `task_class`, timeout/retry/hedge configuráveis, contabilidade de custo por chamada com chaves de correlação, pin de modelo por tenant. Primários: Claude Haiku (realtime), Claude Sonnet (raciocínio/judge); fallback OpenAI equivalentes.
**Alternativas rejeitadas:** LiteLLM/gateway genérico (overhead e menos controle de hedging streaming); SDK direto espalhado (sem custo/fallback centralizados); um único modelo para tudo (caro ou lento).
**Consequências:** + controle total de latência/custo/fallback; troca de provider em um lugar. − código nosso para manter (escopo deliberadamente mínimo — BUILD_VS_BUY proíbe crescer para produto).
