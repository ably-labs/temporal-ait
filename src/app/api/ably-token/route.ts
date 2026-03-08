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

  const token = jwt.sign(
    {
      'x-ably-capability': JSON.stringify({
        'ai:support:*': ['subscribe', 'history'],
      }),
      'x-ably-clientId': clientId,
    },
    keySecret,
    {
      expiresIn: '1h',
      keyid: keyName,
    }
  );

  return NextResponse.json(token);
}
