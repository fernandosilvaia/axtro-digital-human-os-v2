# DIAGRAMS — Índice + Fluxos Complementares (Mermaid)

Já publicados: contexto e containers (SYSTEM_ARCHITECTURE) · fluxo completo de call (SYSTEM_ARCHITECTURE) · máquina de turnos (REALTIME §3) · ciclo do Axtro Agent (AXTRO_AGENT_INTEGRATION) · ciclo do meeting bot (MEETING_GATEWAY) · pipeline de tools (TOOL_RUNTIME §3) · RAG (KNOWLEDGE §3) · outbox→bus (EVENT_ARCHITECTURE) · fluxo multi-tenant (DATA_MODEL). Abaixo, os restantes.

## Fluxo de preparação (pré-call)
```mermaid
sequenceDiagram
  participant API
  participant SUP as Axtro Agent
  participant KB as Knowledge
  participant PG as Postgres
  API->>SUP: session.preparing (lead_id)
  SUP->>PG: CRM + oportunidade + memoria cliente (recorte)
  SUP->>KB: materiais/objecoes do segmento
  SUP->>PG: grava briefing.json (schema briefing/1.0.0)
  Note over SUP: deadline T-2min; senao realtime usa local_default
```

## Fluxo de handoff
```mermaid
sequenceDiagram
  participant C as Cliente
  participant RT as Realtime
  participant API
  participant H as Humano
  RT->>RT: gatilho (ex.: sentimento negativo persistente)
  RT->>API: handoff.requested + packet
  API->>H: push/console/telefone
  RT->>C: espera ativa util (recap/agenda)
  H->>API: accept
  API->>RT: humano entrando
  RT->>C: apresentacao de 3 frases
  H->>C: assume (RT vira observador ou sai)
  RT->>API: handoff.completed{wait_ms}
```

## Fluxo pós-call
```mermaid
flowchart LR
  SC[session.completed] --> SUM[resumo+decisoes]
  SUM --> CRM[crm.update+log] --> TSK[tarefas]
  SUM --> PROP{proposta?} -->|sim| APR[fila aprovacao] --> SEND[proposal.send]
  SUM --> FU[followup.create c/ data - proximo passo Silva]
  SC --> EVAL[evaluation.run] --> LEARN[learnings agregados]
  CRM & FU --> OUT[(outbox garante entrega)]
```

## Fluxo de avatar (F2)
```mermaid
sequenceDiagram
  participant RT as Realtime
  participant AG as Avatar Gateway
  participant TV as Tavus CVI
  participant LK as Sala LiveKit
  RT->>AG: warmup(persona) T-2min
  AG->>TV: createSession (pool)
  RT->>AG: sendAudio(frames TTS)
  TV-->>AG: video frames (labial+expressao)
  AG->>LK: publish video track
  RT->>AG: interrupt() on barge-in (<=250ms)
  TV--xAG: falha
  AG->>LK: card estatico + evento avatar.fallback_voice
```

## Fluxo Zoom/Meet (F3)
```mermaid
sequenceDiagram
  participant U as Anfitriao
  participant BW as bot-worker
  participant RC as Recall
  participant LK as Sala interna LiveKit
  participant RT as Realtime
  BW->>RC: create_bot(meeting_url, output_media)
  RC->>U: bot pede admissao
  U->>RC: admite
  RC-->>BW: media in (audio participantes)
  BW->>LK: injeta audio -> RT processa
  RT->>LK: audio + video avatar
  BW->>RC: output media (voz+video do agente)
  RC--xBW: bot removido
  BW->>RT: bot.removed -> oferecer Sala Axtro
```

## Fluxo de fallback (decisão em runtime)
```mermaid
flowchart TD
  E[erro/timeout de dependencia] --> K{classe}
  K -->|S2S| P[pipeline A na mesma sessao]
  K -->|STT/TTS| N[proximo provider do registry]
  K -->|Avatar| V[modo voz + aviso elegante]
  K -->|Tool write| O[outbox + frase honesta de retorno]
  K -->|RAG| G[so confirmado do briefing + admitir]
  K -->|Sala| RJ[reconexao 3x -> link por SMS/email]
  K -->|Budget| X[encerramento gracioso + agendamento]
  todos --> M[metrica + evento + alerta]
```

## Fluxo de segurança (request de tool financeiro)
```mermaid
flowchart LR
  LLM[tool_call discount.apply 12%] --> RT[runtime]
  RT --> LIM{<= max_discount_pct 10%?}
  LIM -->|nao| REQ[requires_approval + evento]
  REQ --> AG2[agente fala: preciso validar com meu gestor]
  REQ --> Q[fila console humano]
  Q -->|aprova| EX[executa c/ audit]
  Q -->|nega| ALT[NBA alternativa: ancoragem de valor]
```
