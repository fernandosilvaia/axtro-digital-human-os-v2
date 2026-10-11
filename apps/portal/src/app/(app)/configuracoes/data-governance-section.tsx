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
  requested: "Pedido registrado, em verificação",
  approval_pending: "Aguardando aprovação",
  authorized: "Aprovado, aguardando execução pela equipe Axtro",
};

const STATUS_MESSAGE: Readonly<Record<string, string>> = {
  solicitado: "Pedido de exclusão registrado.",
  registrado: "Decisão registrada.",
  cancelado: "Pedido de exclusão cancelado.",
};

const ERROR_MESSAGE: Readonly<Record<string, string>> = {
  motivo_invalido: "Selecione um dos motivos disponíveis.",
  nao_disponivel: "A exclusão de todos os dados ainda não está disponível para esta conta. Nenhum pedido foi aberto. Se precisar apagar os dados agora, fale com o suporte.",
  pedido_ja_existe: "Esta conta já tem um pedido de exclusão em andamento.",
  tenant_nao_admite: "Esta conta não aceita um pedido de exclusão agora (conta suspensa ou encerramento já em andamento).",
  apenas_admin: "Só um administrador da conta pode ver ou agir sobre pedidos de exclusão de dados.",
  falha_ao_solicitar: "Não foi possível registrar o pedido agora. Tente novamente em instantes.",
  nao_aprovavel: "Este pedido não está mais aguardando aprovação (pode já ter sido decidido por outro administrador).",
  autoaprovacao_bloqueada: "Quem abriu o pedido de exclusão não pode registrar uma das aprovações dele. Peça a outro administrador da conta pra aprovar ou negar.",
  falha_ao_aprovar: "Não foi possível registrar a decisão agora. Tente novamente em instantes.",
  nao_cancelavel: "Este pedido não pode mais ser cancelado nesta fase.",
  falha_ao_cancelar: "Não foi possível cancelar o pedido agora. Tente novamente em instantes.",
};

/**
 * M6-04, ADR-046, fatia 1 (D-V2-182): pedido de exclusão `scope=tenant`,
 * request/approve/status/cancel usando as próprias RPCs `_authenticated` da
 * migration 0059, com a mesma autorização que qualquer `tenant_admin` real
 * teria. Nunca avança um pedido além de `authorized`: nada irreversível é
 * alcançável por esta tela. `attestationReady=false` (os verificadores
 * externos nunca foram provisionados fora do harness de teste local) é o
 * desfecho esperado em todo ambiente real hoje. O formulário existe e
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
      <h2 id="governanca-de-dados" className="section-title">Excluir todos os dados da conta</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: "0 0 14px" }}>
        Abre um pedido formal para apagar todos os dados desta conta. Dois administradores diferentes
        precisam aprovar. Depois disso, o pedido aguarda a execução pela equipe Axtro.
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
              <ConfirmSubmitButton className="btn btn-ghost" style={{ padding: "9px 16px" }} pendingLabel="Registrando…" confirmLabel="Confirmar negação?">
                Negar
              </ConfirmSubmitButton>
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
