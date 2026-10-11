# Laboratório de voz e turno: Pipecat comandando a Tavus

Na produção de hoje, a Tavus faz a chamada inteira: escuta, decide quando a pessoa terminou, chama o cérebro, fala e renderiza o rosto. Este laboratório separa as peças para medir cada uma. A Tavus fica só com o rosto, e o resto passa a ser nosso:

| Peça | Escolha do laboratório | Licença | O que se quer medir |
|---|---|---|---|
| Rosto | `TavusVideoService`, persona especial `pipecat0` (usa a nossa voz) | serviço pago | se o rosto acompanha uma voz que não é da Tavus |
| Fim do turno | Silero VAD mais Smart Turn v3 local, em CPU | MIT e BSD-2 | menos interrupção quando a pessoa só respirou, e menos espera quando ela terminou |
| Cérebro | a mesma rota `/api/brain/<agentId>` da produção | nosso | nada muda: doutrina, sentinela e teto de entrada iguais |
| Voz | ElevenLabs como base; Chatterbox ou Qwen3-TTS por servidor local compatível com a OpenAI | MIT e Apache-2.0 | se alguma voz aberta ganha no teste cego |
| Ouvido | Whisper local (faster-whisper) | MIT | latência e erro em português e espanhol |

## Peças

| Arquivo | O que é |
|---|---|
| `pipeline.py` | Monta a pipeline. Sem confirmação, só valida a configuração e mostra o plano, sem rede e sem segredo na saída. |
| `lines.json` | 18 falas da Priscila (6 por idioma) com o que costuma quebrar uma voz sintética: divulgação de IA, acolhimento, números grandes, siglas, pergunta e frase longa. |
| `blind_test.py` | Prepara a sessão cega (clipes com nome opaco, ordem embaralhada, chave separada) e dá o veredito por idioma. |
| `requirements.txt` | Pipecat 1.12.0 com os extras usados. Instalar num ambiente separado. |

## Teste cego: só troca se ganhar

1. Gerar os áudios das 18 falas em cada motor: ElevenLabs e cada candidata aberta.
2. `blind_test.py prepare --manifest clips.json --session /abs/sessao`. O manifesto lista motor, idioma, fala, caminho absoluto e SHA-256 de cada arquivo. Todo motor precisa cobrir as mesmas falas.
3. Entregar a pasta `clips/` e o `sheet.csv` a cada ouvinte. Cada um dá nota de 1 a 5 para naturalidade e pronúncia. O `key.json` fica só com quem conduz o teste.
4. `blind_test.py score --session /abs/sessao ana.csv bruno.csv ...`

A comparação é pareada (mesmo ouvinte, mesma fala) contra o ElevenLabs, com intervalo de 95% por bootstrap. O veredito "switch" só sai quando:
- o limite inferior da diferença de naturalidade fica acima de zero;
- a pronúncia não cai mais que 0,25.

Com menos de 12 pares, o veredito é "dados insuficientes". Ouvintes nativos de cada idioma, e de preferência gente que não sabe quais motores estão no teste.

## Subir a pipeline (gate do Fernando)

```bash
VOICE_LAB_BRAIN_BASE_URL=https://<portal>/api/brain/<agentId> \
VOICE_LAB_BRAIN_SECRET=... TAVUS_API_KEY=... TAVUS_REPLICA_ID=... \
VOICE_LAB_DAILY_ROOM_URL=https://<sala-de-teste>.daily.co/<sala> \
VOICE_LAB_TTS=elevenlabs ELEVENLABS_API_KEY=... VOICE_LAB_TTS_VOICE=<voice_id> \
VOICE_LAB_LIVE_CONFIRM=spend-tavus-and-voice-credit \
python experiments/voice-lab/pipeline.py
```

Para uma voz aberta, use `VOICE_LAB_TTS=openai-compatible` e `VOICE_LAB_TTS_BASE_URL=http://localhost:<porta>/v1`. O servidor da voz roda à parte, e o código só aceita endereço de loopback: o texto da Priscila não sai para outro host. O modo de plano mostra o host do cérebro, que é para onde o segredo vai como bearer: confira antes de subir. Gasta Tavus, Daily, a voz escolhida e o cérebro. É sempre sala de teste, nunca chamada de cliente.

## O que ainda exige gente

- Escolher a réplica e as vozes candidatas.
- Baixar os pesos das vozes abertas (vários GB) e rodar o servidor local.
- Autorizar o gasto da Tavus e da voz.
- Recrutar os ouvintes.
- Confirmar o direito sobre qualquer voz clonada antes de circular os clipes (voz é dado biométrico).

A pasta da sessão do teste cego guarda áudio e a chave dos motores. O `blind_test.py` recusa uma sessão dentro do repositório, que é público.

A montagem foi conferida contra o Pipecat 1.12.0 instalado, num ambiente isolado e sem rede. A pipeline inteira é construída com as classes reais nas duas vozes, sem aviso de depreciação, e o modelo do Smart Turn v3.2 já vem no pacote (carrega em cerca de 20 ms em CPU). Duas armadilhas dessa versão já estão tratadas:

- o `DailyParams` aceita `vad_analyzer` mas descarta em silêncio, então o VAD fica no agregador do usuário;
- modelo e voz vão em `settings`.

O que ainda não rodou é a chamada contra Tavus e Daily reais. O primeiro teste pago é também o primeiro teste de integração.
