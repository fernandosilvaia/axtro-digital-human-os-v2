"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botão de submit dos CTAs de demo da landing. A action cria somente o estado
 * assinado da simulação isolada. O estado pendente impede submits duplicados
 * enquanto o cookie curto é emitido e o navegador segue para `/demo`.
 */
export function DemoSubmitButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? "Preparando a simulação…" : children}
    </button>
  );
}
