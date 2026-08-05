"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botão de submit dos CTAs de demo da landing. signInDemo faz login real no
 * Supabase antes do redirect (leva segundos) — sem estado pendente o CTA
 * principal do site ficava mudo e aceitava cliques repetidos (auditoria
 * 2026-08-02), destoando de todos os outros botões do produto.
 */
export function DemoSubmitButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? "Abrindo a demonstração…" : children}
    </button>
  );
}
