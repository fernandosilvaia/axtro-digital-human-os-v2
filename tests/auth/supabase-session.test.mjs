import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);

const tenantAlpha = id(1);
const actorAlpha = id(2);

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_300_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

async function startJwksServer(publicJwk) {
  const server = createServer((request, response) => {
    if (request.url === "/auth/v1/.well-known/jwks.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, supabaseUrl: `http://127.0.0.1:${port}` };
}

async function issueSessionToken(privateKey, supabaseUrl, claimOverrides = {}) {
  const issuer = `${supabaseUrl}/auth/v1`;
  return new SignJWT({
    email: "owner@tenant-alpha.test",
    app_metadata: { tenant_id: tenantAlpha, actor_id: actorAlpha, tenant_role: "tenant_admin" },
    ...claimOverrides,
  })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setSubject("8ccaa7af-909f-44e7-84cb-67cdccb56be6")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

test("a verified Supabase session JWT resolves exactly the tenant and actor its app_metadata claims carry", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(publicKey)), alg: "ES256", use: "sig" };
  const { server, supabaseUrl } = await startJwksServer(publicJwk);
  try {
    const verifier = new auth.SupabaseSessionIdentityVerifier({ supabaseUrl });
    const token = await issueSessionToken(privateKey, supabaseUrl);

    const resolved = await auth.resolveAuthorizedUserRequestContext({ authorization: `Bearer ${token}` }, verifier);

    assert.equal(resolved.tenantContext.tenantId, tenantAlpha);
    assert.equal(resolved.tenantContext.actorId, actorAlpha);
    assert.equal(resolved.tenantContext.actorType, "human_operator");
    assert.deepEqual(resolved.tenantContext.grantedScopes, ["session:read", "session:write", "provider:use", "tool:use"]);
    assert.deepEqual(resolved.tenantContext.purposes, ["essential_processing"]);
    assert.equal(resolved.principal.identityKind, "user");
    assert.equal(Object.isFrozen(resolved), true);
    assert.equal(Object.isFrozen(resolved.tenantContext.grantedScopes), true);
  } finally {
    server.close();
  }
});

test("tenant_operator claims resolve a narrower read-only scope grant", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(publicKey)), alg: "ES256", use: "sig" };
  const { server, supabaseUrl } = await startJwksServer(publicJwk);
  try {
    const verifier = new auth.SupabaseSessionIdentityVerifier({ supabaseUrl });
    const token = await issueSessionToken(privateKey, supabaseUrl, {
      app_metadata: { tenant_id: tenantAlpha, actor_id: actorAlpha, tenant_role: "tenant_operator" },
    });

    const resolved = await auth.resolveAuthorizedUserRequestContext({ authorization: `Bearer ${token}` }, verifier);
    assert.deepEqual(resolved.tenantContext.grantedScopes, ["session:read"]);
  } finally {
    server.close();
  }
});

test("session auth fails closed for a forged signature, wrong issuer, expired token, and missing or unknown tenant claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const { privateKey: otherPrivateKey } = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(publicKey)), alg: "ES256", use: "sig" };
  const { server, supabaseUrl } = await startJwksServer(publicJwk);
  try {
    const verifier = new auth.SupabaseSessionIdentityVerifier({ supabaseUrl });

    const forgedSignature = await issueSessionToken(otherPrivateKey, supabaseUrl);
    const wrongIssuer = await new SignJWT({
      app_metadata: { tenant_id: tenantAlpha, actor_id: actorAlpha, tenant_role: "tenant_admin" },
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://impostor.example/auth/v1")
      .setAudience("authenticated")
      .setSubject("8ccaa7af-909f-44e7-84cb-67cdccb56be6")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const expired = await new SignJWT({
      app_metadata: { tenant_id: tenantAlpha, actor_id: actorAlpha, tenant_role: "tenant_admin" },
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(`${supabaseUrl}/auth/v1`)
      .setAudience("authenticated")
      .setSubject("8ccaa7af-909f-44e7-84cb-67cdccb56be6")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    const noAppMetadata = await issueSessionToken(privateKey, supabaseUrl, { app_metadata: undefined });
    const unknownRole = await issueSessionToken(privateKey, supabaseUrl, {
      app_metadata: { tenant_id: tenantAlpha, actor_id: actorAlpha, tenant_role: "superuser" },
    });
    const notYetProvisioned = await issueSessionToken(privateKey, supabaseUrl, { app_metadata: {} });

    for (const token of [forgedSignature, wrongIssuer, expired, noAppMetadata, unknownRole, notYetProvisioned]) {
      await assert.rejects(
        () => auth.resolveAuthorizedUserRequestContext({ authorization: `Bearer ${token}` }, verifier),
        auth.AuthenticationError,
      );
    }

    await assert.rejects(
      () => auth.resolveAuthorizedUserRequestContext({ authorization: undefined }, verifier),
      auth.AuthenticationError,
    );
  } finally {
    server.close();
  }
});

test("SupabaseSessionIdentityVerifier rejects a malformed project URL and accepts loopback http only for the local hostnames", () => {
  assert.throws(
    () => new auth.SupabaseSessionIdentityVerifier({ supabaseUrl: "not-a-url" }),
    auth.SupabaseSessionConfigurationError,
  );
  assert.throws(
    () => new auth.SupabaseSessionIdentityVerifier({ supabaseUrl: "http://example.com" }),
    auth.SupabaseSessionConfigurationError,
  );
  assert.throws(
    () => new auth.SupabaseSessionIdentityVerifier({ supabaseUrl: "https://project.supabase.co/extra-path" }),
    auth.SupabaseSessionConfigurationError,
  );
  assert.doesNotThrow(() => new auth.SupabaseSessionIdentityVerifier({ supabaseUrl: "https://project.supabase.co" }));
  assert.doesNotThrow(() => new auth.SupabaseSessionIdentityVerifier({ supabaseUrl: "http://127.0.0.1:54321" }));
});
