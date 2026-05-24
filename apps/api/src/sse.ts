// ── Shared SSE broadcaster ────────────────────────────────────────────
// Extracted so agents and other services can notify dashboard clients
// without importing from server.ts (avoids circular deps).

export interface SSEClient {
  id: string;
  write: (data: string) => void;
}

const sseClients = new Set<SSEClient>();

export function addSSEClient(client: SSEClient): () => void {
  sseClients.add(client);
  return () => {
    sseClients.delete(client);
  };
}

export function broadcastSSE(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}
