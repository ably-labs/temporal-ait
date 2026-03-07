import type { Message } from './workflows';

export interface LLMResult {
  type: 'text' | 'tool_use' | 'escalate';
  fullText: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  msgSerial?: string;
}

export interface Activities {
  publishUserMessage(sessionId: string, message: string): Promise<void>;
  callLLMStreaming(sessionId: string, messages: Message[], turnIndex: number): Promise<LLMResult>;
  executeToolCall(toolName: string, toolInput: Record<string, unknown>): Promise<unknown>;
  notifyHumanAgent(
    sessionId: string,
    context: { customerName: string; reason: string; history: Message[] }
  ): Promise<void>;
}

// --- Mock implementations (to be replaced in later milestones) ---

export async function publishUserMessage(sessionId: string, message: string): Promise<void> {
  console.log(`[publishUserMessage] session=${sessionId} message="${message}"`);
}

export async function callLLMStreaming(
  sessionId: string,
  messages: Message[],
  turnIndex: number
): Promise<LLMResult> {
  const lastUserMsg = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
  console.log(`[callLLMStreaming] session=${sessionId} turn=${turnIndex} lastUserMsg="${lastUserMsg}"`);

  // Mock: simulate a short delay then return canned response
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    type: 'text',
    fullText: `This is a mock response to: "${lastUserMsg}". In later milestones, this will stream real tokens from Claude via Ably.`,
  };
}

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<unknown> {
  console.log(`[executeToolCall] tool=${toolName} input=${JSON.stringify(toolInput)}`);

  // Mock tool responses
  switch (toolName) {
    case 'lookupOrder':
      return {
        orderId: toolInput.orderId,
        status: 'shipped',
        trackingNumber: 'TRK-12345-MOCK',
        estimatedDelivery: '2026-03-10',
      };
    case 'checkRefundStatus':
      return { refundId: toolInput.refundId, status: 'processing', estimatedCompletion: '3-5 business days' };
    case 'getAccountDetails':
      return { customerId: toolInput.customerId, name: 'Jane Doe', plan: 'Pro', memberSince: '2024-01' };
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

export async function notifyHumanAgent(
  sessionId: string,
  context: { customerName: string; reason: string; history: Message[] }
): Promise<void> {
  console.log(`[notifyHumanAgent] session=${sessionId} customer=${context.customerName} reason="${context.reason}"`);
}
