"use client";

import { useEffect } from "react";

/**
 * Um link direto pra âncora (`/#governanca`, compartilhado ou favoritado)
 * nunca rolava até a seção certa: o navegador só tenta o scroll-to-hash
 * nativo uma vez, muito cedo, e a hidratação do Next.js corre por baixo dele
 * o suficiente pra essa tentativa nunca pegar (achado navegando o produto
 * como um usuário real: clicar "Governança" no menu SEMPRE funcionava,
 * porque é uma navegação nativa dentro da mesma página já carregada; abrir
 * `/#governanca` direto SEMPRE ficava no topo). Depois que o React monta,
 * já não sobra outra chance automática. `scrollIntoView` aqui, no primeiro
 * efeito da página, é o fallback padrão pra esse caso em apps Next.js.
 */
export function ScrollToHash() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length <= 1) return;
    let target: HTMLElement | null;
    try {
      target = document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch {
      return;
    }
    target?.scrollIntoView();
  }, []);

  return null;
}
