// Defense in depth for this fixed local CLI. Fail closed if any imported tooling
// attempts network egress, even with telemetry and remote generation disabled.
const deny = () => { throw new Error("closer lab network egress prohibited"); };
for (const [moduleName, methods] of [
  ["node:net", ["connect", "createConnection"]],
  ["node:tls", ["connect"]],
  ["node:http2", ["connect"]],
  ["node:http", ["request", "get"]],
  ["node:https", ["request", "get"]],
  ["node:dns", ["lookup", "resolve", "resolve4", "resolve6"]],
  ["node:child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
]) {
  const module = require(moduleName);
  for (const method of methods) module[method] = deny;
}
globalThis.fetch = async () => deny();
require("node:module").syncBuiltinESMExports();

require("node:net").Socket.prototype.connect = deny;
require("node:dgram").Socket.prototype.send = deny;
require("node:dgram").Socket.prototype.connect = deny;

require("node:worker_threads").Worker = class { constructor() { deny(); } };
require("node:module").syncBuiltinESMExports();

const dns = require("node:dns");
for (const surface of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const method of Object.getOwnPropertyNames(surface)) {
    if (/^(resolve|lookup|reverse)/.test(method) && typeof surface[method] === "function") surface[method] = deny;
  }
}
require("node:module").syncBuiltinESMExports();

require("node:child_process").ChildProcess.prototype.spawn = deny;
