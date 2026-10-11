# Priscila: o que já está pronto e as ideias disruptivas que vêm a seguir

Escrito em 2026-10-10. Pesquisa de open source feita com fontes primárias (licenças e números citados com link no relatório da sessão); itens não confirmados estão marcados como tal.

## Já implementado neste ciclo

| Peça | Por que é diferente |
|---|---|
| Sentinela de compliance determinística | Remove, frase a frase e em três idiomas, a afirmação que cria exposição regulatória antes de virar áudio. Instrução de prompt é probabilística; a sentinela não é. |
| Prompt honesto sobre tools | O prompt só promete as tools que a persona tem de fato. Sem elas, a Priscila captura nome, contato e janela e entrega ao time licenciado, sem inventar horário. |
| Bússola de produto e momentos sensíveis | Do final expense ao Kai-Zen, ligando necessidade à família de produto, nunca à comissão, com luto, idoso e saúde tratados com cuidado. |
| Base de conhecimento de 13 fontes | Cobre o que a biblioteca existente não tinha (Kai-Zen, anuidades com melhor interesse, 1035, uso empresarial, glossário trilíngue), validada contra a própria sentinela. |
| Banco de 12 cenários | Mede o modelo cru antes da sentinela; offline sem custo, ao vivo com confirmação explícita. |
| Persona da Tavus via cérebro | Script seguro (dry-run, confirmação exata) e correção da base URL que a tela mostrava errada. |
| Ponte de tool calling (D-V2-196) | O cérebro devolve tool_calls no formato OpenAI por SSE e aceita mensagens `tool`. Do corpo da Tavus só se aproveita o nome; a descrição e o schema são os nossos. Uma tool call malformada não trava mais o tenant, e o contexto entra no teto de entrada por prioridade. Falta ver o formato ao vivo num teste pago. |
| Calculadora de cobertura (D-V2-196) | `estimate_coverage_need` roda no navegador: método DIME, a pessoa vê a decomposição na tela, e uma lacuna pequena nunca é falada como zero. |
| Cache do prompt (D-V2-196) | O prompt de sistema é marcado para cache em modelos Anthropic. O trace mede quantos tokens vieram do cache. |
| Observabilidade e avaliação (D-V2-196) | Trace por turno no Langfuse via OTLP, só metadado. Conversa inteira com DeepEval e busca com Ragas, em ensaio grátis e, ao vivo, com confirmação. |
| Laboratório de voz (D-V2-196) | Pipecat comandando a Tavus, com Smart Turn e Silero, e teste cego de voz com a regra "só troca se ganhar". |

## Próximas ideias, em ordem de impacto

Os itens 1 a 4 da versão anterior desta lista (ponte de tools, calculadora, cache do prompt, observabilidade e avaliação) foram implementados e estão na tabela acima. O item 5 virou laboratório e falta rodar.

5. **Rodar o laboratório de voz e turno** (`experiments/voice-lab/`). A Tavus só renderiza o rosto; STT, TTS e turnos ficam nossos. Falta escolher vozes e réplica, baixar os pesos, autorizar o gasto e recrutar ouvintes.
   - **Turno:** Smart Turn v3.2 (BSD-2, 23 línguas, cerca de 10 ms em CPU) e Silero VAD (MIT).
   - **Voz:** teste cego em português e espanhol de Qwen3-TTS (Apache-2.0) e Chatterbox Multilingual (MIT) contra o ElevenLabs. Só troca se ganhar.
6. **Guarda durante a fala.** Qwen3Guard-Stream (Apache-2.0) mais as regras da sentinela, cortando o TTS antes de terminar uma frase proibida, com o cancelamento que o laboratório de tempo real já tem.
7. **Closer que melhora com gate humano.** Otimização de prompt (DSPy GEPA) contra recibos de agendamento reais, não contra texto do modelo, sempre com revisão humana antes de promover.
8. **Ritmo guiado por emoção.** A percepção raven-1, que já existe, junto com um modelo de emoção na fala, desacelera a conversa e oferece o humano antes. É sinal de ritmo, nunca critério de elegibilidade. Licença dos pesos do emotion2vec+ não confirmada.
9. **Recapitulação em vídeo depois da call.** Um vídeo curto da Priscila resumindo o que foi conversado, gerado offline, mandado junto com a confirmação do agente. Exige revisão de compliance do roteiro.
10. **Mesma voz nos três idiomas.** A Priscila mantém o timbre quando a pessoa troca de idioma. Depende do teste do item 5.
11. **Subir o teto de entrada do cérebro.** O teto de 20 mil, fixado no banco, obriga a cortar histórico quando a persona tem tools e base cheia. Uma migration nova com o envelope maior, aplicada antes do deploy que muda a constante, devolve a memória longa. O custo por turno continua abaixo de US$ 0,05 no Haiku 4.5.

## Descartados, com motivo

| Opção | Motivo |
|---|---|
| TEN VAD e TEN framework | Cláusula contra concorrência com a Agora; risco para plataforma multi-tenant |
| F5-TTS, OpenAudio, audeering, Wav2Lip | Pesos não comerciais |
| CSM, Dia, Orpheus, PersonaPlex | Não atendem português e espanhol |
| LiveAvatar e Hallo-Live | Exigem várias GPUs de data center |
| LiveKit turn detector fora do LiveKit Agents | A licença proíbe |

Avatar próprio (Ditto, MuseTalk) só faz sentido se o custo da Tavus virar o gargalo. Fica no laboratório, nunca no caminho do cliente sem um bake-off formal.
