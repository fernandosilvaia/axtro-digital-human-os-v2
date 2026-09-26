import {
  approveTenantDataGovernanceDispositionRequest,
  cancelTenantDataGovernanceDispositionRequest,
  denyTenantDataGovernanceDispositionRequest,
  submitTenantDataGovernanceDispositionRequest,
  type ActiveDataGovernanceDispositionResult,
} from "@/lib/actions/data-governance-disposition";
import { ConfirmSubmitButton } from "./confirm-submit-button";
import { SubmitOnceButton } from "./submit-once-button";

const PURPOSE_LABEL: Readonly<Record<string, string>> = {
  contract_termination: "Fim de contrato",
  retention_expiry: "Expiração do prazo de retenção",
  operator_correction: "Correção operacional",
};

const STATE_LABEL: Readonly<Record<string, string>> = {
  requested: "Solicitado, aguardando decisão de política",
  approval_pending: "Aguardando aprovação",
  authorized: "Autorizado, aguardando execução",
};

const STATUS_MESSAGE: Readonly<Record<string, string>> = {
  solicitado: "Pedido de exclusão registrado.",
  registrado: "Decisão registrada.",
  cancelado: "Pedido de exclusão cancelado.",
};

const ERROR_MESSAGE: Readonly<Record<string, string>> = {
  motivo_invalido: "Selecione um dos motivos disponíveis.",
  nao_disponivel: "Este recurso ainda não está disponível neste ambiente: os verificadores externos (armazenamento, cache, índices, cópias em provider, Auth, Vault, backup) não foram provisionados. Nenhum pedido chega a existir.",
  pedido_ja_existe: "Este tenant já tem um pedido de exclusão em andamento.",
  tenant_nao_admite: "Este tenant não admite um pedido de exclusão agora (conta suspensa ou fechamento já em curso).",
  apenas_admin: "Só um administrador da conta pode ver ou agir sobre pedidos de exclusão de dados.",
  falha_ao_solicitar: "Não foi possível registrar o pedido agora. Tente novamente em instantes.",
  nao_aprovavel: "Este pedido não está mais aguardando aprovação (pode já ter sido decidido por outro administrador).",
  falha_ao_aprovar: "Não foi possível registrar a decisão agora. Tente novamente em instantes.",
  nao_cancelavel: "Este pedido não pode mais ser cancelado nesta fase.",
  falha_ao_cancelar: "Não foi possível cancelar o pedido agora. Tente novamente em instantes.",
};

/**
 * M6-04, ADR-046, fatia 1 (D-V2-182): pedido de exclusão `scope=tenant`,
 * request/approve/status/cancel usando as próprias RPCs `_authenticated` da
 * migration 0059 -- a mesma autorização que qualquer `tenant_admin` real
 * teria. Nunca avança um pedido além de `authorized`: nada irreversível é
 * alcançável por esta tela. `attestationReady=false` (os verificadores
 * externos nunca foram provisionados fora do harness de teste local) é o
 * desfecho esperado em todo ambiente real hoje -- o formulário existe e
 * funciona ponta a ponta, só o resultado final é "ainda não disponível".
 */
export function DataGovernanceSection({
  active,
  isAdmin,
  governanceStatus,
  governanceError,
}: {
  readonly active: ActiveDataGovernanceDispositionResult;
  readonly isAdmin: boolean;
  readonly governanceStatus: string | null;
  readonly governanceError: string | null;
}) {
  return (
    <section className="card" aria-labelledby="governanca-de-dados" style={{ gridColumn: "1 / -1" }}>
      <h2 id="governanca-de-dados" className="section-title">Exclusão de dados do tenant</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: "0 0 14px" }}>
        Abre um pedido formal de exclusão de todos os dados desta conta (ADR-046). Exige aprovação de
        dois administradores distintos antes de autorizar, e nunca executa a exclusão de fato por
        aqui -- essa etapa depende de um worker separado, ainda não ligado.
      </p>

      {governanceStatus && STATUS_MESSAGE[governanceStatus] && (
        <p className="saved-flag" role="status" style={{ marginBottom: 14 }}>
          ✓ {STATUS_MESSAGE[governanceStatus]}
        </p>
      )}
      {governanceError && (
        <p className="form-error" role="alert" style={{ marginBottom: 14 }}>
          {ERROR_MESSAGE[governanceError] ?? "Não foi possível concluir a ação agora."}
        </p>
      )}

      {active.outcome === "service_unavailable" ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: 0 }}>
          O estado do pedido de exclusão está indisponível neste momento. Recarregue a página em
          instantes, o restante das configurações continua funcionando normalmente.
        </p>
      ) : active.outcome === "unauthorized" || !isAdmin ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: 0 }}>
          Só um administrador da conta pode ver ou agir sobre pedidos de exclusão de dados.
        </p>
      ) : active.outcome === "found" ? (
        <ActiveRequestCard status={active.status} />
      ) : (
        <RequestForm />
      )}
    </section>
  );
}

function ActiveRequestCard({
  status,
}: {
  readonly status: {
    readonly requestId: string;
    readonly state: string;
    readonly purposeCode: string;
    readonly requiredApprovals: number;
    readonly approvedCount: number;
    readonly deniedCount: number;
  };
}) {
  return (
    <div>
      <dl style={{ margin: "0 0 16px", display: "grid", gap: 8, fontSize: "0.88rem" }}>
        <Row label="Motivo" value={PURPOSE_LABEL[status.purposeCode] ?? status.purposeCode} />
        <Row label="Estado" value={STATE_LABEL[status.state] ?? status.state} />
        <Row label="Aprovações" value={`${status.approvedCount} de ${status.requiredApprovals}`} />
        {status.deniedCount > 0 && <Row label="Negações" value={String(status.deniedCount)} />}
      </dl>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {status.state === "approval_pending" && (
          <>
            <form action={approveTenantDataGovernanceDispositionRequest}>
              <input type="hidden" name="requestId" value={status.requestId} />
              <ConfirmSubmitButton className="btn btn-primary" style={{ padding: "9px 16px" }} pendingLabel="Aprovando…" confirmLabel="Confirmar aprovação?">
                Aprovar
              </ConfirmSubmitButton>
            </form>
            <form action={denyTenantDataGovernanceDispositionRequest}>
              <input type="hidden" name="requestId" value={status.requestId} />
              <SubmitOnceButton className="btn btn-ghost" style={{ padding: "9px 16px" }} pendingLabel="Registrando…">
                Negar
              </SubmitOnceButton>
            </form>
          </>
        )}
        <form action={cancelTenantDataGovernanceDispositionRequest}>
          <input type="hidden" name="requestId" value={status.requestId} />
          <SubmitOnceButton className="btn btn-ghost" style={{ padding: "9px 16px" }} pendingLabel="Cancelando…">
            Cancelar pedido
          </SubmitOnceButton>
        </form>
      </div>
    </div>
  );
}

function RequestForm() {
  return (
    <form action={submitTenantDataGovernanceDispositionRequest} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
        <label htmlFor="purposeCode">Motivo</label>
        <select id="purposeCode" name="purposeCode" defaultValue="contract_termination">
          {Object.entries(PURPOSE_LABEL).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
      </div>
      <ConfirmSubmitButton className="btn btn-primary" style={{ padding: "9px 16px" }} pendingLabel="Solicitando…" confirmLabel="Confirmar pedido?">
        Solicitar exclusão
      </ConfirmSubmitButton>
    </form>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
      <dt style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "right" }}>{value}</dd>
    </div>
  );
}
