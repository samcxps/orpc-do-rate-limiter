import { ORPCError } from "@orpc/client";
import { useState } from "react";
import viteLogo from "/vite.svg";
import cloudflareLogo from "./assets/Cloudflare_Logo.svg";
import reactLogo from "./assets/react.svg";
import { client } from "./lib/orpc";

import "./app.css";

function App() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<{
    code: string;
    message: string;
    data: unknown;
  } | null>(null);

  return (
    <>
      <div>
        <a href="https://vite.dev" rel="noopener" target="_blank">
          <img
            alt="Vite logo"
            className="logo"
            height={100}
            src={viteLogo}
            width={100}
          />
        </a>
        <a href="https://react.dev" rel="noopener" target="_blank">
          <img
            alt="React logo"
            className="logo react"
            height={100}
            src={reactLogo}
            width={100}
          />
        </a>
        <a
          href="https://workers.cloudflare.com/"
          rel="noopener"
          target="_blank"
        >
          <img
            alt="Cloudflare logo"
            className="logo cloudflare"
            height={150}
            src={cloudflareLogo}
            width={150}
          />
        </a>
      </div>
      <h1>Vite + React + Cloudflare</h1>
      <pre className="message">Message: {JSON.stringify(message, null, 2)}</pre>
      <pre className="error">Error: {JSON.stringify(error, null, 2)}</pre>
      <div className="card">
        <button
          aria-label="increment"
          onClick={() =>
            client.notLimited().then((result) => {
              setMessage(result.message);
              setError(null);
            })
          }
          type="button"
        >
          Call route with no rate limit
        </button>
        <button
          aria-label="increment"
          onClick={() =>
            client
              .middlewareLimited()
              .then((result) => {
                setMessage(result.message);
                setError(null);
              })
              .catch((err) => {
                if (err instanceof ORPCError) {
                  setError({
                    code: err.code,
                    message: err.message,
                    data: err.data,
                  });
                }
              })
          }
          type="button"
        >
          Call route with middleware rate limit
        </button>
        <button
          aria-label="increment"
          onClick={() =>
            client
              .directUsageLimited()
              .then((result) => {
                setMessage(result.message);
                setError(null);
              })
              .catch((err) => {
                if (err instanceof ORPCError) {
                  setError({
                    code: err.code,
                    message: err.message,
                    data: err.data,
                  });
                }
              })
          }
          type="button"
        >
          Call route with direct usage rate limit
        </button>
      </div>
    </>
  );
}

export default App;
