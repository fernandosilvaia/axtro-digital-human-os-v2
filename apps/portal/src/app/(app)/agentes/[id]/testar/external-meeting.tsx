"use client";

import { useState, useTransition } from "react";

import { isTrustedTavusConversationUrl } from "@axtro/provider-tavus";

import { joinExternalMeeting, stopExternalMeeting } from "@/lib/actions/meeting-bot";

// ADR-038: the control plane must collect disclosure and purpose-specific
// consent from each participant before this can create a recording bot.
const EXTERNAL_MEETING_AVAILABLE = false;

/**
 * Leva o agente para uma reunião externa de verdade (Google Meet, Zoom,
 * Teams): o bot do Recall.ai entra na reunião e a sala de vídeo do agente
 * vira a câmera dele — os outros participantes veem e ouvem a agente como
 * um participante comum.
 *
 * O modo padrão é entrada IMEDIATA — pensado pra alguém já numa call ao
 * vivo colando o link na hora. O campo de data só aparece se a pessoa
 * escolher agendar explicitamente; assim "agora" nunca depende de acertar
 * um datetime-local no segundo exato (achado ao vivo 2026-08-14: o campo de
 * data sempre visível convidava a preencher um horário "agora" que já tinha
 * passado no momento em que o clique chegava no servidor, retornando "o
 * horário agendado já passou" bem no meio da call).
 */
