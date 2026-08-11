import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacidade — Axtro Digital Human OS",
  description: "Como o Axtro Digital Human OS trata dados pessoais.",
};

/**
 * Aviso de privacidade v1 — descreve APENAS o que o produto realmente faz
 * hoje, sem promessas genéricas. Sujeito a revisão jurídica formal
 * (PENDENCIAS_EXTERNAS): esta página é transparência operacional, não
 * parecer de advogado.
 */
export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", lineHeight: 1.65 }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Aviso de Privacidade</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 24 }}>
        Versão 1 · 11/08/2026 · Este aviso descreve a prática real da plataforma e passará por
        revisão jurídica formal; a versão revisada substituirá esta.
      </p>
      <section style={{ display: "grid", gap: 16, fontSize: "0.95rem" }}>
        <p><strong>Quem somos.</strong> O Axtro Digital Human OS é operado pela Axtro AI
        (contato: fernando@axtroai.com), e permite criar funcionárias digitais de vídeo para
        conversas de vendas.</p>
        <p><strong>O que coletamos.</strong> Dados de conta (e-mail, senha protegida por hash),
        dados do workspace que você cadastra (nome da empresa, agentes, fontes de conhecimento),
        o histórico completo das conversas conduzidas pelas agentes (texto de cada turno — chat de
        teste, vídeo e reunião externa, ver abaixo) e registros de uso (tokens de IA, conversas de
        vídeo) para medição e limites do plano.</p>
        <p><strong>Conversas com as agentes.</strong> As agentes se identificam sempre como IA.
        Conversas de vídeo processam voz e imagem em tempo real, incluindo leitura de expressões e
        comportamento para adaptar a conversa — essa leitura é declarada, usada apenas durante a
        própria conversa e não é usada para identificação biométrica.</p>
        <p><strong>Histórico de conversa.</strong> Toda conversa conduzida por uma agente — no chat
        de teste, numa sala de vídeo ou numa reunião externa (Zoom/Meet/Teams via Recall.ai) — é
        transcrita e armazenada na íntegra para o dono do workspace revisar depois (tela
        &quot;Conversas&quot; do portal). Esse histórico fica visível para qualquer pessoa com acesso
        ao workspace, não só para o administrador que iniciou a conversa.</p>
        <p><strong>Com quem compartilhamos.</strong> Provedores de infraestrutura sob contrato:
        Supabase (banco e autenticação), Railway (hospedagem), OpenRouter (modelos de linguagem),
        Tavus (vídeo conversacional, inclui a transcrição da conversa), ElevenLabs (voz), Recall.ai
        (participação em reuniões e transcrição, quando você usa esse recurso) e Resend (e-mails
        transacionais). Não vendemos dados pessoais.</p>
        <p><strong>Seus direitos (LGPD).</strong> Você pode solicitar acesso, correção ou exclusão
        dos seus dados — incluindo o histórico de conversas — a qualquer momento pelo e-mail
        fernando@axtroai.com. Fontes de conhecimento podem ser revogadas e excluídas diretamente no
        portal, com efeito imediato.</p>
        <p><strong>Retenção.</strong> Dados da conta e o histórico de conversas permanecem enquanto
        a conta existir (sem exclusão automática por tempo ainda); registros de uso são mantidos
        para auditoria e cobrança.</p>
      </section>
      <p style={{ marginTop: 32, fontSize: "0.85rem" }}>
        <a href="/" style={{ color: "var(--accent)" }}>← Voltar ao início</a>
      </p>
    </main>
  );
}
