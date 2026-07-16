"use client";

import { useActionState } from "react";

import { updateTenantProfile, type TenantProfileActionState } from "@/lib/actions/tenant";

const LANGUAGES = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Español (España)" },
] as const;

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/Lisbon",
  "Europe/Madrid",
] as const;

const initialState: TenantProfileActionState = { error: null, saved: false };

export interface TenantProfileFormProps {
  readonly legalName: string;
  readonly defaultLanguage: string;
  readonly defaultTimezone: string;
}

export function TenantProfileForm({ legalName, defaultLanguage, defaultTimezone }: TenantProfileFormProps) {
  const [state, formAction, pending] = useActionState(updateTenantProfile, initialState);

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="legal_name">Nome da conta</label>
        <input
          id="legal_name"
          name="legal_name"
          type="text"
          defaultValue={legalName}
          maxLength={200}
          required
        />
        <span className="hint">Aparece em relatórios, propostas e comunicações.</span>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="default_language">Idioma padrão</label>
          <select id="default_language" name="default_language" defaultValue={defaultLanguage}>
            {LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>{language.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="default_timezone">Fuso horário</label>
          <select id="default_timezone" name="default_timezone" defaultValue={defaultTimezone}>
            {TIMEZONES.map((timezone) => (
              <option key={timezone} value={timezone}>{timezone}</option>
            ))}
          </select>
        </div>
      </div>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Salvando..." : "Salvar alterações"}
        </button>
        {state.saved && !pending && (
          <span className="saved-flag" role="status">✓ Salvo</span>
        )}
      </div>
    </form>
  );
}
