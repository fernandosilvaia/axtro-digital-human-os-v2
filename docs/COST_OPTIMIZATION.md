# Custos e FinOps — estado após o hardening 2026-08-02 (D-V2-100)

> Regra do projeto (Art. 16): números com fonte e data; estimativa nunca se
> apresenta como medição. Preços de tabela conforme D-V2-078 (2026-07-22).

## Inventário: todo caminho que gasta dinheiro real, e sua proteção

| Caminho | Provider | Registra no ledger? | Teto? | Duração máxima? |
|---|---|---|---|---|
| Chat de teste (sandbox) | OpenRouter | ✅ exato (tokens) | ✅ 500k tokens/dia, falha-fechada | n/a |
| Embeddings (ingestão/busca) | OpenRouter | ✅ | ✅ limite diário de ingestões (0015) | n/a |
| Conversa de vídeo (portal) | Tavus | ✅ piso/conversa | ✅ 20/dia (checkVideoCap) | ✅ 900–1800s por sala |
| Apresentação com slides | Tavus | ✅ | ✅ mesmo teto | ✅ idem |
| **Cérebro custom (`/api/brain`)** | OpenRouter | ✅ (0019) | ✅ **NOVO**: 500k tokens/dia falha-fechada + 40 req/min | ✅ 512 tokens out/turno |
| **Vídeo do lead (`/api/leads/video-session`)** | Tavus | ✅ **NOVO** (0024) | ✅ **NOVO**: 20/dia falha-fechada | ✅ 900s |
| **Reunião externa (imediata)** | Tavus + Recall | ✅ **NOVO** | ✅ conta no teto de vídeo | ✅ sala 1800s + **NOVO** `automatic_leave` ≤2400s de bot |
| **Reunião externa (agendada/sentinela)** | Recall (+Tavus no attach) | ✅ **NOVO** no attach | ✅ idem | ✅ **NOVO**: sala só nasce quando o bot entra; `automatic_leave` corta bot ocioso (waiting room 900s, sozinho 900s, todos saíram 30s) |

Antes desta rodada, as 4 linhas marcadas **NOVO** eram gasto sem teto e/ou
invisível no ledger — os maiores buracos financeiros do produto.

## Economias estruturais desta rodada (mecanismo, não promessa)

1. **Sala Tavus do agendamento**: era criada na hora e expirava antes do
   horário (piso ~US$ 0,175 + minutos desperdiçados por agendamento). Agora
   só nasce quando o bot entra. Economia: 100% do desperdício desse fluxo.
2. **Bot-hora do Recall**: sem `automatic_leave`, um bot esquecido numa
   reunião cobrava por hora sem limite (~US$ 14/h na referência da conta).
   Teto duro: ≤40min em call, ≤15min de espera.
3. **Sala órfã em falha de bot**: encerrada no caminho de erro (antes ficava
   aberta os 900–1800s inteiros).
4. **Loop de fallback do cérebro**: o P1 do prompt >4000 chars fazia toda
   chamada degradar — pagando STT/TTS/vídeo do Tavus numa call que nunca
   respondia de verdade. Corrigido na raiz.

## Superfície de custo nova: transcrição de reunião externa (D-V2-106)

Habilitar `enableTranscription: true` no bot da Recall.ai (histórico de
conversa) liga a transcrição assíncrona deles — **cobrada separada da
bot-hora**: US$ 0,15/hora de gravação transcrita (recall.ai/blog/
new-recall-ai-pricing-for-2026, 2026-08-03), empilhado sobre o US$ 0,50/hora
de bot já contabilizado. Numa reunião de referência de ~30min isso é
+US$ 0,075 — pequeno frente ao piso de vídeo Tavus (US$ 0,175/conversa), mas
**ainda não entra no ledger** (`cost_events`): o evento de custo de reunião
externa registra só o bot-hora + o piso de vídeo, não a transcrição. Gap
honestamente declarado — candidato de próxima onda (mesma disciplina do
"custo por conversa é piso, não exato" já aceito pro Tavus).

O chat de teste e o vídeo/apresentação hospedados pelo Tavus não somam
custo novo: a transcrição ali vem do `application.transcription_ready`
callback já incluído no preço da conversa (confirmado na doc oficial —
não é um add-on cobrado à parte).

## Não medido / honestamente pendente

- Duração real de cada conversa Tavus continua não capturada — o ledger
  registra piso por conversa (declarado desde D-V2-078). Medir exige
  webhook de fim de conversa do Tavus (candidato futuro).
- Custo por fluxo/por cliente existe no painel (7d por serviço); custo por
  funcionalidade fina (ex.: apresentação vs. conversa) não é separado.
- ~~Alerta proativo de custo~~ — implementado (D-V2-107, 2026-08-11, migration
  0031 ainda não aplicada): e-mail aos admins quando um dos 4 tetos diários
  (vídeo do portal, vídeo do lead institucional, tokens do brain, tokens do
  chat de teste) cruza 80% ou 100% do uso do dia. `apps/portal/src/lib/
  cost-alerts.ts` — chamado inline, no MESMO ponto que cada teto já lê o uso
  atual (zero query nova); dedup por `(tenant, teto, threshold, dia UTC)` via
  `portal_claim_cost_alert_service`, nunca duplica sob chamadas concorrentes.
- Transcrição de reunião externa (Recall, US$0,15/hora) não entra no ledger
  ainda — ver seção acima.
