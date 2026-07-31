"use client";

import { useState, useTransition } from "react";

import { joinExternalMeeting } from "@/lib/actions/meeting-bot";

/**
 * Leva o agente para uma reunião externa de verdade (Google Meet, Zoom,
 * Teams): o bot do Recall.ai entra na reunião e a sala de vídeo do agente
 * vira a câmera dele — os outros participantes veem e ouvem a agente como
 * um participante comum.
 *
 * Entrada imediata liga a câmera na mesma chamada. Entrada agendada cria o
 * bot silencioso (sentinela) no horário da Flórida — quem trata o fallback
 * decide depois se liga a câmera.
 */
export function ExternalMeeting({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ scheduled: boolean; conversationUrl: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await joinExternalMeeting(
        agentId,
        meetingUrl.trim(),
        scheduleAt.trim().length > 0 ? scheduleAt.trim() : null,
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess({ scheduled: result.scheduled, conversationUrl: result.conversationUrl });
      setMeetingUrl("");
      setScheduleAt("");
    });
  }

  return (
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="reuniao-externa">
      <h3 id="reuniao-externa" style={{ fontSize: "0.95rem", marginBottom: 4 }}>
        Levar para uma reunião externa 🎥
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", margin: "0 0 14px" }}>
        Cole o link de um Google Meet, Zoom ou Teams e {agentName} entra na reunião como
        participante — com rosto, voz e o cérebro de vendas completo.
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
          <label htmlFor="meeting-schedule">
            Agendar entrada <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>(opcional — horário da Flórida)</span>
          </label>
          <input
            id="meeting-schedule"
            type="datetime-local"
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
            Em branco: entra agora, já com a câmera ligada. Com horário: entra silenciosa no
            momento marcado, como sentinela.
          </p>
        </div>

        {error && <p className="form-error" role="alert" style={{ margin: "0 0 12px" }}>{error}</p>}

        {success && (
          <div className="saved-flag" role="status" style={{ margin: "0 0 12px", display: "block" }}>
            {success.scheduled
              ? `✓ ${agentName} vai entrar na reunião no horário marcado.`
              : `✓ ${agentName} está entrando na reunião agora — pode levar alguns segundos para aparecer.`}
            {success.conversationUrl && (
              <>
                {" "}
                <a href={success.conversationUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  Abrir a sala dela
                </a>{" "}
                <span style={{ color: "var(--text-faint)" }}>(para acompanhar o que ela vê e fala)</span>
              </>
            )}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={pending || meetingUrl.trim().length === 0} style={{ padding: "11px 20px" }}>
          {pending ? "Entrando…" : scheduleAt.trim().length > 0 ? "Agendar entrada" : "Entrar na reunião agora"}
        </button>
      </form>
    </section>
  );
}
