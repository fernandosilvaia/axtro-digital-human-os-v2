"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteConversationTranscript } from "@/lib/actions/transcripts";

/**
 * Exclusão de uma conversa (achado P1, auditoria 2026-08-12 — a
 * /privacidade promete exclusão sob pedido, mas não havia UI pra isso).
 * Dois cliques deliberados, mesmo padrão de member-remove-button.tsx: é
 * destrutivo e irreversível, diferente de revogar convite.
 */
export function TranscriptDeleteButton({ id }: { id: string }) {
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
      const result = await deleteConversationTranscript(id);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
      } else {
        // refresh() ANTES do push() (achado da auto-revisão D-V2-114):
        // invalida o Router Cache do App Router inteiro, garantindo que
        // /conversas busque a lista atualizada em vez de servir um
        // snapshot em cache de antes da exclusão.
        router.refresh();
        router.push("/conversas");
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
        aria-label={confirming ? "Confirmar exclusão desta conversa" : "Excluir esta conversa"}
        style={{ padding: "6px 12px", fontSize: "0.82rem", borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}
      >
        {pending ? "Excluindo…" : confirming ? "Confirmar exclusão?" : "Excluir conversa"}
      </button>
      {error && <span className="form-error" role="alert" style={{ fontSize: "0.72rem", maxWidth: 240, textAlign: "right" }}>{error}</span>}
    </span>
  );
}
