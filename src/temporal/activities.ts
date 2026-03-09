import { Context } from '@temporalio/activity';
import { getRealtimeClient, getRestClient, channelName } from './ably-clients';
import { streamClaude } from './llm';
import type { Message } from './workflows';

export interface LLMResult {
  type: 'text' | 'tool_use' | 'escalate';
  fullText: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  rawContentBlocks?: unknown[];
  msgSerial?: string;
}

export interface Activities {
  publishUserMessage(sessionId: string, message: string, customerName: string, messageId: string): Promise<void>;
  publishAgentMessage(sessionId: string, message: string, messageId: string): Promise<void>;
  callLLMStreaming(sessionId: string, messages: Message[], turnIndex: number): Promise<LLMResult>;
  executeToolCall(sessionId: string, toolName: string, toolInput: Record<string, unknown>): Promise<unknown>;
  publishEscalation(sessionId: string, reason: string): Promise<void>;
  notifyHumanAgent(
    sessionId: string,
    context: { customerName: string; reason: string; history: Message[] }
  ): Promise<string>;
  updateEscalationStatus(
    escalationSerial: string,
    status: 'responding' | 'resolved' | 'dismissed',
    sessionId: string
  ): Promise<void>;
}

/**
 * Publish a user message to the Ably session channel on behalf of the customer.
 * Uses REST with a deterministic message ID for idempotent publishing (safe on retry).
 * Sets clientId on the message so subscribers can attribute it to the user.
 */
export async function publishUserMessage(
  sessionId: string,
  message: string,
  customerName: string,
  messageId: string
): Promise<void> {
  const rest = getRestClient();
  const channel = rest.channels.get(channelName(sessionId));
  await channel.publish({ id: messageId, name: 'user', data: message, clientId: customerName });
}

/**
 * Publish a human agent's message to the session channel.
 * Uses name 'response' so the frontend renders it as an assistant/agent bubble.
 */
export async function publishAgentMessage(
  sessionId: string,
  message: string,
  messageId: string
): Promise<void> {
  const rest = getRestClient();
  const channel = rest.channels.get(channelName(sessionId));
  await channel.publish({
    id: messageId,
    name: 'response',
    data: message,
    extras: { headers: { status: 'complete', source: 'human-agent' } },
  });
}

/**
 * Stream LLM response tokens to Ably using the message-per-response pattern.
 *
 * Attempt-aware publishing (Decision 10):
 * - Attempt 1: Realtime publish (fast path, no idempotency overhead)
 * - Attempt 2+: REST publish with deterministic message ID. If the message
 *   already exists (dedup), the publish is a no-op — the original message
 *   with its partial appends is untouched. updateMessage({ data: '' })
 *   clears any partial content so we can stream fresh.
 *
 * Dedup window: documented as ~2 minutes from original publish, but tested
 * to confirm that appends/updates extend it. Since we constantly append
 * tokens during streaming, the window stays open for the stream's lifetime.
 */
