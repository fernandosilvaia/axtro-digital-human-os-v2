"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { SubmitOnceButton } from "./submit-once-button";

/**
 * Confirmação de dois cliques pra um `<form action>` real (mesmo padrão de
 * desarme em 8s de `calendar-disconnect-button.tsx`/`member-remove-button.tsx`,
 * adaptado pra continuar sendo um submit de formulário de verdade em vez de
 * uma chamada direta de action: as ações de disposição de dados sempre
 * redirecionam com `governance_status`/`governance_error`, nunca devolvem
 * `{error}` pro componente ler). Primeiro clique só arma o segundo; o
 * formulário só é de fato submetido no clique de confirmação.
 */
export function ConfirmSubmitButton({
  className,
  style = {},
  confirmLabel,
  pendingLabel,
  children,
}: {
  readonly className: string;
  readonly style?: CSSProperties;
  readonly confirmLabel: ReactNode;
  readonly pendingLabel: string;
  readonly children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        onClick={() => {
          setConfirming(true);
          setTimeout(() => setConfirming(false), 8000);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <SubmitOnceButton className={className} style={style} pendingLabel={pendingLabel}>
      {confirmLabel}
    </SubmitOnceButton>
  );
}
