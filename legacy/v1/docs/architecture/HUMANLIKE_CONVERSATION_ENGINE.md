# HUMANLIKE_CONVERSATION_ENGINE — Naturalidade como Engenharia

Naturalidade não se resolve por prompt. Cada comportamento humano abaixo tem **componente técnico, estado, métrica e teste próprios**. Dono: `packages/voice-gateway` + `realtime-worker`. Métricas humanas em OBSERVABILITY §2; testes em EVALUATION_FRAMEWORK.

## 1. Turnos, escuta e interrupção
| Comportamento | Implementação | Métrica/Teste |
|---|---|---|
| Controle natural de turnos | EOT híbrido (VAD adaptativo + turn-detector semântico) com pausa mínima variável por ritmo do falante | falsos EOT/h; suite "falante lento" |
| Barge-in bidirecional | corte de TTS/avatar ≤250ms; agente também pode ceder o turno ("pode falar") quando detecta sobreposição >600ms | interrupções bem-sucedidas ≥95% |
| Backchanneling | player secundário de micro-áudios ("uhum", "entendi", "certo") disparado por pausas de 400–900ms durante fala longa do usuário, nunca sobrepondo sílaba tônica; máx 1 a cada 8s | taxa de sobreposição indevida <2% |
| Respostas curtas em escuta ativa | classe `ListeningMode`: LLM instruído a ≤12 palavras enquanto `discovery_active`; enforcement por truncamento de streaming em limite de frases | duração média de turno do agente na descoberta ≤7s |
| Detecção de silêncio | timer pós-EOT do agente: 4s→reformular pergunta; 9s→"quer que eu detalhe algum ponto?"; 20s→checar conexão | silêncios inadequados/h |

## 2. Prosódia e voz
- **Pausas naturais e hesitação controlada**: SSML/estilo por trecho — vírgulas de 150–300ms, hesitações ("hã", "olha...") só via tokens explícitos permitidos pelo estilo do agente (freq. máx 1/min; nunca em números/preços).
- **Variação de entonação, ritmo adaptativo, emoção contextual**: `SpeechStyle {emotion, rate, pitch, energy}` derivado do sentimento do cliente (espelhamento suave: cliente sério→sóbrio; animado→+energia) via mapeamento determinístico, não improviso do LLM.
- **Pronúncia correta**: glossário por tenant (nomes, marcas, termos) com fonemas/aliases; normalização de texto obrigatória pré-TTS: números por extenso, valores ("mil e duzentos reais"), datas ("quinze de agosto"), e-mails soletrados por domínio, siglas com dicionário. Proibido TTS de comandos internos: filtro remove qualquer conteúdo entre tags de sistema antes da síntese.
- Métricas: MOS interno de naturalidade (painel), taxa de correção de pronúncia por tenant.

## 3. Compreensão em tempo real (classificadores rápidos, fora do LLM principal)
Pipeline paralelo (modelo pequeno/regras) sobre transcript parcial produz sinais a cada turno: **intenção** (comprar, comparar, adiar, cancelar, falar-com-humano), **sentimento** (+trend), **confusão** (pedidos de repetição, "não entendi"), **desconforto** (marcadores + prosódia futura), **urgência**, **objeção** (tipologia SILVA: preço, confiança, timing, autoridade, necessidade, concorrente), **mudança de assunto**. Sinais atualizam `SalesSessionState` e disparam eventos; latência budget ≤120ms, nunca bloqueando a resposta.

## 4. Memória de sessão e honestidade
- Rolling summary + entidades citadas (nomes, números, promessas) em estrutura `session_facts`; toda referência retroativa passa por lookup nessa estrutura (teste de referência ≥95%).
- **Incerteza**: se RAG não confirma, resposta usa fórmulas de honestidade ("essa informação eu confirmo e te retorno por e-mail ainda hoje") + tool `followup.create_task`. Inventar = falha de eval bloqueante.
- Pedir esclarecimento naturalmente: template curto com eco parcial ("quando você diz X, é no sentido de A ou B?").

## 5. Presença visual (Fase 2 — contratos já definidos)
Reação visual em escuta (nod leve a cada 6–12s aleatorizado), movimento facial não repetitivo (banco de idle ≥8 variações, seleção sem repetição imediata), sincronização labial (métrica de drift áudio-vídeo ≤120ms), expressões contextuais mapeadas do `SpeechStyle`, contato visual simulado com desvios periódicos (sem "encarar"), micro-mudanças de postura a cada 20–40s. Tudo via comandos normalizados do `AvatarProvider` (expression/idle/listening) — nunca dependendo de feature exclusiva de um fornecedor.

## 6. Mostrar materiais e transferir sem quebrar a experiência
Apresentar conteúdo: frase de transição + `presentation.open` (Presentation Controller valida) + avatar em PiP; voltar ao avatar com `presentation.close`. Handoff: roteiro de 3 frases ("vou trazer o Fernando, nosso especialista; já passei tudo o que conversamos; um instante") + espera ativa útil — nunca música de espera.

## 7. O que é proibido (anti-robótico e anti-uncanny)
Repetir a mesma muletilha 2x seguidas · ler URLs/IDs caracter a caracter sem pedido · monólogos >35s na descoberta (Silva: lead fala 60%) · fingir emoções extremas · afirmar ser humano · sotaque/imitação de pessoa real sem autorização registrada.
