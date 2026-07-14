import { useState, useEffect, useRef } from "react";

/* ============================================================
   AXTRO HUMAN SALES AI — Console "Ao Vivo" (protótipo navegável)
   Tela do dashboard do tenant: sessões de voz em tempo real,
   scorecard SILVA, latência como métrica de 1ª classe, handoff.
   Dados 100% simulados em memória (sem storage).
   Referências: docs/architecture/SYSTEM_ARCHITECTURE.md,
   SALES_INTELLIGENCE_ENGINE.md, OBSERVABILITY.md
   ============================================================ */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,600..900&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
:root{
  --bg:#0C161C; --panel:#101E26; --panel2:#15242E; --line:#1F3540;
  --ink:#E8F1F2; --ink-dim:#8FA6AD; --ink-faint:#5A7078;
  --live:#6FD3A7; --think:#9B8CFF; --speak:#5AB8E8; --human:#E8A13D;
  --risk:#E4685A; --gold:#E8A13D;
}
*{box-sizing:border-box}
.ax-root{min-height:100vh;background:
  radial-gradient(1200px 500px at 85% -10%, #14303a55, transparent 60%),
  var(--bg); color:var(--ink); font-family:'Instrument Sans',system-ui,sans-serif;}
.ax-display{font-family:'Archivo',sans-serif; font-stretch:125%; letter-spacing:.01em}
.ax-mono{font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums}
.ax-top{display:flex;align-items:center;gap:20px;padding:14px 22px;border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,#0F1B22,#0C161C)}
.ax-logo{font-weight:900;font-size:19px;letter-spacing:.04em}
.ax-logo b{color:var(--gold)}
.ax-tag{font-size:11px;color:var(--ink-dim);border:1px solid var(--line);padding:3px 8px;border-radius:99px}
.ax-kpis{display:flex;gap:10px;margin-left:auto;flex-wrap:wrap}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:7px 12px;min-width:106px}
.kpi small{display:block;font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:2px}
.kpi span{font-size:16px;font-weight:600}
.kpi .up{color:var(--live)} .kpi .warn{color:var(--gold)}
.ax-main{display:grid;grid-template-columns:minmax(340px,440px) 1fr;gap:0;height:calc(100vh - 63px)}
@media(max-width:920px){.ax-main{grid-template-columns:1fr;height:auto}}
.ax-col{overflow-y:auto;padding:18px}
.ax-col.left{border-right:1px solid var(--line)}
.sec-h{display:flex;align-items:baseline;gap:10px;margin:2px 2px 12px}
.sec-h h2{margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-dim);font-weight:700}
.sec-h .dot{width:7px;height:7px;border-radius:99px;background:var(--live);box-shadow:0 0 10px var(--live);animation:pl 1.6s infinite}
@keyframes pl{50%{opacity:.35}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px;cursor:pointer;
  transition:border-color .15s, transform .15s}
