"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setAgentVideoConfig, type VideoConfigStatus } from "@/lib/actions/agent-video-config";
import { CLOSER_VERTICALS, VIDEO_LANGUAGES } from "@/lib/video-config-options";

/**
 * Persona de vídeo do agente (D-V2-179, `portal_set_agent_video_config`).
 *
 * NÃO cria persona na Tavus nem gera custo: só liga o agente a um
 * persona_id/replica_id que a plataforma já provisionou por fora (dashboard
 * Tavus). Criação automática de persona real é um efeito pago, deliberadamente
 * fora daqui. Ver `agent-video.ts`, que trava em "fluxo governado de
 * onboarding" até existir uma reserva durável específica pra isso.
 *
 * A RPC existe desde a 0022 e nunca teve tela nem chamador: até aqui, toda
 * persona em produção (a Sofia inclusive) só existia porque alguém rodava
 * INSERT manual.
 */
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
  const [personaId, setPersonaId] = useState(status.personaId ?? "");
  const [replicaId, setReplicaId] = useState(status.replicaId ?? "");
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
    const trimmedPersona = personaId.trim();
    const trimmedReplica = replicaId.trim();
    if (trimmedPersona.length === 0) {
      setError("Informe o ID da persona Tavus.");
      return;
    }
    // spoken_languages so vale a pena mandar com mais de um idioma; um so e
    // exatamente o comportamento padrao (NULL na coluna, 0066).
    const languagesToSend = spokenLanguages.length > 1 ? spokenLanguages : null;
    startTransition(async () => {
      const result = await setAgentVideoConfig(agentId, {
        personaId: trimmedPersona,
        replicaId: trimmedReplica.length > 0 ? trimmedReplica : null,
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
        Liga este agente a uma persona (e réplica, se houver) já criadas na Tavus. Não cria nada
        novo nem gera custo aqui, só grava o ID que a plataforma provisionou para esta conta.
      </p>

      {status.configured ? (
        <p style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>
          Estado: <strong>configurado</strong>
          <span style={{ color: "var(--text-faint)", fontSize: "0.78rem" }}>
            {" "}· persona {status.personaId}
            {status.replicaId !== null ? ` · réplica ${status.replicaId}` : ""}
          </span>
        </p>
      ) : (
        <p style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>
          Estado: <strong>não configurado</strong>. Sem isso o agente não tem vídeo, apresentação
          nem reunião externa.
        </p>
      )}

      {isAdmin ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
              <label htmlFor="video-persona">ID da persona Tavus</label>
              <input
                id="video-persona"
                type="text"
                value={personaId}
                onChange={(event) => setPersonaId(event.target.value)}
                maxLength={64}
                autoComplete="off"
                placeholder="p6f9cfb4817e"
              />
            </div>
            <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
              <label htmlFor="video-replica">ID da réplica Tavus (opcional)</label>
              <input
                id="video-replica"
                type="text"
                value={replicaId}
                onChange={(event) => setReplicaId(event.target.value)}
                maxLength={64}
                autoComplete="off"
                placeholder="r862e3a3c5e0"
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
              {pending ? "Salvando…" : status.configured ? "Atualizar persona" : "Salvar persona"}
            </button>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", margin: 0 }}>
          Só um administrador da conta pode configurar o vídeo do agente.
        </p>
      )}

      {error && <p className="form-error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
    </section>
  );
}
