# Registro de subprocessadores e decisões abertas

Este documento não é parecer jurídico. O `COMPLIANCE.md` lista "provider and subprocessor register" como controle base e este é o rascunho desse registro. A coluna "Código" foi conferida no repositório em 2026-10-11 (revisão de segurança e LGPD do ciclo D-V2-196/197). A coluna "A confirmar" é o que o código não prova: contrato, região, retenção e base legal. Nada nela foi inventado, e cada item é decisão do Fernando ou do jurídico.

## Quem recebe o quê

| Provedor | Para quê | Dados que saem do sistema (pelo código) | Controles no código | A confirmar |
|---|---|---|---|---|
| Tavus | Vídeo, voz e percepção da persona ao vivo | Áudio e vídeo da pessoa, transcrição, leitura de expressão e linguagem corporal (quando a análise visual está consentida) | Cinco confirmações separadas antes de iniciar a chamada (divulgação da IA, gravação, transcrição, análise comportamental e análise visual); a chamada só começa com todas marcadas | DPA, região, retenção de gravação e transcrição, uso para treino, tratamento biométrico |
| OpenRouter | Geração do cérebro e embeddings da busca | Falas transcritas, trechos da base, leitura de percepção em texto, números que a pessoa diz à calculadora, consultas da busca | Modelo fixado no código; tetos de custo e entrada por reserva. O cerco de privacidade (`data_collection: deny`, `zdr: true`) existe no adaptador, mas **a rota do cérebro não o ativa** | Política de retenção da conta; se o cerco ZDR pode ser ligado com os modelos usados (ver decisão 1) |
| Supabase | Banco, autenticação, cofre | Dados do tenant, conversas e transcrições persistidas, segredos no Vault | RLS por tenant, RPCs com checagem de papel, governança de exclusão (ADR-046, ainda não aplicada em hospedado) | Região do projeto, backups, DPA |
| Railway | Hospedagem do portal | Tráfego e logs estruturados | Redação de e-mail, token e chave nos logs (`telemetry.ts`) | Região, retenção dos logs |
| Langfuse (opcional) | Trace por turno do cérebro | Só metadado: `tenant_id`, `agent_id`, vertical, idioma, tempos, modelo, tokens, custo, nomes de tool, códigos da sentinela, resumo do que coube no contexto. Nunca fala, argumento ou resultado de tool, nem percepção | Desligado sem as três variáveis; sem host padrão; só HTTPS, ou HTTP em loopback; envio depois da resposta com prazo de 3 s | Onde hospedar, DPA, retenção, aviso aos tenants (ver decisão 3) |
| Stripe | Cobrança do tenant e checkout do cliente final (Connect, ainda não ativo) | Dados de cobrança, e-mail | Chaves só no servidor; conta conectada exige aprovação humana | DPA e papéis (processador ou controlador) |
| Resend | E-mail de convite e alertas | E-mail do destinatário | Timeout, log sem PII | DPA, região |
| Recall.ai | Bot em reunião externa | Áudio e transcrição da reunião | Webhook assinado por HMAC, lista de hosts permitidos para baixar transcrição | DPA, região, retenção |
| Google Calendar | Agenda do time | Horários e e-mail do convidado | Token de atualização no Vault; OAuth com estado de uso único | Revisão de escopos sensíveis pelo Google |

Fora do produto, usados só em laboratório e sem dado real: DeepEval, Ragas e Pipecat rodam em ambiente isolado com dados sintéticos, e a telemetria anônima das duas primeiras é desligada no código. A saída do laboratório (`out/`) é ignorada pelo git porque o repositório é público.

## Decisões abertas antes de dado real

1. **Cerco ZDR do OpenRouter.** Hoje as falas de uma conversa de saúde, família e dinheiro seguem a política de retenção padrão da conta. Ligar o cerco no cérebro pode recusar modelos que não o suportem e muda o custo. Decidir, testar com o modelo em uso e registrar. Não bloqueia o push do branch, bloqueia o go-live com dado real.
2. **Percepção emocional na vertical de seguro.** A persona da Tavus pede leitura de emoção e linguagem corporal, e o cérebro a injeta no prompt para ajustar o ritmo. O `PERCEPTION_PRIVACY_AND_BIOMETRICS.md` diz que a análise emocional não é usada como decisão de venda. Ela não decide elegibilidade nem preço no código, mas informa ritmo e momento da oferta. Decidir se isso é aceitável para seguro de vida nos estados e países em que o produto vai rodar, e qual consentimento o cobre. Anterior a este ciclo, mas agora numa vertical regulada.
3. **Langfuse.** Escolher onde hospedar (Cloud EU, Cloud US ou instância própria) e, com isso, a transferência internacional (LGPD art. 33, GDPR cap. V), o DPA, a retenção e o aviso aos tenants. Enquanto as variáveis não forem definidas, nada sai.
4. **Voz clonada no teste cego.** Se algum candidato usar voz clonada, confirmar o direito sobre ela antes de circular os clipes, porque voz é dado biométrico. As sessões do teste ficam fora do repositório (o código recusa uma sessão dentro dele).

## Observação de segurança sem escalada

O navegador aceita mensagens da sala sem conferir o remetente (`call-lifecycle.ts`, ouvinte `app-message`). Um participante da sala poderia enviar uma chamada de tool da calculadora com números inventados, que apareceriam no cartão daquele navegador. Não há escalada: a calculadora é pura e determinística, e nenhuma ação de negócio sai dela. Anterior a este ciclo, risco baixo.
