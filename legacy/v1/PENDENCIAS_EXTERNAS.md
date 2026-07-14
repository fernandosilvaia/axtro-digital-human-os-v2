# Pendências Externas (contas, chaves, aprovações)

Nenhum segredo deve ser colado neste repositório. Provisionar via Doppler (ou Supabase Vault) e referenciar por nome de variável.

## Contas a criar/confirmar (Fase 0–1)
| Serviço | Uso | Status | Variáveis esperadas |
|---|---|---|---|
| LiveKit Cloud | Sala Axtro, agents, SIP | criar | LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET |
| Supabase | Postgres, Auth, Storage, Vault | criar (projeto prod+staging) | SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE |
| Upstash Redis | Sessão, filas, streams | criar | REDIS_URL |
| OpenAI | Realtime S2S (flag), fallback LLM | criar/confirmar | OPENAI_API_KEY |
| Anthropic | LLM conversa/raciocínio via gateway | confirmar | ANTHROPIC_API_KEY |
| Deepgram | STT primário | criar | DEEPGRAM_API_KEY |
| ElevenLabs | TTS primário PT-BR | criar | ELEVENLABS_API_KEY |
| Cartesia | TTS fallback baixa latência | criar | CARTESIA_API_KEY |
| Google Cloud (OAuth) | Calendar/Gmail por tenant | configurar consent screen + client | GOOGLE_CLIENT_ID/SECRET |
| Telnyx | Telefonia (já existe: +1 617 450-5166) | confirmar acesso API + SIP trunk p/ LiveKit | TELNYX_API_KEY |
| Doppler | Secrets | criar | DOPPLER_TOKEN (CI) |
| Sentry / Grafana Cloud | Observabilidade | criar | SENTRY_DSN, OTEL_EXPORTER_* |
| Vercel + Fly.io + GitHub | Deploy e CI | criar/confirmar | tokens de deploy |

## Fase 2+
| Serviço | Uso | Observação |
|---|---|---|
| Tavus | Avatar CVI | Solicitar white-label/enterprise; registrar evidência de consentimento p/ clonagem de imagem/voz |
| Recall.ai | Meeting bot Meet/Zoom/Teams | Confirmar Output Media (publicar áudio+vídeo) e preços vigentes |
| Stripe | Billing SaaS + pagamento em call | Conta BR; avaliar provedor Pix (OpenPix/Pagar.me) — decisão registrada como aberta |
| Assinatura eletrônica | Propostas | Candidatos BR: ZapSign (primário proposto), Clicksign; DocuSign p/ enterprise |
| CRM externos | Adapters | HubSpot, Pipedrive, RD Station (ordem proposta p/ mercado BR) |

## Aprovações humanas necessárias
1. Texto padrão de **identificação de IA** por idioma/região (jurídico) — template em COMPLIANCE.md.
2. Política de **gravação e retenção** default (90 dias proposto).
3. **Vozes/rostos**: só clonar com termo de autorização assinado e arquivado (schema em COMPLIANCE.md).
4. Limites financeiros default de tools (desconto máx., valor máx. de cobrança sem aprovação).
5. Validação das cotações da planilha `UNIT_ECONOMICS.xlsx` na data da implementação (preços mudam).
