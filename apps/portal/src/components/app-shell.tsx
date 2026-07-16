"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/lib/actions/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Visão geral", icon: IconHome },
  { href: "/agentes", label: "Agentes", icon: IconAgent },
  { href: "/conhecimento", label: "Conhecimento", icon: IconBook },
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
  const initial = email.slice(0, 1);

  return (
    <div className="app-shell" data-menu={menuOpen ? "open" : "closed"}>
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Digital Human OS</span>
        </div>
        <nav className="nav">
          <span className="nav-section-label">Operação</span>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className="nav-link"
              aria-current={pathname.startsWith(href) ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
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
        onClick={() => setMenuOpen(false)}
      />
      <div className="content">
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconMenu />
          </button>
          <div style={{ flex: 1 }} />
          <span className="badge badge-accent"><span className="badge-dot" />Ambiente de configuração</span>
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
