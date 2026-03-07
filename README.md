# Customer Support Copilot Demo

**Ably AI Transport (Durable Sessions) + Temporal (Durable Execution)**

A customer support copilot demonstrating how Durable Execution and Durable Sessions work as complementary layers for production AI experiences.

## Prerequisites

- Node.js 22+
- [Temporal CLI](https://docs.temporal.io/cli) (for local dev server)
- Ably account (API key)
- Anthropic API key

## Setup

```bash
npm install
cp .env.local.example .env.local
# Fill in your API keys in .env.local
```

## Development

```bash
# Terminal 1: Start Temporal local dev server
temporal server start-dev

# Terminal 2: Start the Temporal worker
npm run worker

# Terminal 3: Start the Next.js dev server
npm run dev
```

## Architecture

See `.working/ably-temporal-customer-support-copilot-demo.md` for the full design document.
