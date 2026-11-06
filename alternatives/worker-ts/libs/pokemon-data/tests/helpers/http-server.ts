import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
  /** Base de la API de mentira, p. ej. http://127.0.0.1:1234/api/v2 */
  baseUrl: string;
  close(): Promise<void>;
}

/** Servidor HTTP en proceso, en un puerto libre. */
export async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v2`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify(body));
}
