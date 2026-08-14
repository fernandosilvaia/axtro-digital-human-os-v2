"use client";

import { useState, useTransition } from "react";

import { isTrustedTavusConversationUrl } from "@axtro/provider-tavus";

import { joinExternalMeeting } from "@/lib/actions/meeting-bot";

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
  const [success, setSuccess] = useState<{ scheduled: boolean; conversationUrl: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
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
      setSuccess({ scheduled: result.scheduled, conversationUrl: result.conversationUrl });
      setMeetingUrl("");
      setScheduleAt("");
      setScheduling(false);
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
        Cole o link de um Google Meet, Zoom ou Teams e {agentName} entra na reunião como
        participante — com rosto, voz e o cérebro de vendas completo. Funciona numa call que já
        está rolando: cole o link e ela entra em segundos, com a câmera já ligada.
      </p>

      <form onSubmit={submit}>
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="meeting-url">Link da reunião</label>
          <input
            id="meeting-url"
            type="url"
            required
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

        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || meetingUrl.trim().length === 0 || (scheduling && scheduleAt.trim().length === 0)}
          style={{ padding: "11px 20px" }}
        >
          {pending ? "Entrando…" : scheduling ? "Agendar entrada" : `Entrar na reunião agora`}
        </button>
      </form>
    </section>
  );
}
