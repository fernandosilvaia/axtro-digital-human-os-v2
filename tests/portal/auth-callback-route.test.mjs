import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * Callback de autenticação (link de confirmação de cadastro e de nova senha).
 * Em produção o Railway entrega `request.url` com o host interno
 * (https://localhost:8080), e a pessoa era mandada para lá depois de clicar no
 * e-mail. O redirect precisa sair sempre na origem pública revisada.
 */
const mockSources = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static redirect(url) { return new Response(null, { status: 307, headers: { location: String(url) } }); }
    }
  `],
  ["@/lib/supabase/server", `
    export async function createClient() {
      return { auth: { exchangeCodeForSession: async () => ({ error: globalThis.__authCallbackState.exchangeError }) } };
    }
  `],
  ["@/lib/public-origin", `
    export function deployedPublicOrigin() {
      const state = globalThis.__authCallbackState;
      return state.originThrows ? null : state.portalOrigin;
    }
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `auth-callback-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("auth-callback-mock:")) {
      const specifier = decodeURIComponent(url.slice("auth-callback-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

function freshState(overrides = {}) {
  globalThis.__authCallbackState = { portalOrigin: "https://portal.test", originThrows: false, exchangeError: null, ...overrides };
}

const internal = (query = "") => ({ url: `https://localhost:8080/auth/callback${query}` });
const { GET } = await import("../../apps/portal/src/app/auth/callback/route.ts");

test("auth callback redirects to the public origin, never to the internal proxy host", async () => {
  freshState();
  assert.equal((await GET(internal("?code=abc&next=/nova-senha"))).headers.get("location"), "https://portal.test/nova-senha");
  assert.equal((await GET(internal("?code=abc"))).headers.get("location"), "https://portal.test/dashboard");
  assert.equal((await GET(internal())).headers.get("location"), "https://portal.test/login");

  freshState({ exchangeError: new Error("expired") });
  assert.equal((await GET(internal("?code=abc"))).headers.get("location"), "https://portal.test/login");
});

test("auth callback keeps the open-redirect guard on next", async () => {
  freshState();
  for (const next of ["//evil.example", "/\\evil.example", "https://evil.example"]) {
    const query = `?code=abc&next=${encodeURIComponent(next)}`;
    assert.equal((await GET(internal(query))).headers.get("location"), "https://portal.test/dashboard", next);
  }
});

test("without a deployed public origin (local dev, CI fake mode) the request origin is used", async () => {
  freshState({ originThrows: true });
  assert.equal((await GET({ url: "http://localhost:3000/auth/callback" })).headers.get("location"), "http://localhost:3000/login");
});
