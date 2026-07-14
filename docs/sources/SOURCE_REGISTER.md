# Registro de fontes técnicas e comerciais

**Data de verificação:** 2026-07-14  
**Regra:** decisões temporais devem ser reconfirmadas em fonte oficial antes de promover provider, atualizar preço ou liberar produção.

Somente fontes primárias e páginas oficiais foram usadas nesta revisão.

## Codex e execução do repositório

| Tema | Fonte oficial | Fato verificado | Implicação arquitetural |
|---|---|---|---|
| AGENTS.md | https://developers.openai.com/codex/guides/agents-md | Codex lê instruções hierárquicas do repositório | `AGENTS.md` raiz e instruções por diretório são normativas |
| Subagents | https://developers.openai.com/codex/subagents | Subagentes podem ter papéis e sandbox próprios | Reviewers são read-only e apenas um worker escreve por write set |
| Skills | https://developers.openai.com/codex/build-skills | Skills do repositório ficam em `.agents/skills/` | Quatro workflows reutilizáveis foram instalados nessa pasta |
| Configuração | https://developers.openai.com/codex/config-basic | Configuração pode ser aplicada por projeto confiável | `.codex/config.toml` usa `workspace-write` e approvals `on-request` |
| Sandbox | https://developers.openai.com/codex/sandboxing | Rede e escrita podem ser limitadas por sandbox | Rede desabilitada por padrão e acesso externo sujeito a aprovação |
| Segurança e approvals | https://developers.openai.com/codex/agent-approvals-security | Bypass e full access não devem ser padrão | A automação é autônoma dentro de fronteiras, não irrestrita |

## Realtime, voz e turnos

| Tema | Fonte oficial | Fato verificado | Implicação arquitetural |
|---|---|---|---|
| OpenAI Realtime overview | https://developers.openai.com/api/docs/guides/realtime | Áudio realtime, streaming e tools são suportados | Adapter S2S permanece atrás do Model Gateway |
| Realtime conversations | https://developers.openai.com/api/docs/guides/realtime-conversations | Sessão Realtime possui duração máxima documentada de 60 minutos | Capability registry registra `max_session_duration`; rollover e fallback são obrigatórios |
| Realtime WebRTC | https://developers.openai.com/api/docs/guides/realtime-webrtc | WebRTC é o caminho recomendado para clientes browser | Tokens efêmeros e server-side controls evitam segredo no frontend |
| Realtime server controls | https://developers.openai.com/api/docs/guides/realtime-server-controls | Lógica privada e tools podem permanecer no servidor | O browser nunca recebe segredo ou autoridade de tool |
| LiveKit Agents | https://docs.livekit.io/agents/ | Agents participam da room e publicam mídia | LiveKit é boundary inicial da sala nativa, não domínio do produto |
| LiveKit turn detector | https://docs.livekit.io/agents/logic/turns/turn-detector/ | Detector combina semântica e sinais acústicos, com suporte multilíngue incluindo português | Bake-off compara detector de áudio, detector de texto e provider-native VAD |
| LiveKit avatars | https://docs.livekit.io/agents/models/avatar/ | Vários plugins de avatar estão disponíveis e Hedra aparece como deprecated | Tavus não é hardcoded; Hedra não entra na shortlist atual |
| Deepgram pricing | https://deepgram.com/pricing | Flux Multilingual tem preço público e turn detection embutido | Input de custo é datado e benchmark PT-BR é obrigatório |
| ElevenLabs API pricing | https://elevenlabs.io/pricing/api | TTS Flash/Turbo é cobrado por caracteres e Speech Engine por minuto | Workbook separa unidade de cobrança e não presume plano enterprise |

## Avatar e reuniões externas

| Tema | Fonte oficial | Fato verificado | Implicação arquitetural |
|---|---|---|---|
| Recall Output Media | https://docs.recall.ai/docs/stream-media | Uma webpage controlada pode publicar áudio e vídeo no Zoom, Google Meet, Teams e Webex | Meeting Edge Page deve ter CSP, token curto, heartbeat e fallback audio-only |
| Recall pricing | https://www.recall.ai/pricing | Pay-as-you-go público é cobrado por hora de gravação e inclui output de mídia | Custo por minuto é input datado, não contrato garantido |
| Tavus pricing | https://www.tavus.io/pricing | Planos públicos incluem minutos e limites de concorrência | Custo efetivo precisa considerar plano, overage e concorrência |
| LiveKit pricing | https://livekit.io/pricing | Agent session, WebRTC, gravação, observabilidade e inferência possuem métricas separadas | Ledger de custo deve capturar cada componente, não somente um valor agregado |

## Telefonia

| Tema | Fonte oficial | Fato verificado | Implicação arquitetural |
|---|---|---|---|
| Telnyx Voice API | https://telnyx.com/pricing/voice-api | Voice API cobra controle por minuto mais tarifa SIP | Unit economics separa controle e terminação |
| Telnyx Elastic SIP | https://telnyx.com/pricing/elastic-sip | Outbound parte de tarifa pública que varia por destino | Preço comercial exige rota, país, número e volume reais |

## Registro de preços no workbook

O arquivo `spreadsheets/UNIT_ECONOMICS_V2.xlsx` possui data-base e URL por input. Valores públicos podem mudar sem aviso. O modelo distingue:

- `Provider-sourced`: valor reproduzível na fonte na data-base;
- `Proxy público`: aproximação pública usada quando a cobrança real é tokenizada ou variável;
- `Premissa interna`: hipótese editável para planejamento;
- `Actual`: valor reconciliado com invoice e telemetria.

A presença de uma integração ou preço público não comprova qualidade em PT-BR, SLA, disponibilidade regional, adequação jurídica ou custo final. Isso é decidido por bake-off, contrato e dados reais.