export async function callLLMStreaming(
  sessionId: string,
  messages: Message[],
  turnIndex: number
): Promise<LLMResult> {
  const attempt = Context.current().info.attempt;
  const realtime = getRealtimeClient();
  const rest = getRestClient();
  const realtimeChannel = realtime.channels.get(channelName(sessionId));
  const restChannel = rest.channels.get(channelName(sessionId));

  const messageId = `msg_${sessionId}_turn${turnIndex}`;
  let msgSerial: string;

  if (attempt === 1) {
    // FAST PATH: Realtime publish, no idempotency overhead
    const result = await realtimeChannel.publish({ name: 'response', data: '' });
    const serial = result.serials[0];
    if (!serial) throw new Error('Failed to get serial from Realtime publish');
    msgSerial = serial;
  } else {
    // RECOVERY PATH: REST publish with deterministic ID = idempotent create-if-not-exists.
    // On attempt 2: creates a new message (attempt 1 used Realtime with no ID).
    //   The updateMessage below is a harmless no-op (message is already empty).
    // On attempt 3+: deduped (same ID as attempt 2), returns the existing message's
    //   serial. That message may have partial appends from the crashed prior attempt.
    //   The updateMessage resets its body so we can stream fresh.
    const result = await restChannel.publish({ id: messageId, name: 'response', data: '' });
    const serial = result.serials[0];
    if (!serial) throw new Error('Failed to get serial from REST idempotent publish');
    msgSerial = serial;
    await realtimeChannel.updateMessage({ serial: msgSerial, data: '' });
  }

  // Stream Claude response, appending each token to Ably
  const appendPromises: Promise<unknown>[] = [];
  let fullText = '';

  const llmResult = await streamClaude(messages, {
    onToken: (text) => {
      fullText += text;
      // Don't await — pipeline appends for throughput (per Ably docs)
      appendPromises.push(realtimeChannel.appendMessage({ serial: msgSerial, data: text }));
    },
    heartbeat: () => Context.current().heartbeat(),
  });

  // Wait for all appends; fall back to full updateMessage if any failed
  const results = await Promise.allSettled(appendPromises);
  const anyFailed = results.some((r) => r.status === 'rejected');

  if (anyFailed) {
    await realtimeChannel.updateMessage({ serial: msgSerial, data: fullText });
  }

  // Signal completion — extras-only update, body preserved via shallow mixin semantics
  await realtimeChannel.updateMessage({
    serial: msgSerial,
    extras: { headers: { status: 'complete' } },
  });

  return {
    type: llmResult.type,
    fullText: llmResult.fullText,
    toolName: llmResult.toolName,
    toolInput: llmResult.toolInput,
    toolUseId: llmResult.toolUseId,
    rawContentBlocks: llmResult.rawContentBlocks,
    msgSerial,
  };
}

/**
 * Execute a tool call and publish status to the session channel.
 * Publishes a 'tool' message with loading state, then updates with result.
 */
export async function executeToolCall(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<unknown> {
  const realtime = getRealtimeClient();
  const channel = realtime.channels.get(channelName(sessionId));

  // Publish tool call start
  const result = await channel.publish({
    name: 'tool',
    data: JSON.stringify({ toolName, input: toolInput, status: 'calling' }),
  });
  const serial = result.serials[0];

  let toolResult: unknown;
  switch (toolName) {
    case 'lookupOrder':
      toolResult = {
        orderId: toolInput.orderId,
        status: 'shipped',
        trackingNumber: 'TRK-12345-MOCK',
        estimatedDelivery: '2026-03-10',
      };
      break;
    case 'checkRefundStatus':
      toolResult = { refundId: toolInput.refundId, status: 'processing', estimatedCompletion: '3-5 business days' };
      break;
    case 'getAccountDetails':
      toolResult = { customerId: toolInput.customerId, name: 'Jane Doe', plan: 'Pro', memberSince: '2024-01' };
      break;
    default:
      toolResult = { error: `Unknown tool: ${toolName}` };
  }

  // Publish tool result — update the same message with result data
  if (serial) {
    await channel.updateMessage({
      serial,
      data: JSON.stringify({ toolName, input: toolInput, status: 'complete', result: toolResult }),
    });
  }

  return toolResult;
}

/**
 * Publish an escalation notice to the session channel so the customer sees it.
 */
export async function publishEscalation(
  sessionId: string,
  reason: string
): Promise<void> {
  const rest = getRestClient();
  const channel = rest.channels.get(channelName(sessionId));
  await channel.publish({ name: 'escalation', data: reason });
}

export async function notifyHumanAgent(
  sessionId: string,
  context: { customerName: string; reason: string; history: Message[] }
): Promise<string> {
  const realtime = getRealtimeClient();
  const channel = realtime.channels.get('ai:agent:escalations');
  const result = await channel.publish({
    name: 'escalation',
    data: JSON.stringify({
      sessionId,
      customerName: context.customerName,
      reason: context.reason,
      messageCount: context.history.length,
      status: 'pending',
    }),
  });
  const serial = result.serials[0];
  if (!serial) throw new Error('Failed to get serial from escalation publish');
  return serial;
}

/**
 * Update the status of an escalation message on the agent dashboard channel.
 * Uses Ably mutable messages — updateMessage preserves the original message
 * but replaces its data with the new status.
 */
export async function updateEscalationStatus(
  escalationSerial: string,
  status: 'responding' | 'resolved' | 'dismissed',
  sessionId: string
): Promise<void> {
  const realtime = getRealtimeClient();
  const channel = realtime.channels.get('ai:agent:escalations');
  await channel.updateMessage({
    serial: escalationSerial,
    data: JSON.stringify({ status, sessionId }),
  });
}
