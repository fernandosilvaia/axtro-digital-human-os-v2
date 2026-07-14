# Lançamento recomendado do Codex

## CLI local

Na raiz do repositório:

```bash
python3 scripts/validate_all.py
codex --sandbox workspace-write --ask-for-approval on-request
```

O arquivo `.codex/config.toml` mantém os mesmos defaults quando o projeto é confiável. A rede fica bloqueada no workspace por padrão e pode exigir aprovação para instalar dependências ou consultar documentação.

Depois cole o conteúdo de `PROMPT_EXECUCAO_AUTONOMA_CODEX.md`.

## Aplicativo ou IDE

1. Abra a pasta completa como projeto.
2. Confirme que o projeto é confiável para carregar `.codex/config.toml`.
3. Escolha o modo de escrita no workspace com aprovação para escalonamentos.
4. Cole o prompt de execução.
5. Acompanhe `PROGRESS.md` e os subagentes, não apenas a resposta final.

Não use full access, rede aberta ou bypass de approvals como padrão. O Codex lê `AGENTS.md`, combina instruções mais específicas por diretório, descobre skills em `.agents/skills/` e carrega agentes do projeto em `.codex/agents/`.
