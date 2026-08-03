# Jornada do usuário — Axtro Digital Human OS (estado real, 2026-08-02)

> Só o que existe e foi verificado. Nada aspiracional.

## Cliente do produto (tenant)

1. **Descoberta** — landing pública `closer.axtroai.com` (SEO/AEO, FAQ,
   demo compartilhada com dados fictícios em 1 clique, sem cartão).
2. **Cadastro** — signup com verificação de e-mail; auto-provisão do tenant
   (0004); recuperação de senha funcional.
3. **Time** — convites por e-mail com papel (admin/member), revogação.
4. **Primeiro agente** — cria rascunho (nome + papel) → ativa; a persona de
   vídeo (voz + avatar + percepção) é auto-provisionada na ativação (0022).
5. **Conhecimento** — cola conteúdo autorizado → ingestão com embeddings →
   RAG citável; revogação imediata; exclusão de fonte revogada/pendente.
6. **Testar** — sandbox de chat determinístico + conversa de vídeo real +
   apresentação com slides conduzida pela agente.
7. **Reunião externa** — cola o link de Zoom/Meet/Teams e o agente entra na
   reunião (agora, ou agendado no horário da Flórida com bot sentinela).
8. **Operação** — painel com uso de IA, custo estimado (rate card público),
   sessões, limites diários visíveis por mensagem quando atingidos.
9. **Saída** — exclusão de agente rascunho e de fontes; páginas legais.

## Lead atendido pela plataforma (funil Axtro)

Diagnóstico no site → Raissa LIGA (voz, control-tower) → "vídeo agora?" →
`/api/leads/video-session` cria a sala com o contexto da ligação → lead
conversa com a Raissa em vídeo. Agendou? Evento no calendário + na hora, se
o humano não aparece, o bot entra na reunião e a câmera vira a Raissa.

## Momentos de valor

- **1º valor do tenant**: primeira resposta do agente citando o conhecimento
  DA CONTA no sandbox (minutos após o cadastro, sem configurar provider).
- **Valor recorrente**: agente conduzindo reunião real com leitura
  comportamental e Método Silva, custo por conversa visível no painel.
