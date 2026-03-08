import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getTemporalClient, TASK_QUEUE } from '@/lib/temporal-client';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const customerName = body.customerName;

  if (!customerName || typeof customerName !== 'string') {
    return NextResponse.json({ error: 'customerName is required' }, { status: 400 });
  }

  const sessionId = randomUUID();
  const workflowId = `support-${sessionId}`;

  const client = await getTemporalClient();
  await client.workflow.start('supportSessionWorkflow', {
    args: [sessionId, customerName],
    taskQueue: TASK_QUEUE,
    workflowId,
  });

  return NextResponse.json({ sessionId, workflowId });
}
