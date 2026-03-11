import Ably from 'ably';

function getApiKey(): string {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) throw new Error('ABLY_API_KEY environment variable is required');
  return apiKey;
}

let realtimeClient: Ably.Realtime | null = null;
let restClient: Ably.Rest | null = null;

// Shared Realtime client for non-presence operations (publishing, subscribing).
// No clientId — uses privileged (API key) connection so clientId can be set
// per-message on REST publishes. For Realtime publishes (agent responses),
// messages are identified by name ('response').
export function getRealtimeClient(): Ably.Realtime {
  if (!realtimeClient) {
    // Prevents the agent from receiving its own messages. Future AI Transport SDK
    // versions may handle this automatically for agent connections.
    realtimeClient = new Ably.Realtime({ key: getApiKey(), echoMessages: false });
  }
  return realtimeClient;
}

export function getRestClient(): Ably.Rest {
  if (!restClient) {
    restClient = new Ably.Rest({ key: getApiKey() });
  }
  return restClient;
}

export function closeRealtimeClient(): void {
  if (realtimeClient) {
    realtimeClient.close();
    realtimeClient = null;
  }
}

// Per-session Realtime clients for presence.
// Each activity creates and closes its own Realtime client with
// clientId: 'ai-agent:<sessionId>' so that presence is scoped per-session.
// There is no cross-activity caching because Temporal activities have no worker
// affinity — sequential activities from the same workflow can land on different
// worker processes, making a Map-based cache a leak vector.
//
// SIMPLIFICATION OPPORTUNITY: Each activity creates and closes its own Realtime
// client (~100-300ms connection overhead per activity). The SDK should provide
// connection pooling with identity isolation — one pooled connection, multiple
// independent clientIds with their own presence and message identity.
export function createSessionRealtimeClient(sessionId: string): Ably.Realtime {
  return new Ably.Realtime({
    key: getApiKey(),
    // Prevents the agent from receiving its own messages. Future AI Transport SDK
    // versions may handle this automatically for agent connections.
    echoMessages: false,
    clientId: `ai-agent:${sessionId}`,
  });
}

export function channelName(sessionId: string): string {
  return `ai:support:${sessionId}`;
}
