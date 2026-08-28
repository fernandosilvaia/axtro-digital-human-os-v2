"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botão de submit que se desabilita assim que clicado, até a server action
 * terminar (redirect ou erro). Sem isso, o botão "Assinar" aceitava duplo
 * clique/duas abas e cada clique gerava uma Checkout Session Stripe distinta
 * — mesmo com a chave de idempotência do lado servidor (billing.ts), um
 * botão vivo continua deixando o usuário disparar N requisições em paralelo
 * antes da primeira responder (achado da auditoria 2026-08-06).
 */
export function SubmitOnceButton({
  className,
  style,
  children,
  pendingLabel = "Abrindo o checkout…",
}: {
  className: string;
  style?: CSSProperties;
  children: ReactNode;
  /** Rótulo mostrado enquanto a action está em voo. Default preserva o texto original (contexto de checkout, o único chamador até a onda 1b-ii). */
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} style={style} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
