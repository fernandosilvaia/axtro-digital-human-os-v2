"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { removeMember } from "@/lib/actions/team";

/**
 * Revoga o acesso de um membro já aceito (achado da auditoria 2026-08-06 —
 * só existia "Revogar" pra convite pendente). Dois cliques deliberados,
 * mesmo padrão de agent-delete-button.tsx: desarma em 8s sem confirmar.
 */
export function MemberRemoveButton({ userId, memberEmail }: { userId: string; memberEmail: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 8000);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await removeMember(userId);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onClick}
        disabled={pending}
        aria-label={confirming ? `Confirmar remoção de ${memberEmail}` : `Remover ${memberEmail} da equipe`}
        style={{ padding: "4px 10px", fontSize: "0.78rem", borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}
      >
        {pending ? "Removendo…" : confirming ? "Confirmar?" : "Remover"}
      </button>
      {error && <span className="form-error" role="alert" style={{ fontSize: "0.72rem", maxWidth: 200, textAlign: "right" }}>{error}</span>}
    </span>
  );
}
