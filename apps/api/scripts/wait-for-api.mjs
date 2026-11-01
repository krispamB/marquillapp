// Readiness probe for `turbo run dev`: exits 0 once the API dev server accepts
// HTTP requests, so turbo starts web and landing only after the API is up.
// Any HTTP response counts as ready; a refused connection means it is still starting.
const port = process.env.PORT || 3500;
const url = `http://localhost:${port}/api/v1`;
const timeoutMs = 180_000;
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    console.log(`API is ready at ${url}`);
    process.exit(0);
  } catch {
    // Not listening yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`API did not become ready at ${url} within ${timeoutMs / 1000}s`);
process.exit(1);
