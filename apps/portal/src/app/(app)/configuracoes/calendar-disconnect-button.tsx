"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { disconnectGoogleCalendar } from "@/lib/actions/calendar-connection";

/**
 * Desconecta o Google Calendar do tenant (apaga o segredo do Vault e marca
 * `revoked`). Dois cliques deliberados, mesmo padrão de
 * `member-remove-button.tsx`: desarma em 8s sem confirmar — revogar acesso
 * à agenda real de alguém tem stakes altos o bastante pra merecer
 * confirmação, mas não tão altos quanto remover um membro (não perde dados,
 * é reversível reconectando de novo).
 */
export function CalendarDisconnectButton({ googleAccountEmail }: { googleAccountEmail: string }) {
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
      const result = await disconnectGoogleCalendar();
      if (result.error) {
        setError(result.error);
        setConfirming(false);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onClick}
        disabled={pending}
        aria-label={confirming ? `Confirmar desconexão do Google Calendar (${googleAccountEmail})` : `Desconectar Google Calendar (${googleAccountEmail})`}
        style={{ padding: "9px 16px", borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}
      >
        {pending ? "Desconectando…" : confirming ? "Confirmar desconexão?" : "Desconectar"}
      </button>
      {error && <span className="form-error" role="alert" style={{ fontSize: "0.78rem" }}>{error}</span>}
    </span>
  );
}
