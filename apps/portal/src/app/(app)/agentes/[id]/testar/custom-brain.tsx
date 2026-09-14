"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { rotateAgentBrainSecret, setAgentBrainEnabled, type BrainStatusResult } from "@/lib/actions/agent-brain";

/**
 * Cérebro customizado do agente (D-V2-176).
 *
 * POR QUE ESTA TELA PRECISOU EXISTIR
 * O cérebro é o que faz a persona de vídeo usar a NOSSA doutrina em vez do
 * modelo padrão do provider: a Tavus chama `layers.llm.base_url` a cada turno,
 * e é nessa chamada que o portal monta o system prompt com o Método, a
 * vertical do agente, o conhecimento da conta e as tools de negócio.
 *
 * Toda a metade de servidor disso existia desde a 0018: tabela, três RPCs,
 * server actions e a própria rota do cérebro. O que nunca existiu foi a tela.
 * Sem ela, `agent_brain_config` ficava vazia para todo agente de todo tenant,
 * nenhuma persona tinha segredo para autenticar, e portanto NENHUMA call de
 * vídeo jamais passou pelo nosso prompt. Medido em 2026-09-14: sete agentes em
 * produção, zero com cérebro provisionado.
 *
 * É o tipo de defeito que não dá erro: a call acontece, a agente responde, e
 * ninguém percebe que ela está respondendo com o modelo cru do provider e sem
 * nenhuma das travas que escrevemos.
 *
 * O SEGREDO APARECE UMA VEZ
 * A action devolve o segredo bruto só na resposta da rotação; o banco guarda
 * apenas o hash e não sabe ler de volta. Então a tela mostra, avisa que não
 * vai mostrar de novo, e quem perder gera outro.
 */
export function CustomBrain({
  agentId,
  agentName,
  status,
  isAdmin,
  brainUrl,
}: {
  agentId: string;
  agentName: string;
  status: BrainStatusResult;
  isAdmin: boolean;
  brainUrl: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function rotate() {
    setError(null);
    startTransition(async () => {
      const result = await rotateAgentBrainSecret(agentId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSecret(result.secret);
      router.refresh();
    });
  }

  function toggle(enabled: boolean) {
    setError(null);
    setSecret(null);
    startTransition(async () => {
      const result = await setAgentBrainEnabled(agentId, enabled);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title">Cérebro customizado</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: "0 0 14px" }}>
        Liga a persona de vídeo de {agentName} ao cérebro desta conta. Sem isso a persona
        responde com o modelo padrão do provedor, sem o Método, sem o conhecimento da conta
        e sem as tools de agendamento.
      </p>

      {status.configured ? (
        <p style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>
          Estado: <strong>{status.enabled === true ? "ativo" : "configurado, porém desligado"}</strong>
          {status.rotatedAt !== null && (
            <span style={{ color: "var(--text-faint)", fontSize: "0.78rem" }}>
              {" "}· segredo gerado em {new Date(status.rotatedAt).toLocaleString("pt-BR")}
            </span>
          )}
        </p>
      ) : (
        <p style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>
          Estado: <strong>não configurado</strong>. Gere um segredo para começar.
        </p>
      )}

      {isAdmin ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={rotate} disabled={pending}>
            {pending ? "Aplicando…" : status.configured ? "Gerar novo segredo" : "Gerar segredo"}
          </button>
          {status.configured && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => toggle(status.enabled !== true)}
              disabled={pending}
            >
              {status.enabled === true ? "Desligar cérebro" : "Ligar cérebro"}
            </button>
          )}
        </div>
      ) : (
        <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", margin: 0 }}>
          Só um administrador da conta pode configurar o cérebro.
        </p>
      )}

      {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error}</p>}

      {secret !== null && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface-2, rgba(255,255,255,0.03))",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
            <strong>Copie agora.</strong> Este segredo não será exibido de novo: a conta guarda
            só o hash dele. Se perder, gere outro.
          </p>
          <p style={{ margin: "0 0 4px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            No provedor de vídeo, aponte o LLM da persona para:
          </p>
          <code style={{ display: "block", fontSize: "0.76rem", wordBreak: "break-all", marginBottom: 10 }}>
            {brainUrl}
          </code>
          <p style={{ margin: "0 0 4px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            E use este valor como chave de API da persona:
          </p>
          <code style={{ display: "block", fontSize: "0.8rem", wordBreak: "break-all" }}>{secret}</code>
        </div>
      )}
    </section>
  );
}