.card:hover{border-color:#2E4B58}
.card.sel{border-color:var(--gold);background:var(--panel2)}
.card.handed{opacity:.75}
.c-row{display:flex;align-items:center;gap:10px}
.avatar{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:700;font-size:13px;
  background:#1D3441;color:#BFE3EE;flex:none}
.c-name{font-weight:600;font-size:14px}
.c-sub{font-size:11px;color:var(--ink-dim)}
.badge{margin-left:auto;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:99px;font-weight:600}
.badge.listening{color:var(--live);border:1px solid #2E5B49;background:#12291F}
.badge.thinking{color:var(--think);border:1px solid #47418A;background:#1B1930}
.badge.speaking{color:var(--speak);border:1px solid #2C5B75;background:#0F2836}
.badge.handoff{color:var(--human);border:1px solid #7A5A22;background:#2C2109}
/* --- assinatura: linha de pulso da conversa --- */
.pulse{display:flex;align-items:flex-end;gap:2px;height:30px;margin:10px 0 8px}
.pulse i{width:3px;border-radius:2px;background:var(--speak);opacity:.9;transition:height .12s linear}
.pulse.lead i{background:var(--live)}
.pulse.idle i{background:#2A414D}
.lat{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--ink-dim)}
.lat b{font-size:13px;color:var(--ink)}
.lat .bar{flex:1;height:4px;border-radius:99px;background:#1B2F39;overflow:hidden}
.lat .bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--live),var(--gold) 78%,var(--risk))}
.silva{display:flex;gap:5px;margin-top:10px}
.silva .p{flex:1;text-align:center;border-radius:8px;padding:5px 0;font-size:11px;font-weight:700;border:1px solid var(--line);color:var(--ink-faint);background:#0E1A21}
.silva .p.on1{color:#CFE8D9;border-color:#2E5B49;background:#12291F}
.silva .p.on2{color:#0C161C;border-color:var(--live);background:var(--live)}
.silva .p small{display:block;font-weight:500;font-size:8.5px;letter-spacing:.05em;color:inherit;opacity:.75}
/* painel direito */
.d-head{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.d-head h1{margin:0;font-size:22px;font-weight:800}
.d-head .stage{font-size:11px;color:var(--gold);letter-spacing:.1em;text-transform:uppercase;border:1px solid #7A5A22;border-radius:99px;padding:4px 10px}
.grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}
@media(max-width:1180px){.grid2{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.panel h3{margin:0 0 10px;font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-dim)}
.tr{display:flex;gap:10px;margin-bottom:10px;font-size:13px;line-height:1.45}
.tr .who{flex:none;width:52px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding-top:2px}
.tr.ia .who{color:var(--speak)} .tr.lead .who{color:var(--live)}
.tr p{margin:0;color:#D5E4E8}
.tr.ghost p{color:var(--ink-faint);font-style:italic}
.nba{border-left:3px solid var(--gold);padding:10px 12px;background:#182530;border-radius:0 10px 10px 0;font-size:13px}
.nba small{display:block;color:var(--ink-faint);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px}
.obj{display:flex;gap:8px;align-items:center;font-size:12.5px;margin-bottom:8px}
.obj .st{font-size:9.5px;padding:2px 7px;border-radius:99px;letter-spacing:.06em;text-transform:uppercase;font-weight:700}
.obj .st.h{color:var(--live);border:1px solid #2E5B49}
.obj .st.o{color:var(--risk);border:1px solid #6E332C}
.btns{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.btn{font:inherit;font-weight:600;font-size:13px;border-radius:10px;padding:10px 16px;cursor:pointer;border:1px solid var(--line);
  background:var(--panel2);color:var(--ink);transition:transform .1s,border-color .15s}
.btn:hover{border-color:#3A5866}
.btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.btn.gold{background:var(--gold);color:#20160A;border-color:var(--gold)}
.btn.gold:hover{transform:translateY(-1px)}
.btn:disabled{opacity:.45;cursor:default}
.appr{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid #7A5A2255;border-radius:12px;padding:11px 13px;margin-bottom:10px;font-size:12.5px}
.appr .tag{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);border:1px solid #7A5A22;border-radius:99px;padding:2px 8px;flex:none}
.appr .a{margin-left:auto;display:flex;gap:6px}
.mini{font:inherit;font-size:11px;font-weight:600;border-radius:8px;padding:5px 10px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink)}
.mini.ok{color:var(--live);border-color:#2E5B49}
.mini:focus-visible{outline:2px solid var(--gold);outline-offset:1px}
.foot{font-size:10.5px;color:var(--ink-faint);padding:10px 22px;border-top:1px solid var(--line)}
.toast{position:fixed;right:20px;bottom:20px;background:var(--panel2);border:1px solid var(--gold);color:var(--ink);
  border-radius:12px;padding:12px 16px;font-size:13px;box-shadow:0 10px 40px #0009;animation:tin .25s ease}
@keyframes tin{from{transform:translateY(8px);opacity:0}}
@media (prefers-reduced-motion: reduce){ .pulse i{transition:none} .sec-h .dot{animation:none} }
`;

const SILVA_LABELS = [["S","Situação"],["I","Intenção"],["L","Liderança"],["V","Valor"],["A","Agenda"]];

const seed = [
  {
    id:"s1", lead:"Marina Costa", org:"Clínica Vitalle", agent:"Sofia · Closer", channel:"Sala Axtro",
    stage:"Reunião Silva · fase 4 — Apresentação calibrada", state:"speaking", mins:23,
    silva:[2,2,1,2,2], lat:640, handed:false,
    transcript:[
      ["lead","A minha dor é agenda furada mesmo. A recepção não dá conta de confirmar todo mundo."],
      ["ia","Entendi, Marina. Só pra eu ver se captei: hoje vocês perdem em torno de 30% das consultas por falta de confirmação, é isso?"],
      ["lead","Isso. E cada horário vago é uns quatrocentos reais que evaporam."],
      ["ia","Então deixa eu te mostrar exatamente a parte que resolve confirmação automática — vou pular o resto e focar no que te importa."],
    ],
    objections:[["Preço vs recepcionista","h"],["Medo de parecer robô com pacientes","o"]],
    nba:"Apresentar apenas o módulo de confirmação + citar caso da OdontoPrime (mesma dor). Não abrir preço antes da fase 5.",
  },
  {
    id:"s2", lead:"Ricardo Mendes", org:"RM Engenharia", agent:"Sofia · Closer", channel:"Telefone",
    stage:"Cold Call Silva · gancho de 30s aceito", state:"listening", mins:3,
    silva:[2,1,0,0,0], lat:520, handed:false,
    transcript:[
      ["ia","Ricardo? Aqui é a Sofia, assistente virtual da Axtro. Te ligo porque vi que vocês abriram duas vagas de orçamentista — normalmente isso significa proposta acumulando. Faz sentido aí?"],
      ["lead","Olha… faz. A gente tá afogado em orçamento pra responder."],
    ],
    objections:[],
    nba:"Fazer 1 pergunta de Situação e propor os 20 minutos de quinta às 10h (agenda já verificada).",
  },
  {
    id:"s3", lead:"Paula Ribeiro", org:"Grupo Andar", agent:"Davi · SDR", channel:"Sala Axtro",
    stage:"Qualificação · SILVA 8/10 — handoff sugerido", state:"handoff", mins:14,
    silva:[2,2,2,1,1], lat:710, handed:true,
    transcript:[
      ["lead","Eu decido junto com meu sócio, mas quem bate o martelo do orçamento sou eu."],
      ["ia","Perfeito, Paula. Pelo que você trouxe, faz sentido eu te conectar agora com o Henrique, nosso especialista — ele acompanha exatamente operações do seu tamanho. Posso trazer ele pra cá?"],
      ["lead","Pode sim."],
      ["ghost","Pacote de handoff enviado · Henrique notificado há 6s · SILVA, dor e limites anexados"],
    ],
    objections:[["Já usa concorrente (contrato até out/26)","o"]],
    nba:"Humano assume com o pacote: dor = leads esfriando no fim de semana; não reabrir perguntas já respondidas.",
  },
];

const APPROVALS_SEED = [
  {id:"a1",tag:"write_high",txt:"Gerar link de pagamento R$ 4.970 — Clínica Vitalle (plano Pro anual)"},
  {id:"a2",tag:"follow-up",txt:"Enviar e-mail de resumo + proposta para paula@grupoandar.com.br"},
  {id:"a3",tag:"experimento",txt:"Axtro Agent propõe: testar novo gancho de 30s no setor de engenharia (A/B 20%)"},
];

function Pulse({ mode }) {
  const [bars, setBars] = useState(Array.from({length:26},()=>4));
  useEffect(()=>{
    const t = setInterval(()=>{
      setBars(b=>b.map(()=> mode==="idle" ? 3+Math.random()*3 :
        mode==="listening" ? 4+Math.random()*16 : 4+Math.random()*24));
    },130);
    return ()=>clearInterval(t);
  },[mode]);
  const cls = mode==="listening" ? "pulse lead" : mode==="idle" ? "pulse idle" : "pulse";
  return <div className={cls} aria-hidden="true">{bars.map((h,i)=><i key={i} style={{height:h}}/>)}</div>;
}

function Silva({ scores }) {
  return (
    <div className="silva" title="Framework SILVA — 0 a 2 por letra">
      {SILVA_LABELS.map(([l,name],i)=>(
        <div key={l} className={"p ax-mono "+(scores[i]===2?"on2":scores[i]===1?"on1":"")}>
          {l}<small>{name}</small>
        </div>
      ))}
    </div>
  );
}

export default function AxtroConsole(){
  const [sessions,setSessions] = useState(seed);
  const [selId,setSelId] = useState("s1");
  const [apprs,setApprs] = useState(APPROVALS_SEED);
  const [toast,setToast] = useState(null);
  const toastT = useRef(null);

  // simulação viva: estados e latência flutuam
  useEffect(()=>{
    const t = setInterval(()=>{
      setSessions(ss=>ss.map(s=>{
        if(s.handed) return s;
        const order=["listening","thinking","speaking"];
        const next = Math.random()<0.4 ? order[(order.indexOf(s.state)+1)%3] : s.state;
        const lat = Math.max(380, Math.min(1450, s.lat + (Math.random()*220-110)));
        return {...s,state:next,lat:Math.round(lat)};
      }));
    },1900);
    return ()=>clearInterval(t);
  },[]);

  const say = (msg)=>{ setToast(msg); clearTimeout(toastT.current); toastT.current=setTimeout(()=>setToast(null),3200); };
  const sel = sessions.find(s=>s.id===selId) ?? sessions[0];

  const takeOver = ()=>{
    setSessions(ss=>ss.map(s=>s.id===sel.id?{...s,state:"handoff",handed:true,
      stage:"Handoff quente · humano na sala",
      transcript:[...s.transcript,["ghost","Você entrou na sala. A IA apresentou você e ficou em modo observador."]]}:s));
    say("Handoff quente: você está na sala com "+sel.lead+". Pacote SILVA no seu painel.");
  };
  const listen = ()=> say("Ouvindo a sala em tempo real (áudio simulado no protótipo).");
  const decide = (id,ok)=>{
    const a = apprs.find(x=>x.id===id);
    setApprs(xs=>xs.filter(x=>x.id!==id));
    say((ok?"Aprovado: ":"Recusado: ")+a.txt.slice(0,54)+"…");
  };

  const kBadge = {listening:["Ouvindo o lead","listening"],thinking:["Pensando","thinking"],speaking:["Falando","speaking"],handoff:["Com humano","handoff"]};

  return (
    <div className="ax-root">
      <style>{css}</style>

      <header className="ax-top">
        <div className="ax-display ax-logo">AX<b>TRO</b></div>
        <span className="ax-tag">tenant · Método Silva</span>
        <span className="ax-tag" style={{color:"var(--live)",borderColor:"#2E5B49"}}>Ao vivo</span>
        <div className="ax-kpis ax-mono" role="list" aria-label="KPIs do dia">
          <div className="kpi" role="listitem"><small>Contatos hoje</small><span>47</span></div>
          <div className="kpi" role="listitem"><small>Agendamentos</small><span className="up">9</span></div>
          <div className="kpi" role="listitem"><small>Show rate 7d</small><span className="up">74%</span></div>
          <div className="kpi" role="listitem"><small>SILVA médio</small><span>7,1</span></div>
          <div className="kpi" role="listitem"><small>Latência p50</small><span>0,68s</span></div>
          <div className="kpi" role="listitem"><small>Custo/min</small><span className="warn">R$0,35</span></div>
        </div>
      </header>

      <div className="ax-main">
        {/* -------- coluna esquerda: sessões -------- */}
        <div className="ax-col left">
          <div className="sec-h"><span className="dot" aria-hidden="true"></span><h2>Conversas em andamento · {sessions.length}</h2></div>

          {sessions.map(s=>{
            const [label,cls]=kBadge[s.state];
            const pct = Math.min(100,(s.lat/1500)*100);
            return (
              <div key={s.id} className={"card"+(s.id===sel.id?" sel":"")+(s.handed?" handed":"")}
                   onClick={()=>setSelId(s.id)} role="button" tabIndex={0}
                   onKeyDown={e=>e.key==="Enter"&&setSelId(s.id)}
                   aria-label={"Sessão com "+s.lead}>
                <div className="c-row">
                  <div className="avatar ax-display">{s.lead.split(" ").map(w=>w[0]).slice(0,2).join("")}</div>
                  <div>
                    <div className="c-name">{s.lead} <span className="c-sub">· {s.org}</span></div>
                    <div className="c-sub">{s.agent} · {s.channel} · {s.mins} min</div>
                  </div>
                  <span className={"badge "+cls}>{label}</span>
                </div>

                <Pulse mode={s.handed?"idle":s.state}/>

                <div className="lat ax-mono">
                  <span>voz em</span><b>{(s.lat/1000).toFixed(2)}s</b>
                  <div className="bar" aria-hidden="true"><i style={{width:pct+"%"}}/></div>
                  <span style={{color: s.lat>1200?"var(--risk)": s.lat>900?"var(--gold)":"var(--live)"}}>
                    {s.lat>1200?"acima do budget":s.lat>900?"atenção":"budget ok"}
                  </span>
                </div>

                <Silva scores={s.silva}/>
              </div>
            );
          })}

          <div className="sec-h" style={{marginTop:20}}><h2>Aprovações pendentes · {apprs.length}</h2></div>
          {apprs.length===0 && <div className="c-sub" style={{padding:"4px 2px"}}>Nada esperando você. As ações de baixo risco seguem sozinhas.</div>}
          {apprs.map(a=>(
            <div className="appr" key={a.id}>
              <span className="tag ax-mono">{a.tag}</span>
              <span>{a.txt}</span>
              <span className="a">
                <button className="mini ok" onClick={()=>decide(a.id,true)}>Aprovar</button>
                <button className="mini" onClick={()=>decide(a.id,false)}>Recusar</button>
              </span>
            </div>
          ))}
        </div>

        {/* -------- coluna direita: detalhe -------- */}
        <div className="ax-col">
          <div className="d-head">
            <h1 className="ax-display">{sel.lead}</h1>
            <span className="stage ax-mono">{sel.stage}</span>
          </div>

          <div className="grid2">
            <div className="panel">
              <h3>Transcript ao vivo (resumido)</h3>
              {sel.transcript.map((t,i)=>(
                <div key={i} className={"tr "+(t[0]==="ghost"?"ghost":t[0])}>
                  <span className="who ax-mono">{t[0]==="ia"?"Sofia":t[0]==="lead"?"Lead":"Sistema"}</span>
                  <p>{t[1]}</p>
                </div>
              ))}
              <div className="btns">
                <button className="btn" onClick={listen}>Ouvir a sala</button>
                <button className="btn gold" onClick={takeOver} disabled={sel.handed}>
                  {sel.handed?"Humano já está na sala":"Assumir conversa (handoff quente)"}
                </button>
              </div>
            </div>

            <div>
              <div className="panel" style={{marginBottom:14}}>
                <h3>Próxima melhor ação — motor Método Silva</h3>
                <div className="nba"><small>o LLM propõe, o motor dispõe</small>{sel.nba}</div>
              </div>
              <div className="panel" style={{marginBottom:14}}>
                <h3>Objeções</h3>
                {sel.objections.length===0 && <div className="c-sub">Nenhuma levantada até aqui.</div>}
                {sel.objections.map(([o,st],i)=>(
                  <div className="obj" key={i}>
                    <span className={"st ax-mono "+st}>{st==="h"?"Tratada":"Aberta"}</span><span>{o}</span>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>Limites desta sessão (server-side)</h3>
                <div className="c-sub ax-mono" style={{lineHeight:1.9}}>
                  desconto máx <b style={{color:"var(--ink)"}}>10%</b> · aprovação acima de <b style={{color:"var(--ink)"}}>R$ 5.000</b><br/>
                  IA identificada ✓ · aviso de gravação ✓ · DNC verificado ✓
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="foot">Protótipo navegável · dados simulados · latência exibida = fim da fala do lead → primeira sílaba da IA (budget p95 1,5s) · Axtro Human Sales AI</div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
