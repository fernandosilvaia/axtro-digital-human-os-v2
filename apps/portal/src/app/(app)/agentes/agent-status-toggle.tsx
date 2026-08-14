"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setAgentStatus } from "@/lib/actions/resources";

/**
 * Ativar/pausar agente (admin). Draft vira active (agente pronto para
 * conversar com o cérebro + fontes da conta) e active volta a draft (pausa).
 * Estados fora desse par (disabled/archived) não são alteráveis pelo portal.
 */
export function AgentStatusToggle({ agentId, status }: { agentId: string; status: string }) {
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (status !== "draft" && status !== "active") return null;
  const target = status === "draft" ? "active" : "draft";

  function toggle() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await setAgentStatus(agentId, target);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.warning) setWarning(result.warning);
      // Next 16 em build de produção descarta a revalidação da server action de forma intermitente (flake pego pelo e2e em modo produção, D-V2-103) — router.refresh() explícito torna a atualização da UI determinística.
      router.refresh();
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
      {warning && <span role="status" style={{ fontSize: "0.72rem", maxWidth: 220, color: "var(--text-muted)" }}>⚠ {warning}</span>}
    </span>
  );
}
