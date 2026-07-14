# Behavior and Presence Director

## Objetivo

Converter intenção de diálogo em comportamento de voz e avatar consistente, natural e limitado pelas capacidades do provider.

## Estados canônicos
- `idle_ready`;
- `listening_neutral`;
- `listening_affirming`;
- `thinking_brief`;
- `speaking_explaining`;
- `speaking_empathic`;
- `presenting`;
- `interrupted_recovering`;
- `handoff_intro`;
- `technical_degraded`.

## Input

`BehaviorIntent` interno contém objetivo, energy, warmth, pacing, pause profile e nonverbal intent. Não contém comandos de animação livres.

## Output

`behavior_directive` validada contra `provider_capability`:
- canonical state;
- voice style;
- speaking rate range;
- pre-speech pause;
- allowed microgestures;
- gaze target;
- max duration;
- cancellation generation id.

## Naturalness scheduler

Evita padrão repetitivo por:
- cooldown por gesto;
- distribuição estocástica determinística por session seed;
- limite de nods e smiles por minuto;
- neutral idle predominante;
- prioridade a listening sobre performance visual.

## Voz

O Director pode controlar quando suportado:
- speed dentro de faixa segura;
- pitch ou style preset;
- pauses;
- pronunciation lexicon;
- emphasis markers aprovados.

Não altera fatos ou conteúdo da fala.

## Interrupção

Barge-in cancela directive ativa. O estado vai para `interrupted_recovering`, sem pedir desculpas mecanicamente a cada ocorrência. O próximo turno decide se retoma ou muda de assunto.

## Acessibilidade

- legendas e transcript não dependem do avatar;
- movimento reduzido configurável;
- avatar pode ser desligado sem perder funcionalidade;
- voz e velocidade ajustáveis quando permitido.
