// Loads an optional .env from the project folder. No file is fine: nothing is needed to start.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env: use defaults
}
