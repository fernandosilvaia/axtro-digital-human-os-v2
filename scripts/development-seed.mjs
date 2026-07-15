import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const database = await import(new URL("../packages/database/dist/index.js", import.meta.url));
const seedPath = fileURLToPath(new URL("../database/seeds/tenant_zero_development.sql", import.meta.url));
const databaseUrl = process.env.AXTRO_LOCAL_DATABASE_URL;
const psqlPath = process.env.AXTRO_PSQL_PATH;

try {
  if (process.argv.length !== 2) throw new Error("Usage: development-seed.mjs");
  if (process.env.AXTRO_ALLOW_LOCAL_DATABASE_URL !== "1") {
    throw new Error("AXTRO_LOCAL_DATABASE_URL requires AXTRO_ALLOW_LOCAL_DATABASE_URL=1");
  }
  const localDatabaseUrl = database.parseLocalDatabaseUrl(databaseUrl);
  database.checkLocalSchemaDrift({ databaseUrl: localDatabaseUrl, psqlPath });
  const result = spawnSync(psqlPath ?? "psql", [
    "--no-psqlrc",
    "--no-password",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    localDatabaseUrl,
    "--file",
    seedPath,
  ], {
    encoding: "utf8",
    env: database.createSanitizedPsqlEnvironment(process.env),
  });
  if (result.status !== 0) throw new Error("Development seed could not be applied to the local database");
  console.log("DEVELOPMENT SEED APPLIED: tenant-zero-alpha, tenant-zero-beta");
} catch (error) {
  const message = error instanceof Error ? error.message : "Local development seed failed";
  console.error(`DEVELOPMENT SEED FAILED: ${message}`);
  process.exitCode = 1;
}
