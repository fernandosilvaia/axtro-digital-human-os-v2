"use client";

import { useActionState } from "react";

import { sendClosingProposal, type ProposalActionState } from "@/lib/actions/proposal";
import { PLAN_CATALOG, PLAN_ORDER } from "@/lib/billing/plans";

const initialState: ProposalActionState = { error: null, done: false };

/**
 * Fechamento ao vivo (D-V2-123): depois da call, um admin revisa e dispara
 * a proposta — nunca a IA sozinha ("IA rascunha, humano manda"). Fica no
 * Testar do agente porque é o mesmo lugar onde a conversa/apresentação
 * aconteceu — o link de checkout sai por e-mail pro prospect, não aqui.
 */
export function ClosingProposal({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [state, formAction, pending] = useActionState(sendClosingProposal, initialState);

  return (
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="fechar-proposta">
      <h3 id="fechar-proposta" style={{ fontSize: "0.95rem", marginBottom: 4 }}>
        Fechar e enviar proposta 📩
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", margin: "0 0 14px" }}>
        Depois de {agentName} conduzir o fechamento numa call, registre a empresa e o plano combinado —
        a proposta com o link de confirmação vai por e-mail pro prospect. Revisão sua, nunca automático.
      </p>

      <form action={formAction}>
        <input type="hidden" name="agent_id" value={agentId} />
        <div className="form-row form-row-3">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="proposal-company">Empresa do prospect</label>
            <input id="proposal-company" name="prospect_company" type="text" minLength={1} maxLength={160} required autoComplete="off" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="proposal-email">E-mail do prospect</label>
            <input id="proposal-email" name="prospect_email" type="email" required autoComplete="off" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="proposal-plan">Plano combinado</label>
            <select id="proposal-plan" name="plan_id" defaultValue={PLAN_ORDER[0]}>
              {PLAN_ORDER.map((id) => (
                <option key={id} value={id}>{PLAN_CATALOG[id].name}</option>
              ))}
            </select>
          </div>
        </div>

        {state.error && <p className="form-error" role="alert" style={{ margin: "12px 0 0" }}>{state.error}</p>}
        {state.done && !state.error && (
          <p className="saved-flag" role="status" style={{ marginTop: 12 }}>
            ✓ Proposta enviada — o prospect recebeu o link de confirmação por e-mail.
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={pending} style={{ padding: "11px 20px", marginTop: 14 }}>
          {pending ? "Enviando…" : "Enviar proposta"}
        </button>
      </form>
    </section>
  );
}
