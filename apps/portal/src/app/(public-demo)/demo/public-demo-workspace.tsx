"use client";

import type { PortalPublicDemoCommand } from "@axtro/contracts-ts";
import Image from "next/image";
import { useState, useTransition } from "react";

import { parsePublicDemoActionResult } from "@/lib/public-demo/client-result";
import type { PublicDemoView } from "@/lib/public-demo/server-session";

import styles from "./public-demo.module.css";

type CommandName = PortalPublicDemoCommand["command"];
type SurfaceName = PublicDemoView["surface"];
type StepName = PublicDemoView["step"];

const SURFACES: readonly Readonly<{
  id: SurfaceName;
  command: CommandName;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  facts: readonly string[];
}>[] = Object.freeze([
  {
    id: "overview",
    command: "open_overview",
    label: "Visão geral",
    eyebrow: "Central sintética",
    title: "Entenda a operação antes de colocar um agente em campo.",
    description: "A simulação organiza presença, contexto autorizado e histórico sem consultar qualquer workspace real.",
    facts: ["Um agente fictício", "Três fontes sintéticas", "Quatro etapas simuladas"],
  },
  {
    id: "agent",
    command: "inspect_agent",
    label: "Agente",
    eyebrow: "Presença configurada",
    title: "Raissa representa a identidade visual da experiência.",
    description: "A demonstração apresenta configuração e disclosure, mas não ativa persona, voz, vídeo ou chamada externa.",
    facts: ["IA identificada", "Escopo comercial fictício", "Nenhuma capacidade de ativação"],
  },
  {
    id: "knowledge",
    command: "inspect_knowledge",
    label: "Conhecimento",
    eyebrow: "Contexto delimitado",
    title: "Fontes sintéticas mostram como a operação autoriza contexto.",
    description: "Nenhum arquivo é enviado, nenhuma busca externa acontece e nenhuma informação de cliente entra nesta sessão.",
    facts: ["FAQ sintético", "Política comercial fictícia", "Zero leitura externa"],
  },
  {
    id: "conversation",
    command: "inspect_conversation",
    label: "Conversa",
    eyebrow: "Histórico demonstrativo",
    title: "Uma linha do tempo fictícia explica o próximo passo.",
    description: "A experiência não gera fala, transcript, lead, reunião ou receipt. Ela apenas demonstra a estrutura da jornada.",
    facts: ["Disclosure apresentado", "Contexto sintético consultado", "Handoff demonstrativo"],
  },
]);

const STEP_CONTENT: Readonly<Record<StepName, Readonly<{ label: string; description: string }>>> = Object.freeze({
  welcome: Object.freeze({
    label: "Orientação",
    description: "Conheça as quatro superfícies da operação simulada.",
  }),
  context: Object.freeze({
    label: "Contexto",
    description: "Observe como identidade, fontes e limites aparecem antes da conversa.",
  }),
  conversation: Object.freeze({
    label: "Conversa",
    description: "Percorra uma representação sem mídia, geração ou efeito externo.",
  }),
  handoff: Object.freeze({
    label: "Handoff",
    description: "Veja como a continuidade humana seria indicada, sem executar nenhuma ação.",
  }),
});

function browserUuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function PublicDemoWorkspace({ initialView }: { initialView: PublicDemoView }) {
  const [view, setView] = useState(initialView);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [feedback, setFeedback] = useState("Sessão isolada pronta.");
  const [isPending, startTransition] = useTransition();
  const surface = SURFACES.find((candidate) => candidate.id === view.surface) ?? SURFACES[0]!;
  const step = STEP_CONTENT[view.step];

  function send(commandName: CommandName) {
    if (isPending || sessionEnded) return;
    const command: PortalPublicDemoCommand = {
      schema_version: "2.0.0",
      command_id: browserUuidV7(),
      expected_revision: view.revision,
      command: commandName,
    };

    startTransition(async () => {
      try {
        const response = await fetch("/demo/command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("demo_command_failed");
        const result = parsePublicDemoActionResult(await response.json());
        if (result === null) throw new Error("demo_result_invalid");
        if (result.revision !== null
          && result.surface !== null
          && result.step !== null
          && result.commands_remaining !== null) {
          setView({
            revision: result.revision,
            surface: result.surface,
            step: result.step,
            commandsRemaining: result.commands_remaining,
          });
        }
        if (result.outcome === "applied") setFeedback("Estado sintético atualizado somente nesta sessão.");
        if (result.outcome === "replayed") setFeedback("Comando repetido ignorado sem duplicar a transição.");
        if (result.outcome === "stale") setFeedback("A visualização foi sincronizada com o estado atual.");
        if (result.outcome === "expired" || result.outcome === "unavailable") {
          setSessionEnded(true);
          setFeedback("A sessão terminou sem persistir dados.");
        }
      } catch {
        setSessionEnded(true);
        setFeedback("A sessão terminou de forma segura. Nenhuma ação externa foi executada.");
      }
    });
  }

  if (sessionEnded) {
    return (
      <main className={styles.entryShell}>
        <section className={styles.entryPanel} aria-labelledby="demo-ended-title">
          <p className={styles.kicker}>Estado descartado</p>
          <h1 id="demo-ended-title">A simulação terminou sem persistir dados.</h1>
          <p className={styles.entryLead}>Inicie outra sessão isolada para voltar à fixture original.</p>
          <div className={styles.entryActions}>
            <form action="/demo/start" method="post">
              <button className={styles.primaryButton} type="submit">Iniciar nova sessão</button>
            </form>
            <a className={styles.secondaryButton} href="/">Voltar para a página inicial</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.demoShell}>
      <header className={styles.demoHeader}>
        <a className={styles.wordmark} href="/" aria-label="Voltar ao Axtro Closer AI Human">
          <span>Axtro</span>
          <small>Closer AI Human</small>
        </a>
        <div className={styles.headerActions}>
          <a className={styles.secondaryButton} href="/signup">Criar minha conta</a>
          <form action="/demo/end" method="post">
            <button className={styles.textButton} type="submit">Sair da demonstração</button>
          </form>
        </div>
      </header>

      <section className={styles.disclosure} aria-label="Limites da demonstração">
        <strong>Simulação isolada</strong>
        <span>Dados sintéticos</span>
        <span>Sem Supabase Auth</span>
        <span>Sem efeitos reais</span>
      </section>

      <div className={styles.workspaceGrid}>
        <aside className={styles.sidebar} aria-label="Superfícies da demonstração">
          <p className={styles.sidebarLabel}>Percurso do produto</p>
          <nav className={styles.surfaceNav}>
            {SURFACES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={view.surface === item.id ? "page" : undefined}
                disabled={isPending}
                onClick={() => send(item.command)}
              >
                <span>{item.label}</span>
                <small>{item.eyebrow}</small>
              </button>
            ))}
          </nav>
          <div className={styles.sessionBudget}>
            <span>Transições locais restantes</span>
            <strong>{view.commandsRemaining}</strong>
          </div>
          <button
            className={styles.resetButton}
            type="button"
            disabled={isPending}
            onClick={() => send("reset")}
          >
            Recomeçar percurso
          </button>
        </aside>

        <section className={styles.mainPanel} aria-labelledby="demo-surface-title">
          <div className={styles.surfaceCopy}>
            <p className={styles.kicker}>{surface.eyebrow}</p>
            <h1 id="demo-surface-title">{surface.title}</h1>
            <p className={styles.surfaceLead}>{surface.description}</p>
            <ul className={styles.factList}>
              {surface.facts.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
          </div>

          <div className={styles.visualColumn}>
            <div className={styles.imageFrame}>
              <Image
                src="/assets/digital-human/raissa-closer-hero.png"
                alt="Raissa no estúdio Axtro, identidade visual da simulação Closer AI Human"
                width={1537}
                height={1023}
                sizes="(max-width: 900px) 100vw, 34vw"
                priority
              />
              <div className={styles.imageCaption}>
                <strong>IA identificada</strong>
                <span>Identidade visual, sem sessão de vídeo</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.guidePanel} aria-labelledby="demo-guide-title">
          <div>
            <p className={styles.kicker}>Etapa {view.revision + 1}</p>
            <h2 id="demo-guide-title">{step.label}</h2>
            <p>{step.description}</p>
          </div>
          <div className={styles.guideActions}>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={isPending || view.step === "handoff" || view.commandsRemaining === 0}
              onClick={() => send("advance")}
            >
              {isPending ? "Atualizando…" : view.step === "handoff" ? "Percurso concluído" : "Avançar na jornada"}
            </button>
            <p className={styles.feedback} aria-live="polite">{feedback}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
