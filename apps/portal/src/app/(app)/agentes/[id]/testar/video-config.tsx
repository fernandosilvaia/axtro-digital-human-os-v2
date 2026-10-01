"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setAgentVideoConfig, type VideoConfigStatus } from "@/lib/actions/agent-video-config";
import { CLOSER_VERTICALS, VIDEO_LANGUAGES } from "@/lib/video-config-options";

/** Existing asset IDs are visible but assignment requires governed onboarding. */
export function VideoConfig({
  agentId,
  status,
  isAdmin,
}: {
  agentId: string;
  status: VideoConfigStatus;
  isAdmin: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState(status.language ?? "portuguese");
  const [spokenLanguages, setSpokenLanguages] = useState<readonly string[]>(
    status.spokenLanguages ?? [status.language ?? "portuguese"],
  );
  const [closerVertical, setCloserVertical] = useState(status.closerVertical ?? "metodo_silva");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggleSpoken(value: string) {
    if (value === language) return; // idioma de abertura precisa continuar reconhecido
    setSpokenLanguages((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );
  }

  function changeLanguage(next: string) {
    setLanguage(next);
    setSpokenLanguages((current) => (current.includes(next) ? current : [...current, next]));
  }

  function save() {
    setError(null);
    // spoken_languages so vale a pena mandar com mais de um idioma; um so e
    // exatamente o comportamento padrao (NULL na coluna, 0066).
    const languagesToSend = spokenLanguages.length > 1 ? spokenLanguages : null;
    startTransition(async () => {
      const result = await setAgentVideoConfig(agentId, {
        language,
        spokenLanguages: languagesToSend,
        closerVertical,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title">Persona de vídeo</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: "0 0 14px" }}>
        A vinculação de persona e réplica exige provisionamento aprovado pela plataforma.
        Você pode editar idioma e vertical dos ativos já vinculados.
      </p>

      {status.configured ? (
        <p style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>
          Estado: <strong>vínculo de vídeo registrado</strong>
          <span style={{ color: "var(--text-faint)", fontSize: "0.78rem" }}>
            {" "}· persona {status.personaId}
            {status.replicaId !== null ? ` · réplica ${status.replicaId}` : ""}
          </span>
        </p>
      ) : (
        <p style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>
          Estado: <strong>onboarding governado pendente</strong>. Solicite à plataforma o
          provisionamento aprovado da persona e réplica para habilitar vídeo.
        </p>
      )}

      {status.configured && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
          O vínculo registrado não comprova a autorização de uso de imagem ou voz.
        </p>
      )}

      {isAdmin && status.configured ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
              <label htmlFor="video-persona">ID da persona Tavus</label>
              <input
                id="video-persona"
                type="text"
                value={status.personaId ?? ""}
                readOnly
                maxLength={64}
                autoComplete="off"
              />
            </div>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
              <label htmlFor="video-replica">ID da réplica Tavus (opcional)</label>
              <input
                id="video-replica"
                type="text"
                value={status.replicaId ?? ""}
                readOnly
                maxLength={64}
                autoComplete="off"
              />
            </div>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 160px" }}>
              <label htmlFor="video-vertical">Vertical</label>
              <select id="video-vertical" value={closerVertical} onChange={(event) => setCloserVertical(event.target.value)}>
                {CLOSER_VERTICALS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: "0 0 160px" }}>
              <label htmlFor="video-language">Idioma de abertura</label>
              <select id="video-language" value={language} onChange={(event) => changeLanguage(event.target.value)}>
                {VIDEO_LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span style={{ display: "block", marginBottom: 6, fontSize: "0.82rem", color: "var(--text-muted)" }}>
                Idiomas que a agente reconhece
              </span>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {VIDEO_LANGUAGES.map((option) => (
                  <label key={option.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={spokenLanguages.includes(option.value)}
                      disabled={option.value === language}
                      onChange={() => toggleSpoken(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div>
            <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
              {pending ? "Salvando…" : "Salvar idioma e vertical"}
            </button>
          </div>
        </div>
      ) : !isAdmin ? (
        <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", margin: 0 }}>
          Só um administrador da conta pode configurar o vídeo do agente.
        </p>
      ) : null}

      {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
    </section>
  );
}
