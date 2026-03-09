import { NextRequest, NextResponse } from 'next/server';
import { getTemporalClient } from '@/lib/temporal-client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const body = await request.json();
  const { action, message } = body;

  if (!action || typeof action !== 'string') {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }
  if (!['resolve', 'respond', 'handback'].includes(action)) {
    return NextResponse.json({ error: 'action must be "resolve", "respond", or "handback"' }, { status: 400 });
  }

  const workflowId = `support-${sessionId}`;
  const client = await getTemporalClient();

  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('humanAgentResponse', { action, message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to signal workflow: ${msg}` }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
