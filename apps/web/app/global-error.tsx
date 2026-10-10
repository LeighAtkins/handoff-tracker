"use client";

/** Last-resort boundary for errors in the root layout itself. Kept dependency-free on purpose. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem" }}>
        <h1>Something went wrong</h1>
        <p>Handoff Tracker could not load. Try again in a moment.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
