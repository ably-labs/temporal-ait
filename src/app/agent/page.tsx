'use client';

import { useState } from 'react';
import AblyProviderWrapper from '@/components/AblyProviderWrapper';
import AgentDashboard from '@/components/AgentDashboard';

export default function AgentPage() {
  const [connected, setConnected] = useState(false);

  if (!connected) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="flex flex-col items-center gap-6 text-center max-w-md w-full px-4">
          <div>
            <h1 className="text-3xl font-semibold">Agent Dashboard</h1>
            <p className="text-zinc-500 mt-1">
              View and respond to escalated sessions
            </p>
          </div>
          <button
            onClick={() => setConnected(true)}
            className="w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Connect as Agent
          </button>
        </main>
      </div>
    );
  }

  return (
    <AblyProviderWrapper clientId="support-agent">
      <AgentDashboard />
    </AblyProviderWrapper>
  );
}
