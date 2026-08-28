import assert from "node:assert/strict";
import { test } from "node:test";

const idToken = await import("../../apps/portal/src/lib/google-calendar/id-token.ts");

function jwtFor(payload, header = { alg: "none", typ: "JWT" }) {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode(header)}.${encode(payload)}.fake-signature`;
}

test("decodifica a claim email de um id_token bem formado, sem tocar a assinatura", () => {
  const token = jwtFor({ email: "tenant.owner@example.com", email_verified: true });
  assert.equal(idToken.decodeGoogleIdTokenEmail(token), "tenant.owner@example.com");
});

test("devolve null quando o token não tem 3 segmentos (não é um JWT)", () => {
  assert.equal(idToken.decodeGoogleIdTokenEmail("nao-e-um-jwt"), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail("so.dois"), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail("a.b.c.d"), null);
});

test("devolve null quando o payload não decodifica pra JSON válido", () => {
  const garbagePayload = Buffer.from("isto não é json", "utf8").toString("base64url");
  assert.equal(idToken.decodeGoogleIdTokenEmail(`header.${garbagePayload}.sig`), null);
});

test("devolve null quando o payload é JSON válido mas não é um objeto (array/primitivo)", () => {
  const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3]), "utf8").toString("base64url");
  assert.equal(idToken.decodeGoogleIdTokenEmail(`header.${arrayPayload}.sig`), null);

  const stringPayload = Buffer.from(JSON.stringify("oi"), "utf8").toString("base64url");
  assert.equal(idToken.decodeGoogleIdTokenEmail(`header.${stringPayload}.sig`), null);
});

test("devolve null quando a claim email está ausente ou tem formato inválido", () => {
  assert.equal(idToken.decodeGoogleIdTokenEmail(jwtFor({ sub: "123" })), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail(jwtFor({ email: "" })), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail(jwtFor({ email: "não-é-email" })), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail(jwtFor({ email: 42 })), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail(jwtFor({ email: "a".repeat(321) + "@example.com" })), null);
});

test("devolve null pra input vazio, não-string ou absurdamente grande (bound defensivo)", () => {
  assert.equal(idToken.decodeGoogleIdTokenEmail(""), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail(null), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail(undefined), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail(42), null);
  assert.equal(idToken.decodeGoogleIdTokenEmail("a.".repeat(5000) + "b"), null);
});

test("nunca lança para input adversarial — sempre devolve null ou o e-mail", () => {
  const adversarial = [
    "....",
    ".".repeat(10),
    "a.b.",
    ".a.b",
    "🙂.🙂.🙂",
    jwtFor({ email: { toString: () => "x@x.com" } }),
  ];
  for (const value of adversarial) {
    assert.doesNotThrow(() => idToken.decodeGoogleIdTokenEmail(value));
  }
});