export function ExternalMeeting({ agentId, agentName, timeZone }: { agentId: string; agentName: string; timeZone: string }) {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ scheduled: boolean; conversationUrl: string | null; commandId: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [stopping, startStopTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setStopError(null);
    setStopped(false);
    const commandId = crypto.randomUUID();
    // scheduleAt só é enviado quando a pessoa optou por agendar — entrada
    // imediata nunca lê este campo, então não existe como um valor "agora"
    // digitado ali virar sentinela silenciosa ou "horário já passou" por
    // atraso entre digitar e clicar.
    const effectiveScheduleAt = scheduling && scheduleAt.trim().length > 0 ? scheduleAt.trim() : null;
    startTransition(async () => {
      const result = await joinExternalMeeting(agentId, meetingUrl.trim(), effectiveScheduleAt, timeZone, commandId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.conversationUrl !== null && !isTrustedTavusConversationUrl(result.conversationUrl)) {
        setError("A sala de acompanhamento retornou um endereço não confiável.");
        return;
      }
      setSuccess({ scheduled: result.scheduled, conversationUrl: result.conversationUrl, commandId });
      setMeetingUrl("");
      setScheduleAt("");
      setScheduling(false);
    });
  }

  function stopMeeting() {
    if (!success) return;
    setStopError(null);
    const commandId = success.commandId;
    startStopTransition(async () => {
      try {
        const result = await stopExternalMeeting(agentId, commandId);
        // `stopped` não basta para a UI: o backend pode relatar que um lado
        // aceitou o pedido enquanto outro provider ainda está pendente. Só
        // uma confirmação integral, sem erro, encerra o retry do operador.
        if (result.stopped && result.error === null) {
          setStopped(true);
          return;
        }
        setStopped(false);
        setStopError(result.error ?? "Não foi possível confirmar o encerramento completo da reunião. Tente novamente.");
      } catch {
        // Mantém success/commandId para que o operador possa repetir o mesmo
        // stop idempotente depois de uma falha de transporte.
        setStopError("Não foi possível encerrar a reunião agora. Tente novamente.");
      }
    });
  }

  const returnedConversationUrl = success?.conversationUrl ?? null;
  const trustedConversationUrl = isTrustedTavusConversationUrl(returnedConversationUrl)
    ? returnedConversationUrl
    : null;

  return (
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="reuniao-externa">
      <h3 id="reuniao-externa" style={{ fontSize: "0.95rem", marginBottom: 4 }}>
        Levar para uma reunião externa 🎥
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", margin: "0 0 14px" }}>
        O fluxo de reuniões externas está em atualização para registrar disclosure e consentimento individual de cada participante antes de criar gravação, transcrição ou câmera de IA.
      </p>
      {!EXTERNAL_MEETING_AVAILABLE && (
        <p role="status" style={{ margin: "0 0 14px", padding: "10px 12px", borderRadius: 8, background: "rgba(255,195,107,0.10)", border: "1px solid rgba(255,195,107,0.28)", color: "var(--text-muted)", fontSize: "0.82rem" }}>
          Em breve: convite de participantes, confirmação por finalidade e recibo de sessão antes da entrada do agente.
        </p>
      )}

      <form onSubmit={submit}>
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="meeting-url">Link da reunião</label>
          <input
            id="meeting-url"
            type="url"
            required
            disabled={!EXTERNAL_MEETING_AVAILABLE}
            value={meetingUrl}
            onChange={(event) => setMeetingUrl(event.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
            autoComplete="off"
            style={{
              width: "100%",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 13px",
              color: "var(--text)",
              fontSize: "0.92rem",
              fontFamily: "inherit",
            }}
          />
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 400, cursor: "pointer", padding: "10px 0", minHeight: 44 }}>
            <input
              type="checkbox"
              checked={scheduling}
              disabled={!EXTERNAL_MEETING_AVAILABLE}
              style={{ width: 20, height: 20, flexShrink: 0 }}
              onChange={(event) => {
                setScheduling(event.target.checked);
                if (!event.target.checked) setScheduleAt("");
              }}
            />
            Agendar para mais tarde, em vez de entrar agora
          </label>
          {scheduling && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="meeting-schedule">
                Horário de entrada <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>(fuso {timeZone})</span>
              </label>
              <input
                id="meeting-schedule"
                type="datetime-local"
                required={scheduling}
                disabled={!EXTERNAL_MEETING_AVAILABLE}
                min={new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(" ", "T")}
                value={scheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 13px",
                  color: "var(--text)",
                  fontSize: "0.92rem",
                  fontFamily: "inherit",
                }}
              />
              <p style={{ fontSize: "0.74rem", color: "var(--text-faint)", margin: "6px 0 0" }}>
                No horário marcado ela entra silenciosa, como sentinela — a câmera liga depois,
                quando confirmamos que ela realmente entrou na chamada.
              </p>
            </div>
          )}
        </div>

        {error && <p className="form-error" role="alert" style={{ margin: "0 0 12px" }}>{error}</p>}

        {success && (
          <div className="saved-flag" role="status" style={{ margin: "0 0 12px", display: "block" }}>
            {success.scheduled
              ? `✓ ${agentName} vai entrar na reunião no horário marcado.`
              : `✓ ${agentName} está entrando na reunião agora — pode levar alguns segundos para aparecer.`}
            {trustedConversationUrl && (
              <>
                {" "}
                <a href={trustedConversationUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  Abrir a sala dela
                </a>{" "}
                <span style={{ color: "var(--text-faint)" }}>(para acompanhar o que ela vê e fala)</span>
              </>
            )}
          </div>
        )}

        {success && EXTERNAL_MEETING_AVAILABLE && !stopped && (
          <div style={{ margin: "0 0 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" className="btn" onClick={stopMeeting} disabled={stopping} style={{ padding: "7px 12px", fontSize: "0.8rem" }}>
              {stopping ? "Encerrando…" : "Encerrar reunião"}
            </button>
            {stopError && <p className="form-error" role="alert" style={{ margin: 0 }}>{stopError}</p>}
          </div>
        )}
        {stopped && (
          <p role="status" style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            O provider confirmou o pedido para que {agentName} saia da reunião.
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={!EXTERNAL_MEETING_AVAILABLE || pending || meetingUrl.trim().length === 0 || (scheduling && scheduleAt.trim().length === 0)}
          style={{ padding: "11px 20px" }}
        >
          {EXTERNAL_MEETING_AVAILABLE ? (pending ? "Entrando…" : scheduling ? "Agendar entrada" : "Entrar na reunião agora") : "Reuniões externas em atualização"}
        </button>
      </form>
    </section>
  );
}
