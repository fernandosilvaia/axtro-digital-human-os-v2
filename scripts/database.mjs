import process from "node:process";

const database = await import(new URL("../packages/database/dist/index.js", import.meta.url));
const [command, ...argumentsList] = process.argv.slice(2);
const databaseUrl = process.env.AXTRO_LOCAL_DATABASE_URL;
const psqlPath = process.env.AXTRO_PSQL_PATH;

try {
  if (process.env.AXTRO_ALLOW_LOCAL_DATABASE_URL !== "1") {
    throw new Error("AXTRO_LOCAL_DATABASE_URL requires AXTRO_ALLOW_LOCAL_DATABASE_URL=1");
  }
  if (command === "migrate") {
    const targetVersion = parseTargetVersion(argumentsList);
    const result = database.applyLocalMigrations({ databaseUrl, psqlPath, targetVersion });
    console.log(`DATABASE MIGRATIONS APPLIED: ${result.applied.length} new, ${result.history.length} total`);
  } else if (command === "drift") {
    rejectArguments(argumentsList);
    const result = database.checkLocalSchemaDrift({ databaseUrl, psqlPath });
    console.log(`DATABASE DRIFT CHECK PASSED: ${result.migrationCount} migrations, ${result.catalogFingerprint}`);
  } else {
    throw new Error("Usage: database.mjs migrate [--target-version=N] | drift");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Local database command failed";
  console.error(`DATABASE COMMAND FAILED: ${message}`);
  process.exitCode = 1;
}

function parseTargetVersion(values) {
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !/^--target-version=\d+$/.test(values[0])) {
    throw new Error("Usage: database.mjs migrate [--target-version=N]");
  }
  return Number(values[0].slice("--target-version=".length));
}

function rejectArguments(values) {
  if (values.length > 0) throw new Error("Usage: database.mjs drift");
}
