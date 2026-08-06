"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteDraftAgent } from "@/lib/actions/resources";

/**
 * Exclusão de agente em rascunho (admin). Dois cliques deliberados — o
 * segundo confirma — porque exclusão é irreversível e libera o limite da
 * conta. Agentes com histórico de sessões são recusados pela RPC.
 */
export function AgentDeleteButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      // Confirmação destrutiva não fica "armada" pra sempre: desarma em 8s
      // sem clique (auditoria 2026-08-02 — clique acidental atrasado excluía).
      // 8s e não 5s: no build de produção o re-render RSC pós-action é mais
      // lento e 5s desarmava ANTES do segundo clique legítimo (pego pelo e2e
      // em modo produção, D-V2-103).
      setTimeout(() => setConfirming(false), 8000);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteDraftAgent(agentId);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
      } else {
        // Refresh explícito: ver nota no AgentStatusToggle (flake de revalidação em prod).
        router.refresh();
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onClick}
        disabled={pending}
        aria-label={confirming ? `Confirmar exclusão de ${agentName}` : `Excluir o rascunho ${agentName}`}
        style={{ padding: "5px 11px", fontSize: "0.8rem", borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}
      >
        {pending ? "Excluindo…" : confirming ? "Confirmar exclusão?" : "Excluir"}
      </button>
      {error && <span className="form-error" role="alert" style={{ fontSize: "0.72rem", maxWidth: 220 }}>{error}</span>}
    </span>
  );
}
