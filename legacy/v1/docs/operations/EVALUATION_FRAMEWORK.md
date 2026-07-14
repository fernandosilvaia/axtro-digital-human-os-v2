# EVALUATION_FRAMEWORK.md — como sabemos que o vendedor IA é bom

> Status: PROPOSTO. Princípio: **nenhuma mudança de prompt, modelo, voz ou metodologia chega a produção sem passar pelos gates**. Avaliação é cidadã de primeira classe do repositório (`packages/evaluation`).

## 1. Camadas de avaliação
1. **Unit evals** (rápidas, rodam em todo PR): classificadores (intenção, objeção, EOT), extratores (SILVA scores, campos de handoff), validador de preço, guardrails. Datasets versionados em `packages/evaluation/datasets/`.
2. **Golden conversations** (regressão): ~40 conversas de referência (F1) cobrindo a esteira Silva — 10 qualificação SDR, 10 reunião de fechamento, 10 objeções mortais (as 9 do manual + preço), 5 handoff, 5 edge (silêncio, ruído, lead grosseiro, pedido fora de escopo, pedido de desconto acima do limite). Cada golden tem: transcript esperado por fase, estados SILVA esperados, ações permitidas/proibidas. Replay: motor roda com lead simulado por script determinístico + LLM-judge compara.
3. **Simulated buyers** (qualidade): personas LLM parametrizadas pelos 4 tipos de lead do Método Silva (curioso, comparador, pronto, urgente) × 3 temperamentos (colaborativo, cético, apressado) = 12 personas base. Rodam N conversas completas por release; métricas humanas+comerciais calculadas como em produção.
4. **Adversarial** (segurança): suíte de prompt injection por voz (T01), doc envenenado (T02), extração de prompt (T15), pedido de desconto proibido, tentativa de tool não autorizada, tópicos fora de escopo, pedidos de conteúdo impróprio. Aprovação = 0 violações críticas.
5. **Human review** (calibração): amostra semanal de 10 calls reais avaliadas por humano com a mesma rubrica do LLM-judge; desvio judge vs humano > 0,5 ponto ⇒ recalibrar judge antes de confiar nos números.

## 2. Rubrica do LLM-judge (1–5 por dimensão)
Naturalidade · Aderência à metodologia (fases na ordem, perguntas certas na fase certa) · Escuta ativa (usa o que o lead disse) · Precisão factual (0 alucinação de preço/feature) · Condução (avança o funil sem atropelar) · Compliance (disclosure, tom). Judge: Claude Sonnet com prompt versionado; saída JSON com evidência (citação do trecho) por nota.

## 3. Gates bloqueantes (CI/CD)
| Gate | Quando roda | Critério de aprovação |
|---|---|---|
| G1 Unit evals | todo PR | acurácia ≥ baseline − 1pp; zero regressão em guardrails |
| G2 Golden replay | PR que toca prompt/motor/metodologia | 100% ações proibidas bloqueadas; estados SILVA corretos ≥ 90%; judge ≥ 4,0 média |
| G3 Adversarial | PR que toca prompt/tools/guardrails + nightly | 0 violações críticas |
| G4 Simulated buyers | pré-release (staging) | métricas humanas dentro dos alvos (OBSERVABILITY §3); conversão simulada ≥ baseline − 10% relativo |
| G5 Canário em produção | pós-deploy | 5% do tráfego por 24h; auto-rollback se drop_rate/latência/robotic_markers piorarem além do limiar |
| G6 Ativação de versão de agente (por tenant) | tenant publica novo prompt/knowledge | mini-suite (G1 subset + 3 simulated buyers) no agente daquele tenant; falhou ⇒ não ativa, mostra relatório |

## 4. Avaliação contínua em produção
Todos os cálculos de métricas humanas rodam em 100% das calls (F1). Painel de drift semanal: naturalness, talk_ratio, conversão por fase. Alertas quando um tenant específico degrada (pode ser knowledge ruim dele — sugerir correção via Axtro Agent).

## 5. Datasets — origem e higiene
Seeds iniciais: golden escritas à mão a partir dos 8 manuais do Método Silva (tenant zero). Produção: calls reais só entram em dataset com base legal adequada e anonimização (nomes/números mascarados); flag por tenant para opt-out de melhoria. Versionamento com DVC-lite (hash+manifest no repo).
