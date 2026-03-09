import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export async function GET(request: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ABLY_API_KEY not configured' }, { status: 500 });
  }

  const clientId = request.nextUrl.searchParams.get('clientId');
  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  const [keyName, keySecret] = apiKey.split(':');

  // Agents get access to the escalations channel; customers get session channels only
  const isAgent = clientId === 'support-agent';
  const capability = isAgent
    ? {
        'ai:support:*': ['subscribe', 'history'],
        'ai:agent:escalations': ['subscribe', 'history'],
      }
    : {
        'ai:support:*': ['subscribe', 'history'],
      };

  const token = jwt.sign(
    {
      'x-ably-capability': JSON.stringify(capability),
      'x-ably-clientId': clientId,
    },
    keySecret,
    {
      expiresIn: '1h',
      keyid: keyName,
    }
  );

  return new NextResponse(token, {
    headers: { 'Content-Type': 'application/jwt' },
  });
}
