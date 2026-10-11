# Lançamento da Priscila, closer de Life Insurance

Estado: **pronto no código, nada criado em produção.** Escrito em 2026-10-10. Cada passo que toca conta real (Tavus, Supabase hospedado, Railway, OpenRouter) é ação de operador com autorização do Fernando.

## O que a Priscila é

Uma closer de vídeo com IA para seguro de vida americano, servida pelo cérebro próprio do portal (`/api/brain/<agentId>`), não pelo LLM da Tavus. Isso garante que toda resposta passe pela doutrina revisada, pela base de conhecimento do tenant e pela sentinela de compliance.

- **Papel:** qualifica, educa e entrega o caso a um agente humano licenciado. Não cota, não aprova e não emite.
- **Portfólio:** final expense, term, mortgage protection, whole life, GUL, IUL, anuidades (MYGA, FIA, SPIA, DIA, QLAC), premium financing (Kai-Zen), living benefits, uso empresarial e sucessório.
- **Idiomas:** inglês, espanhol e português, espelhando quem está do outro lado.
- **Aparência:** loira, aparentando de 30 a 40 anos, calorosa e profissional. A Sofia (latina, mais madura) continua para o público sênior de final expense; a Priscila atende o público de term, IUL, anuidade e Kai-Zen, sem excluir ninguém.

## Peças no repositório

| Peça | Onde |
|---|---|
| Doutrina da vertical (compliance, bússola de produto, momentos sensíveis) | `apps/portal/src/lib/brain/life-insurance.ts` |
| Prompt de vídeo sem promessa de tools que o cérebro não chama | `apps/portal/src/lib/brain/metodo-silva.ts` (`toolCalling: false`) |
| Sentinela de compliance depois da geração | `apps/portal/src/lib/brain/compliance-sentinel.ts` |
| Base de conhecimento (13 fontes) | `knowledge/life-insurance/priscila/` |
| Criação da persona na Tavus | `scripts/provision-tavus-brain-persona.mjs` |
| Banco de cenários de avaliação | `experiments/priscila-eval/` |

## Passo a passo

1. **Criar o agente** no portal do tenant (Billion Club): nome `Priscila, Life Insurance`. Ele nasce como rascunho.
2. **Escolher a réplica (rosto):** `TAVUS_API_KEY=... node scripts/provision-tavus-brain-persona.mjs --list-replicas`. A lista é só leitura e não tem custo. Escolher olhando o thumbnail, não o nome. Critérios: loira, aparentando de 30 a 40 anos, expressão calorosa, movimento natural de cabeça e olhar (modelos Phoenix mais recentes), fundo neutro de escritório ou casa.
3. **Escolher a voz:** de preferência uma voz multilíngue da ElevenLabs, feminina, calorosa, com inglês americano nativo e boa pronúncia em espanhol e português (`ELEVENLABS_API_KEY` e `ELEVENLABS_VOICE_ID`). Sem as duas variáveis, a persona usa a voz padrão da réplica.
4. **Gerar o segredo do cérebro** na tela Testar do agente ("Gerar segredo"). A tela mostra a base URL e a chave uma única vez.
5. **Criar a persona**, primeiro em dry-run e depois de verdade:
   ```bash
   AGENT_BRAIN_API_KEY=... node scripts/provision-tavus-brain-persona.mjs --dry-run --name="Priscila, Life Insurance" --replica-id=rXXXX --agent-id=<uuid> --portal-url=https://closer.axtroai.com --language=english
   ```
   ```bash
   TAVUS_BRAIN_PERSONA_PROVISION_CONFIRM=create-brain-persona TAVUS_API_KEY=... AGENT_BRAIN_API_KEY=... node scripts/provision-tavus-brain-persona.mjs --create --name="Priscila, Life Insurance" --replica-id=rXXXX --agent-id=<uuid> --portal-url=https://closer.axtroai.com --language=english
   ```
6. **Vínculo governado** da persona e da réplica ao agente. Depois da migration 0072, a tela do cliente só edita idioma e vertical; o vínculo de ativos é provisionamento da plataforma, feito pelo operador de banco com service role:
   - `agent_video_config`: `tavus_persona_id`, `tavus_replica_id`, `language = 'english'`, `spoken_languages = {english,spanish,portuguese}` e `closer_vertical = 'life_insurance_qualification'`.
   - Antes da 0072 (o hospedado de hoje), a própria tela ainda aceita o vínculo.
7. **Ingerir a base de conhecimento:** `railway run -- node scripts/ingest-knowledge-bulk.mjs knowledge/life-insurance/priscila --dry-run`, revisar e repetir com `--apply`.
8. **Ligar o cérebro e ativar o agente** na tela Testar.
9. **Avaliar antes de liberar:**
   - Rodar o banco de cenários (`experiments/priscila-eval`) em modo ao vivo, que gasta crédito do OpenRouter e exige autorização.
   - Fazer uma chamada de vídeo de teste, que gasta crédito da Tavus e exige autorização.
   - Critério: zero violação de compliance antes da sentinela, divulgação de IA no primeiro turno e idioma espelhado em todos os cenários.

## Limites que continuam valendo

- **Sem agendamento automático:** o cérebro não devolve tool_calls, então a Priscila não marca horário sozinha. Ela captura nome, contato e janela de horário de forma verbal, e o time licenciado confirma. Ligar tools no cérebro é trabalho futuro e precisa de teste pago na Tavus.
- **Crédito:** a Priscila só responde com a doutrina se houver crédito no OpenRouter. Sem crédito, a chamada degrada para a frase de recuo.
- **Encerrar:** o botão "Encerrar" continua inerte enquanto `PORTAL_PROVIDER_TERMINATION_ENABLED=false`.
