// Formatação de data/hora no fuso do tenant, à prova de string inválida
// (achado da auto-revisão D-V2-115): `Intl.DateTimeFormat`/`toLocaleDateString`
// lançam `RangeError` pra um `timeZone` IANA desconhecido — sem essa defesa,
// um `default_timezone` corrompido/legado derrubaria a página inteira em vez
// de só mostrar a data num fuso levemente errado. `default_timezone` só é
// validado hoje pelo dropdown fixo da UI de configurações (nenhuma checagem
// de banco), então um dado ruim entrando por fora dela (import, edição
// manual) não tinha nenhuma rede de segurança antes desta função.
const FALLBACK_TIME_ZONE = "America/Sao_Paulo";

export function formatDateTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FALLBACK_TIME_ZONE }).format(new Date(iso));
  }
}

export function formatLongDate(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone });
  } catch {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: FALLBACK_TIME_ZONE });
  }
}
