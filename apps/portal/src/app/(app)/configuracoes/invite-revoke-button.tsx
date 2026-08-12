"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";

import { revokeInvite } from "@/lib/actions/team";

/**
 * Achado D-V2-109: sem estado de carregamento e engolindo erro de RPC em
 * silêncio — inconsistente com InviteForm/MemberRemoveButton no mesmo
 * arquivo. Sem confirmação dupla (diferente de MemberRemoveButton): revogar
 * um convite pendente é reversível (basta convidar de novo), stakes bem
 * menores que remover um membro já ativo.
 */
export function InviteRevokeButton({ inviteId, inviteEmail }: { inviteId: string; inviteEmail: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await revokeInvite(inviteId);
      if (result.error) {
        setError(result.error);
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
        aria-label={`Revogar convite para ${inviteEmail}`}
        style={{ padding: "4px 10px", fontSize: "0.78rem" }}
      >
        {pending ? "Revogando…" : "Revogar"}
      </button>
      {error && <span className="form-error" role="alert" style={{ fontSize: "0.72rem", maxWidth: 200, textAlign: "right" }}>{error}</span>}
    </span>
  );
}
