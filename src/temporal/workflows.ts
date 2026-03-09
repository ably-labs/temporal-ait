import { proxyActivities, setHandler, condition, defineSignal } from '@temporalio/workflow';
import type { Activities } from './activities';

// Signal definitions
export const userMessage = defineSignal<[string, string]>('userMessage');
export const humanAgentResponse = defineSignal<[{ action: string; message?: string }]>('humanAgentResponse');


export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolUseId?: string;
  // Raw Anthropic content blocks for assistant messages with tool_use
  // Needed so the follow-up API call includes the tool_use block
  rawContentBlocks?: unknown[];
}

const activities = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
  },
});

export async function supportSessionWorkflow(
  sessionId: string,
  customerName: string
): Promise<void> {
  const messages: Message[] = [];
  let pendingUserMessage: { text: string; messageId: string } | null = null;
  // Type-widened to string so TS doesn't incorrectly narrow after signal handler mutations.
  // Signal handlers (setHandler) mutate status asynchronously, which TS control-flow analysis can't track.
  let status = 'active' as 'active' | 'escalated' | 'resolved';
  let humanDecision: { action: string; message?: string } | null = null;

  // Signal handlers
  setHandler(userMessage, (msg: string, messageId: string) => {
    pendingUserMessage = { text: msg, messageId };
  });

  setHandler(humanAgentResponse, (decision) => {
    humanDecision = decision;
  });


  let turnIndex = 0;

  while (status !== 'resolved') {
    // Durable wait — zero compute, survives crashes
    await condition(() => pendingUserMessage !== null);

    const { text: userMsg, messageId } = pendingUserMessage!;
    pendingUserMessage = null;

    messages.push({ role: 'user', content: userMsg });

    // Publish user message to Ably channel on behalf of the customer
    await activities.publishUserMessage(sessionId, userMsg, customerName, messageId);

    // If escalated, forward customer messages to the human agent — don't call AI
    if (status === 'escalated') {
      // Notify the agent dashboard that the customer sent a new message
      await activities.notifyHumanAgent(sessionId, {
        customerName,
        reason: `Customer sent a follow-up message: "${userMsg}"`,
        history: messages,
      });
      continue;
    }

    // Call LLM (streaming tokens to Ably inside the activity)
    const llmResult = await activities.callLLMStreaming(sessionId, messages, turnIndex);
    turnIndex++;

    messages.push({
      role: 'assistant',
      content: llmResult.fullText,
      rawContentBlocks: llmResult.rawContentBlocks,
    });

    if (llmResult.type === 'tool_use') {
      const toolResult = await activities.executeToolCall(
        sessionId,
        llmResult.toolName!,
        llmResult.toolInput!
      );
      messages.push({
        role: 'tool',
        content: JSON.stringify(toolResult),
        toolName: llmResult.toolName,
        toolUseId: llmResult.toolUseId,
      });

      // Follow-up LLM call with tool results
      const followUp = await activities.callLLMStreaming(sessionId, messages, turnIndex);
      turnIndex++;
      messages.push({ role: 'assistant', content: followUp.fullText });
    } else if (llmResult.type === 'escalate') {
      status = 'escalated';

      // The activity already replaced the raw [ESCALATE:...] text with a friendly
      // message before the completion signal, so the customer never sees the raw text.

      // Publish escalation banner to the session channel
      await activities.publishEscalation(
        sessionId,
        "You have been connected to our support team. A human agent will be with you shortly."
      );

      // Notify the agent dashboard — returns the message serial for later status updates
      const escalationSerial = await activities.notifyHumanAgent(sessionId, {
        customerName,
        reason: llmResult.fullText,
        history: messages,
      });

      // Durable HITL wait — can last hours/days, zero compute
      // Wait for either a human decision OR a new customer message (to forward)
      let agentHasJoined = false;

      while (status === 'escalated') {
        await condition(() => humanDecision !== null || pendingUserMessage !== null);

        // If human agent responded, handle it
        if (humanDecision !== null) {
          const decision = humanDecision as { action: string; message?: string };
          humanDecision = null;

          // First human response — tell the customer the agent is here
          if (!agentHasJoined) {
            agentHasJoined = true;
            await activities.updateEscalationStatus(escalationSerial, 'responding', sessionId);
            await activities.publishEscalation(
              sessionId,
              'A support agent has joined the conversation. You can now communicate with them directly.'
            );
          }

          if (decision.message) {
            // Publish the human agent's message as an agent response (not user)
            await activities.publishAgentMessage(
              sessionId,
              decision.message,
              `agent_${sessionId}_${turnIndex}`
            );
            turnIndex++;
            messages.push({ role: 'assistant', content: decision.message });
          }

          if (decision.action === 'resolve') {
            status = 'resolved';
            await activities.updateEscalationStatus(escalationSerial, 'resolved', sessionId);
            // Notify the customer that the session is resolved
            await activities.publishEscalation(
              sessionId,
              'This conversation has been resolved by our support team. Thank you for contacting us!'
            );
          } else if (decision.action === 'handback') {
            status = 'active';
            await activities.publishEscalation(
              sessionId,
              'You have been reconnected to our AI assistant. How can we help you further?'
            );
          }
          // 'respond' keeps status as 'escalated' — human stays in control
        }

        // If customer sent a message while escalated, just publish it (already done above)
        if (pendingUserMessage !== null) {
          const { text: msg, messageId: msgId } = pendingUserMessage;
          pendingUserMessage = null;
          messages.push({ role: 'user', content: msg });
          await activities.publishUserMessage(sessionId, msg, customerName, msgId);
        }
      }
    }
  }
}
