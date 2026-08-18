import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata({
  title: "Termos de Uso — Axtro Digital Human OS",
  description: "Condições de uso do Axtro Digital Human OS.",
  path: "/termos",
});

/** Termos v1 — honestos e mínimos; sujeitos a revisão jurídica formal. */
export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", lineHeight: 1.65 }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Termos de Uso</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 24 }}>
        Versão 1 · 31/07/2026 · Sujeitos a revisão jurídica formal; a versão revisada substituirá esta.
      </p>
      <section style={{ display: "grid", gap: 16, fontSize: "0.95rem" }}>
        <p><strong>O serviço.</strong> O Axtro Digital Human OS permite criar e operar
        funcionárias digitais de vídeo com IA. A conta de avaliação é gratuita e tem limites de
        proteção descritos em Configurações → Plano; uso em produção depende de acordo comercial.</p>
        <p><strong>Uso aceitável.</strong> É vedado usar a plataforma para enganar pessoas sobre a
        natureza de IA das agentes (o disclosure é inviolável), para conteúdo ilegal, ou para
        contornar limites técnicos da conta. Você é responsável pelo conteúdo das fontes de
        conhecimento que cadastrar e por ter o direito de usá-lo.</p>
        <p><strong>Disponibilidade.</strong> O serviço em fase de avaliação é fornecido no estado
        em que se encontra, sem SLA formal — acordos de nível de serviço fazem parte do contrato
        comercial.</p>
        <p><strong>Encerramento.</strong> Você pode encerrar sua conta a qualquer momento
        solicitando pelo e-mail fernando@axtroai.com; dados são tratados conforme o
        {" "}<a href="/privacidade" style={{ color: "var(--accent)" }}>Aviso de Privacidade</a>.</p>
      </section>
      <p style={{ marginTop: 32, fontSize: "0.85rem" }}>
        <a href="/" style={{ color: "var(--accent)" }}>← Voltar ao início</a>
      </p>
    </main>
  );
}
