import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata({
  title: "Privacidade — Axtro Digital Human OS",
  description: "Como o Axtro Digital Human OS trata dados pessoais.",
  path: "/privacidade",
});

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
        transcrições persistentes somente quando essa finalidade for consentida especificamente e
        registros de uso (tokens de IA, conversas de vídeo) para medição e limites do plano.</p>
        <p><strong>Conversas com as agentes.</strong> As agentes se identificam sempre como IA.
        A conversa essencial pode operar sem finalidades opcionais quando a política aplicável
        permitir. Voz e imagem podem ser processadas em tempo real para realizar a conversa; análise
        visual ou comportamental requer a finalidade e o consentimento aplicáveis, é declarada e
        não é usada para identificação biométrica.</p>
        <p><strong>Histórico de conversa.</strong> Quando a finalidade de transcrição persistente é
        consentida, a plataforma retém a transcrição da interação habilitada para revisão no
        workspace. Sem esse consentimento, a conversa essencial não autoriza por si só a criação
        desse histórico persistente. O acesso segue as permissões do workspace.</p>
        <p><strong>Com quem compartilhamos.</strong> Provedores de infraestrutura sob contrato:
        Supabase (banco e autenticação), Railway (hospedagem), OpenRouter (modelos de linguagem),
        Tavus (vídeo conversacional; transcrição persistente somente para a finalidade consentida), ElevenLabs (voz), Recall.ai
        (somente se uma integração de reunião externa for habilitada após rollout e houver
        consentimento individual aplicável) e Resend (e-mails transacionais). Não vendemos dados
        pessoais.</p>
        <p><strong>Seus direitos (LGPD).</strong> Você pode solicitar acesso, correção ou exclusão
        dos seus dados — incluindo o histórico de conversas — a qualquer momento pelo e-mail
        fernando@axtroai.com. Fontes de conhecimento podem ser revogadas e excluídas diretamente no
        portal, com efeito imediato.</p>
        <p><strong>Retenção.</strong> Dados da conta permanecem enquanto a conta existir. Quando
        houver consentimento para transcrição persistente, o histórico segue a finalidade consentida
        (sem exclusão automática por tempo ainda); registros de uso são mantidos para auditoria e
        cobrança.</p>
      </section>
      <p style={{ marginTop: 32, fontSize: "0.85rem" }}>
        <a href="/" style={{ color: "var(--accent)" }}>← Voltar ao início</a>
      </p>
    </main>
  );
}
