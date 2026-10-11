# Priscila: o que já está pronto e as ideias disruptivas que vêm a seguir

Escrito em 2026-10-10. Pesquisa de open source feita com fontes primárias (licenças e números citados com link no relatório da sessão); itens não confirmados estão marcados como tal.

## Já implementado neste ciclo

| Peça | Por que é diferente |
|---|---|
| Sentinela de compliance determinística | Remove, frase a frase e em três idiomas, a afirmação que cria exposição regulatória antes de virar áudio. Instrução de prompt é probabilística; a sentinela não é. |
| Prompt honesto sem tools | O cérebro não devolve tool_calls, então a Priscila não promete agendar nem inventa horário: captura nome, contato e janela e entrega ao time licenciado. |
| Bússola de produto e momentos sensíveis | Do final expense ao Kai-Zen, ligando necessidade à família de produto, nunca à comissão, com luto, idoso e saúde tratados com cuidado. |
| Base de conhecimento de 13 fontes | Cobre o que a biblioteca existente não tinha (Kai-Zen, anuidades com melhor interesse, 1035, uso empresarial, glossário trilíngue), validada contra a própria sentinela. |
| Banco de 12 cenários | Mede o modelo cru antes da sentinela; offline sem custo, ao vivo com confirmação explícita. |
| Persona da Tavus via cérebro | Script seguro (dry-run, confirmação exata) e correção da base URL que a tela mostrava errada. |

## Próximas ideias, em ordem de impacto

1. **Ponte de tool calling no cérebro.** Fazer a rota `/api/brain` devolver `tool_calls` no formato OpenAI por SSE e aceitar mensagens `tool` no histórico. Com isso a Priscila volta a registrar lead e propor e confirmar horários reais (funil do ADR-041), com a mesma doutrina e a mesma sentinela. Exige um teste pago na Tavus para validar o formato.
2. **Calculadora de necessidade como tool.** Uma tool `estimate_coverage_need` executada no navegador, sem custo e sem dado persistido: método DIME (dívidas, renda, hipoteca, educação, menos o que já existe). A Priscila mostra a conta, não um palpite, e o agente licenciado parte de um número que o cliente viu nascer.
3. **Cache do prompt estático.** O prompt da vertical tem cerca de 14 mil caracteres e é idêntico em todo turno. Marcar esse bloco para cache no provedor (quando o modelo suportar) reduz latência do primeiro token e custo por turno. Precisa medir no modelo configurado.
4. **Observabilidade e avaliação contínua.**
   - **Langfuse hospedado por nós:** MIT fora das pastas `ee`, recebe OTLP por HTTP. Fica fora do caminho de áudio.
   - **DeepEval:** métricas de conversa com vários turnos, como aderência ao papel e retenção de conhecimento.
   - **Ragas:** mede fidelidade e recall do RAG híbrido da 0074.
5. **Laboratório de voz e turno com Pipecat comandando a Tavus.** A Tavus só renderiza o rosto; STT, TTS e turnos ficam nossos.
   - **Turno:** Smart Turn v3.2 (BSD-2, 23 línguas, cerca de 10 ms em CPU) e Silero VAD (MIT).
   - **Voz:** teste cego em português e espanhol de Qwen3-TTS (Apache-2.0) e Chatterbox Multilingual (MIT) contra o ElevenLabs. Só troca se ganhar.
6. **Guarda durante a fala.** Qwen3Guard-Stream (Apache-2.0) mais as regras da sentinela, cortando o TTS antes de terminar uma frase proibida, com o cancelamento que o laboratório de tempo real já tem.
7. **Closer que melhora com gate humano.** Otimização de prompt (DSPy GEPA) contra recibos de agendamento reais, não contra texto do modelo, sempre com revisão humana antes de promover.
8. **Ritmo guiado por emoção.** A percepção raven-1, que já existe, junto com um modelo de emoção na fala, desacelera a conversa e oferece o humano antes. É sinal de ritmo, nunca critério de elegibilidade. Licença dos pesos do emotion2vec+ não confirmada.
9. **Recapitulação em vídeo depois da call.** Um vídeo curto da Priscila resumindo o que foi conversado, gerado offline, mandado junto com a confirmação do agente. Exige revisão de compliance do roteiro.
10. **Mesma voz nos três idiomas.** A Priscila mantém o timbre quando a pessoa troca de idioma. Depende do teste do item 5.

## Descartados, com motivo

| Opção | Motivo |
|---|---|
| TEN VAD e TEN framework | Cláusula contra concorrência com a Agora; risco para plataforma multi-tenant |
| F5-TTS, OpenAudio, audeering, Wav2Lip | Pesos não comerciais |
| CSM, Dia, Orpheus, PersonaPlex | Não atendem português e espanhol |
| LiveAvatar e Hallo-Live | Exigem várias GPUs de data center |
| LiveKit turn detector fora do LiveKit Agents | A licença proíbe |

Avatar próprio (Ditto, MuseTalk) só faz sentido se o custo da Tavus virar o gargalo. Fica no laboratório, nunca no caminho do cliente sem um bake-off formal.
