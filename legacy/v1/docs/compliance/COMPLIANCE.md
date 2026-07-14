# COMPLIANCE.md — LGPD, identificação de IA, gravação, telefonia e voz

> Status: PROPOSTO — **este documento não é aconselhamento jurídico**; é a especificação técnica dos controles. Validação com advogado registrada como pendência externa (PENDENCIAS_EXTERNAS.md §Jurídico). Datas de referência de normas: consultadas em 2026-07-13.

## 1. LGPD (Lei 13.709/2018) — papel e bases
- **Papéis:** o tenant é o **controlador** dos dados dos seus leads; a Axtro é **operadora**. O contrato (DPA) deve refletir isso; template de DPA é pendência jurídica.
- **Bases legais por fluxo (proposta):** inbound/atendimento e negociação pré-contratual ⇒ *execução de contrato/procedimentos preliminares* (art. 7º V); outbound/prospecção ⇒ *legítimo interesse* (art. 7º IX) com LIA documentada pelo tenant + opt-out fácil; gravação para treinamento/qualidade ⇒ consentimento ou legítimo interesse conforme configuração do tenant.
- **Direitos do titular:** endpoint e fluxo operacional para acesso, correção, eliminação e portabilidade; eliminação propaga para transcript, gravação, memórias, embeddings (delete físico ou crypto-shredding do chunk) e backups no ciclo de rotação. SLA interno: 15 dias.
- **Retenção (defaults, configurável por tenant):** áudio bruto 90d · transcript 24 meses · SalesSessionState/CRM enquanto durar a relação · logs técnicos 12 meses · eventos de auditoria 5 anos. Job de expurgo diário auditado.
- **Residência:** dados em repouso na região São Paulo (Supabase/storage). Providers de IA processam voz/texto fora do BR ⇒ cláusulas de transferência internacional no DPA e listagem transparente de suboperadores (página pública por tenant white-label).
- **RIPD/DPIA:** obrigatória antes da F4 (self-serve) — template incluído como pendência.

## 2. Identificação de IA (disclosure)
- **Regra da plataforma (não negociável):** todo agente se identifica como assistente virtual/IA **no primeiro turno** de qualquer canal de voz/vídeo. O tenant configura *como* (nome, naturalidade do texto), nunca *se*.
- **Template default PT-BR (voz):** "Oi, [nome do lead]? Aqui é a [nome do agente], assistente virtual da [empresa]. [frase de propósito]. Tudo bem falarmos rapidinho?"
- **Racional:** PL 2338/2023 (marco da IA) em tramitação prevê dever de transparência; CDC art. 6º (informação clara) já sustenta a exigência; além de ser diferencial de confiança vs concorrentes que escondem. Reavaliar redação quando o marco for sancionado (pendência de monitoramento).
- Disclosure registrado em `compliance.ai_disclosed` no SalesSessionState — sessão sem esse flag ⇒ alerta de auditoria.

## 3. Gravação e consentimento
- **Chamada 1:1 (telefonia/sala):** aviso no início ("essa conversa pode ser gravada para qualidade") embutido no fluxo de abertura; prosseguir = consentimento tácito registrado com timestamp. Opção do tenant: exigir "sim" explícito (setores sensíveis).
- **Reuniões multi-participante (F3, Meet/Zoom):** bot anuncia gravação ao entrar + banner nativo da plataforma; se host negar, bot participa sem gravar (transcript efêmero em RAM para o estado, sem persistir áudio) ou sai, conforme política do tenant.
- `recording_consent` no estado + evidência (trecho de áudio do aviso) retida junto da gravação.

## 4. Clonagem de voz e avatar
- Clonagem **somente** com fluxo de consentimento: titular grava frase de autorização padrão + upload de documento/assinatura eletrônica; evidência arquivada e vinculada ao `voice_id`. Sem evidência ⇒ upload bloqueado tecnicamente.
- Avatares Tavus: apenas replicas com consentimento equivalente ou avatares estoque licenciados. Proibido criar réplica de terceiro identificável sem vínculo com o tenant.
- Revogação: titular pode revogar ⇒ voice/replica desativada ≤48h; gravações passadas permanecem (base legal própria), novos usos cessam.

## 5. Telefonia (Telnyx, número US +1 617... hoje; BR na F3)
- **Horário de chamadas ativas (outbound):** default 9h–20h no fuso do lead, seg–sáb (parametrizável mais restrito, nunca mais amplo). Referência: boas práticas Procon/telemarketing.
- **Opt-out:** pedido verbal de "não me ligue mais" ⇒ tool `dnc_add` imediata, confirmação verbal, bloqueio em toda a plataforma para aquele tenant.
- **Bloqueio Não Me Perturbe:** integração com listas estaduais/Anatel na F3 (quando outbound BR ativar) — pendência externa.
- **EUA (número atual):** se usado para leads nos EUA, TCPA exige consentimento prévio para robocalls — por padrão a plataforma **bloqueia outbound frio via IA para números US** sem flag de consentimento importado. Inbound e agendado seguem liberados.
- Caller ID sempre verdadeiro (STIR/SHAKEN via Telnyx); spoofing proibido por política técnica.

## 6. Setores regulados
Onboarding classifica o tenant por setor. `saude | financeiro | juridico | educacao_regulada | outros`. Setores sensíveis ⇒ (a) templates com disclaimers obrigatórios ("não é aconselhamento médico/jurídico/financeiro"), (b) tools de pagamento/proposta exigem aprovação humana por default, (c) revisão manual do agente antes de ativar (até F4; depois, checklist automatizado + amostragem).

## 7. Checklist de conformidade por sessão (gerado automaticamente)
`ai_disclosed ✓ · recording_notice ✓ · consent_status · dnc_checked · horário permitido ✓ · setor/disclaimers aplicados ✓` — anexado ao registro da sessão; falha em item obrigatório abre incidente de compliance no dashboard do tenant e conta em EVALUATION (gate de release).
