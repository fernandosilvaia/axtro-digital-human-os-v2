"use client";

import { useState, useTransition } from "react";

import { setAgentStatus } from "@/lib/actions/resources";

/**
 * Ativar/pausar agente (admin). Draft vira active (agente pronto para
 * conversar com o cérebro + fontes da conta) e active volta a draft (pausa).
 * Estados fora desse par (disabled/archived) não são alteráveis pelo portal.
 */
export function AgentStatusToggle({ agentId, status }: { agentId: string; status: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status !== "draft" && status !== "active") return null;
  const target = status === "draft" ? "active" : "draft";

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setAgentStatus(agentId, target);
      if (result.error) setError(result.error);
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className={target === "active" ? "btn btn-primary" : "btn btn-ghost"}
        onClick={toggle}
        disabled={pending}
        style={{ padding: "5px 11px", fontSize: "0.8rem" }}
      >
        {pending ? "Aplicando…" : target === "active" ? "Ativar" : "Pausar"}
      </button>
      {error && <span className="form-error" role="alert" style={{ fontSize: "0.72rem", maxWidth: 220 }}>{error}</span>}
    </span>
  );
}
