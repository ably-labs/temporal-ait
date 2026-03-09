import { Client, Connection } from '@temporalio/client';

export const TASK_QUEUE = 'support-copilot';

// Cache the connection promise (not the resolved client) to handle concurrent requests.
// In Next.js dev mode, module-level state can be lost between HMR reloads,
// so we use globalThis to persist across reloads.
const globalForTemporal = globalThis as unknown as {
  __temporalClient: Client | undefined;
  __temporalConnecting: Promise<Client> | undefined;
};

export async function getTemporalClient(): Promise<Client> {
  if (globalForTemporal.__temporalClient) {
    return globalForTemporal.__temporalClient;
  }

  if (!globalForTemporal.__temporalConnecting) {
    globalForTemporal.__temporalConnecting = (async () => {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      });
      const client = new Client({
        connection,
        namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
      });
      globalForTemporal.__temporalClient = client;
      globalForTemporal.__temporalConnecting = undefined;
      return client;
    })();
  }

  return globalForTemporal.__temporalConnecting;
}
