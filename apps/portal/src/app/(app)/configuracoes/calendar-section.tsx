import { startGoogleCalendarConnection } from "@/lib/actions/calendar-connection";
import type { GoogleCalendarConnectionContext } from "@/lib/google-calendar/connection";
import { CalendarDisconnectButton } from "./calendar-disconnect-button";
import { SubmitOnceButton } from "./submit-once-button";

const ERROR_MESSAGE: Readonly<Record<string, string>> = {
  apenas_admin: "Só um administrador da conta pode conectar ou desconectar o Google Calendar.",
  conta_nao_provisionada: "Sua conta ainda não terminou de ser provisionada — recarregue em instantes.",
  sessao_invalida: "Não foi possível confirmar sua sessão. Recarregue a página e tente de novo.",
  sessao_divergente: "A sessão mudou no meio da conexão (ex.: outro login). Tente conectar de novo.",
  tentativas_excedidas: "Muitas tentativas de conexão em pouco tempo — aguarde um minuto e tente de novo.",
  nao_configurado: "A conexão com o Google Calendar ainda não está configurada neste ambiente. Fale com o suporte.",
  consentimento_negado: "A conexão foi cancelada — você precisa aceitar o acesso à agenda no Google para conectar.",
  callback_invalido: "O retorno do Google veio incompleto. Tente conectar de novo.",
  state_invalido: "Esta tentativa de conexão expirou ou já foi usada. Tente conectar de novo.",
  falha_na_troca: "O Google recusou a conexão. Tente novamente em instantes.",
  sem_refresh_token: "O Google não devolveu uma credencial de acesso contínuo desta vez — isso costuma acontecer quando esta conta Google já autorizou o acesso antes. Revogue o acesso em myaccount.google.com/permissions e tente conectar de novo.",
  sem_email_google: "Não foi possível confirmar o e-mail da conta Google conectada. Tente novamente.",
  falha_ao_conectar: "Não foi possível salvar a conexão agora. Tente novamente em instantes.",
};

export function CalendarSection({
  connection,
  isAdmin,
  calendarStatus,
  calendarError,
}: {
  /** null = leitura de conexão indisponível agora (o resto da página segue funcionando). */
  readonly connection: GoogleCalendarConnectionContext | null;
  readonly isAdmin: boolean;
  readonly calendarStatus: string | null;
  readonly calendarError: string | null;
}) {
  return (
    <section className="card" aria-labelledby="google-calendar" style={{ gridColumn: "1 / -1" }}>
      <h2 id="google-calendar" className="section-title">Google Calendar</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: "0 0 14px" }}>
        Conecte a agenda Google da sua conta para os agentes agendarem reuniões automaticamente.
      </p>

      {calendarStatus === "connected" && (
        <p className="saved-flag" role="status" style={{ marginBottom: 14 }}>
          ✓ Google Calendar conectado.
        </p>
      )}
      {calendarError && (
        <p className="form-error" role="alert" style={{ marginBottom: 14 }}>
          {ERROR_MESSAGE[calendarError] ?? "Não foi possível concluir a conexão com o Google Calendar."}
        </p>
      )}

      {connection === null ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: 0 }}>
          As informações de conexão estão indisponíveis neste momento. Recarregue a página em instantes —
          o restante das configurações continua funcionando normalmente.
        </p>
      ) : connection.outcome === "found" && connection.status === "connected" ? (
        <ConnectedCard email={connection.googleAccountEmail} calendarId={connection.calendarId} isAdmin={isAdmin} />
      ) : connection.outcome === "found" && connection.status === "reauth_required" ? (
        <ReauthRequiredCard email={connection.googleAccountEmail} isAdmin={isAdmin} />
      ) : (
        <NotConnectedCard isAdmin={isAdmin} />
      )}
    </section>
  );
}

function ConnectedCard({ email, calendarId, isAdmin }: { email: string; calendarId: string; isAdmin: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div>
        <p style={{ margin: 0, fontSize: "0.92rem" }}>
          Conectado como <strong>{email}</strong>
        </p>
        <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "var(--text-faint)" }}>
          Calendário: {calendarId === "primary" ? "principal da conta" : calendarId}
        </p>
      </div>
      {isAdmin ? (
        <CalendarDisconnectButton googleAccountEmail={email} />
      ) : (
        <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>Só um administrador pode desconectar</span>
      )}
    </div>
  );
}

function ReauthRequiredCard({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", margin: "0 0 14px" }}>
        A conexão com <strong>{email}</strong> precisa ser refeita — o Google invalidou o acesso anterior
        (ex.: revogação manual, senha trocada). Os agendamentos ficam indisponíveis até reconectar.
      </p>
      {isAdmin ? (
        <form action={startGoogleCalendarConnection}>
          <SubmitOnceButton className="btn btn-primary" style={{ padding: "9px 16px" }} pendingLabel="Reconectando…">
            Reconectar
          </SubmitOnceButton>
        </form>
      ) : (
        <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>Só um administrador pode reconectar</span>
      )}
    </div>
  );
}

function NotConnectedCard({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", margin: "0 0 14px" }}>
        Nenhuma agenda Google conectada ainda — os agentes não conseguem propor nem confirmar horários
        de reunião até uma conta ser conectada.
      </p>
      {isAdmin ? (
        <form action={startGoogleCalendarConnection}>
          <SubmitOnceButton className="btn btn-primary" style={{ padding: "9px 16px" }} pendingLabel="Conectando…">
            Conectar Google Calendar
          </SubmitOnceButton>
        </form>
      ) : (
        <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>Só um administrador pode conectar</span>
      )}
    </div>
  );
}
