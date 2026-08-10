"use client";

import { useRef, useState, useTransition } from "react";

import { sendAgentPreviewMessage, type PreviewTurn } from "@/lib/actions/agent-preview";

export function PreviewChat({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [turns, setTurns] = useState<readonly PreviewTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Id estável pra esta sessão de teste (uma aba aberta = uma conversa
  // registrada) — o mesmo em toda mensagem, recarregar a página começa
  // outra conversa nova (D-V2-106: histórico de conversa pro dono revisar).
  const transcriptIdRef = useRef<string>(crypto.randomUUID());

  async function copyConversation() {
    // A conversa vive só em memória (some ao navegar) — copiar é o jeito de
    // levar uma resposta boa/ruim pra revisão de prompt com o time.
    const serialized = turns
      .map((turn) => `${turn.role === "user" ? "Cliente" : agentName}: ${turn.content}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(serialized);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard bloqueado: sem fallback barulhento — o texto segue na tela.
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (message.length === 0 || pending) return;
    setDraft("");
    setError(null);
    const nextTurns = [...turns, { role: "user" as const, content: message }];
    setTurns(nextTurns);
    startTransition(async () => {
      const result = await sendAgentPreviewMessage(agentId, turns, message, transcriptIdRef.current);
      if (result.error || result.reply === null) {
        setError(result.error ?? "Erro inesperado.");
        setTurns(turns);
        setDraft(message);
      } else {
        setTurns([...nextTurns, { role: "assistant", content: result.reply }]);
      }
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
    });
  }

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      <div
        ref={scrollRef}
        style={{ minHeight: 260, maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}
        aria-live="polite"
      >
        {turns.length === 0 && (
          <p style={{ color: "var(--text-faint)", fontSize: "0.86rem", margin: "auto", textAlign: "center" }}>
            Envie a primeira mensagem para conversar com {agentName}.<br />
            Dica: pergunte quem ele é, ou simule um cliente interessado.
          </p>
        )}
        {turns.map((turn, index) => (
          <div
            key={index}
            style={{
              alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
              background: turn.role === "user" ? "var(--accent-soft)" : "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "9px 13px",
              maxWidth: "85%",
              fontSize: "0.9rem",
              whiteSpace: "pre-wrap",
            }}
          >
            {turn.content}
          </div>
        ))}
        {pending && (
          <div style={{ alignSelf: "flex-start", color: "var(--text-faint)", fontSize: "0.85rem" }}>
            {agentName} está digitando…
          </div>
        )}
      </div>
      {error && <p className="form-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      {turns.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={copyConversation} style={{ padding: "6px 12px", fontSize: "0.78rem" }}>
            {copied ? "Conversa copiada ✓" : "Copiar conversa"}
          </button>
        </div>
      )}
      <form onSubmit={submit} style={{ display: "flex", gap: 10 }}>
        <label htmlFor="preview-message" className="sr-only">Mensagem para {agentName}</label>
        <input
          id="preview-message"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          placeholder="Escreva como se fosse um cliente…"
          autoComplete="off"
          style={{
            flex: 1,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 13px",
            color: "var(--text)",
            fontSize: "0.92rem",
            fontFamily: "inherit",
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || draft.trim().length === 0}>
          Enviar
        </button>
      </form>
    </section>
  );
}
