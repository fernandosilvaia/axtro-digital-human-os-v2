"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { signOut } from "@/lib/actions/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Visão geral", icon: IconHome },
  { href: "/agentes", label: "Agentes", icon: IconAgent },
  { href: "/conhecimento", label: "Conhecimento", icon: IconBook },
  { href: "/conversas", label: "Conversas", icon: IconChat },
  { href: "/configuracoes", label: "Configurações", icon: IconGear },
] as const;

export interface AppShellProps {
  readonly email: string;
  readonly roleLabel: string;
  readonly children: React.ReactNode;
}

export function AppShell({ email, roleLabel, children }: AppShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobileNavigation, setIsMobileNavigation] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const initial = email.slice(0, 1);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 860px)");
    const syncNavigationMode = () => {
      setIsMobileNavigation(mediaQuery.matches);
      if (!mediaQuery.matches) setMenuOpen(false);
    };

    syncNavigationMode();
    mediaQuery.addEventListener("change", syncNavigationMode);
    return () => mediaQuery.removeEventListener("change", syncNavigationMode);
  }, []);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuToggleRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!isMobileNavigation || !menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key === "Tab") {
        const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        );
        if (!focusable?.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first === undefined || last === undefined) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeMenu, isMobileNavigation, menuOpen]);

  useEffect(() => {
    if (!isMobileNavigation || !menuOpen) return;
    // The sidebar's visibility:hidden->visible transition flips at 0% of the
    // CSS transition per spec, but Chromium doesn't treat descendants as
    // focusable until the browser has actually painted that style change —
    // one requestAnimationFrame (before paint) is still too early, so this
    // waits for the frame after paint instead.
    const raf1 = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        navigationRef.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
      });
    });
    return () => window.cancelAnimationFrame(raf1);
  }, [isMobileNavigation, menuOpen]);

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu();
    } else {
      setMenuOpen(true);
    }
  };

  return (
    <div className="app-shell" data-menu={menuOpen ? "open" : "closed"}>
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <aside
        ref={sidebarRef}
        className="sidebar"
        aria-label="Navegação principal"
        aria-hidden={isMobileNavigation && !menuOpen ? true : undefined}
        inert={isMobileNavigation && !menuOpen ? true : undefined}
      >
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Axtro Closer AI Human</span>
        </div>
        <nav ref={navigationRef} id="navegacao-principal" className="nav">
          <span className="nav-section-label">Operação</span>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className="nav-link"
              aria-current={pathname.startsWith(href) ? "page" : undefined}
              onClick={() => closeMenu()}
            >
              <Icon />
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <span className="meta">
              <span className="email" title={email}>{email}</span>
              <span className="role">{roleLabel}</span>
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className="sign-out-button">Sair da conta</button>
          </form>
        </div>
      </aside>
      <button
        type="button"
        className="scrim"
        aria-label="Fechar menu"
        tabIndex={-1}
        onClick={() => closeMenu()}
      />
      <div className="content" inert={isMobileNavigation && menuOpen ? true : undefined}>
        <header className="topbar">
          <button
            ref={menuToggleRef}
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
            aria-controls="navegacao-principal"
            onClick={toggleMenu}
          >
            <IconMenu />
          </button>
          <div style={{ flex: 1 }} />
          <span className="badge badge-accent">Axtro Closer AI Human</span>
        </header>
        <main id="conteudo" className="page">{children}</main>
      </div>
    </div>
  );
}

function IconHome() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function IconAgent() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-3.6 3.6-6 8-6s8 2.4 8 6" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z" /><path d="M4 19a2 2 0 0 0 2 2h14" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l1.4-4.2A8 8 0 1 1 9 19.5L4 20Z" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5h.1a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
