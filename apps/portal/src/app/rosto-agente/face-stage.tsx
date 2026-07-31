"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Palco do rosto da agente para reuniões externas (Recall.ai Output Media).
 *
 * O bot do Recall.ai renderiza ESTA página e transmite o que ela mostra como
 * a câmera dele dentro do Meet/Zoom/Teams. Por isso ela precisa:
 *   1. entrar na sala do Tavus SOZINHA (a URL crua do Tavus abre uma tela de
 *      "digite seu nome" — o bot transmitiria o formulário, não a agente);
 *   2. mostrar só o vídeo da agente, sangrando na tela inteira, sem UI;
 *   3. TOCAR o áudio dela — é o áudio desta página que o bot manda pra reunião;
 *   4. entrar na sala usando o áudio da REUNIÃO como microfone, senão a agente
 *      não escuta ninguém.
 *
 * O ciclo completo de áudio:
 *   participantes falam → bot capta → getUserMedia nesta página → microfone
 *   na sala do Tavus → a agente ouve e responde → voz dela toca aqui → o bot
 *   captura o áudio da página → participantes ouvem.
 */

type DailyCall = {
  join(options: {
    url: string;
    userName?: string;
    startVideoOff?: boolean;
    startAudioOff?: boolean;
    audioSource?: MediaStreamTrack | false;
  }): Promise<unknown>;
  leave(): Promise<unknown>;
  destroy(): Promise<unknown>;
  on(event: string, handler: (event: never) => void): unknown;
};

export function FaceStage({ roomUrl }: { roomUrl: string }) {
  const [state, setState] = useState<"joining" | "live" | "error">("joining");
  const callRef = useRef<DailyCall | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const DailyIframe = (await import("@daily-co/daily-js")).default;
        const call = DailyIframe.createCallObject() as unknown as DailyCall;
        callRef.current = call;

        call.on("track-started", ((event: { participant?: { local?: boolean }; track?: MediaStreamTrack }) => {
          // Só o remoto interessa: o rosto e a voz da agente.
          if (!event.track || event.participant?.local === true) return;
          if (event.track.kind === "video" && videoRef.current) {
            videoRef.current.srcObject = new MediaStream([event.track]);
            setState("live");
          }
          if (event.track.kind === "audio" && audioRef.current) {
            audioRef.current.srcObject = new MediaStream([event.track]);
            // A voz dela precisa TOCAR nesta página: é o áudio da página que o
            // bot captura e manda pra reunião. autoPlay sozinho pode ser
            // barrado por política de autoplay — chamamos play() explicitamente.
            void audioRef.current.play().catch(() => undefined);
          }
        }) as never);

        // Áudio da reunião → microfone da agente. Dentro do bot do Recall.ai,
        // getUserMedia devolve o áudio da REUNIÃO (o bot concede a permissão
        // sozinho, sem clique — documentado em docs.recall.ai/docs/stream-media).
        // Sem isso a agente entra surda: foi exatamente o que aconteceu no
        // primeiro teste ao vivo.
        let audioSource: MediaStreamTrack | undefined;
        try {
          // O "microfone" aqui É o áudio já mixado da reunião — processá-lo de
          // novo (AGC/echo-cancel/noise-suppression do Chrome) distorce e
          // bombeia o volume. Pedimos o sinal cru.
          const meetingStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          audioSource = meetingStream.getAudioTracks()[0];
        } catch {
          // Fora do bot (ex.: conferindo a página no navegador) não há permissão
          // nem áudio de reunião — segue só com vídeo, sem quebrar a página.
        }
        if (cancelled) return;

        await call.join({
          url: roomUrl,
          userName: "Axtro",
          startVideoOff: true,
          startAudioOff: audioSource === undefined,
          ...(audioSource ? { audioSource } : {}),
        });
        if (cancelled) return;
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      const call = callRef.current;
      callRef.current = null;
      if (call) void call.leave().then(() => call.destroy()).catch(() => undefined);
    };
  }, [roomUrl]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b0b16",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: state === "live" ? "block" : "none",
        }}
      />
      <audio ref={audioRef} autoPlay />
      {state !== "live" && (
        <p style={{ color: "rgba(226,222,255,0.75)", fontFamily: "system-ui, sans-serif", fontSize: "1rem" }}>
          {state === "error" ? "Não foi possível conectar à sala da agente." : "Conectando…"}
        </p>
      )}
    </div>
  );
}
