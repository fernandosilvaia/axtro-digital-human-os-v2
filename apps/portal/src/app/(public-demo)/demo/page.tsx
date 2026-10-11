import type { Metadata } from "next";

import { readPublicDemoView } from "@/lib/public-demo/server-session";

import { PublicDemoWorkspace } from "./public-demo-workspace";
import styles from "./public-demo.module.css";

export const metadata: Metadata = {
  title: "Demonstração isolada | Axtro Closer AI Human",
  description: "Simulação isolada do Axtro Closer AI Human com dados sintéticos e sem efeitos reais.",
  robots: { index: false, follow: false },
};

export default async function PublicDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ status }, initialView] = await Promise.all([
    searchParams,
    readPublicDemoView(),
  ]);

  if (initialView !== null) {
    return <PublicDemoWorkspace initialView={initialView} />;
  }

  const unavailable = status === "unavailable";
  return (
    <main className={styles.entryShell}>
      <section className={styles.entryPanel} aria-labelledby="demo-entry-title">
        <a className={styles.wordmark} href="/" aria-label="Voltar ao Axtro Closer AI Human">
          <span>Axtro</span>
          <small>Closer AI Human</small>
        </a>
        <p className={styles.kicker}>Demonstração pública isolada</p>
        <h1 id="demo-entry-title">
          {unavailable ? "A simulação não está disponível agora." : "Explore o produto sem criar uma conta."}
        </h1>
        <p className={styles.entryLead}>
          {unavailable
            ? "O workspace de clientes continua protegido e disponível pelo login normal. Tente novamente mais tarde ou crie sua própria conta."
            : "Tudo aqui é fictício: nada é salvo e nenhuma cobrança é feita. O percurso fica só neste navegador, por pouco tempo."}
        </p>
        <div className={styles.entryActions}>
          {!unavailable && (
            <form action="/demo/start" method="post">
              <button className={styles.primaryButton} type="submit">Iniciar simulação isolada</button>
            </form>
          )}
          <a className={styles.secondaryButton} href="/signup">Criar minha conta</a>
          <a className={styles.textLink} href="/">Voltar para a página inicial</a>
        </div>
        <dl className={styles.safetyList}>
          <div><dt>Identidade</dt><dd>Visitante anônimo, sem papel administrativo</dd></div>
          <div><dt>Dados</dt><dd>Fictícios, sem informação de cliente</dd></div>
          <div><dt>Efeitos</dt><dd>Nada é salvo, nenhum e-mail é enviado e nenhuma cobrança é feita</dd></div>
        </dl>
      </section>
    </main>
  );
}
