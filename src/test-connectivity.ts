#!/usr/bin/env bun
/**
 * Connectivity test for claude-peers.
 * Sends a message to a peer and verifies it arrives via poll.
 *
 * Usage:
 *   bun src/test-connectivity.ts              # auto-detect: sends to first peer that isn't self
 *   bun src/test-connectivity.ts <peer_id>    # send to specific peer
 */

import { readTokenSync, TOKEN_PATH } from "./shared/token.ts";

const BROKER_URL = `http://127.0.0.1:${process.env.CLAUDE_PEERS_PORT ?? "7899"}`;
const SELF_PID = process.pid;

async function brokerFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = readTokenSync(TOKEN_PATH);
  const res = await fetch(`${BROKER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface Peer {
  id: string;
  pid: number;
  session_name: string | null;
  summary: string;
}

interface Message {
  id: number;
  from_id: string;
  to_id: string;
  text: string;
}

async function main() {
  const targetId = process.argv[2];

  // 1. Check broker is up
  console.log("1. Checking broker...");
  let peers: Peer[];
  try {
    peers = await brokerFetch<Peer[]>("/list-peers", { scope: "machine", cwd: process.cwd() });
  } catch (e) {
    console.error("   ✗ Broker not reachable:", (e as Error).message);
    process.exit(1);
  }
  console.log(`   ✓ Broker up, ${peers.length} peer(s) registered`);

  // 2. Find target
  let target: Peer | undefined;
  if (targetId) {
    target = peers.find((p) => p.id === targetId);
    if (!target) {
      console.error(`   ✗ Peer ${targetId} not found`);
      process.exit(1);
    }
  } else {
    target = peers.find((p) => p.pid !== SELF_PID);
    if (!target) {
      console.error("   ✗ No other peers found to test with");
      process.exit(1);
    }
  }
  const label = target.session_name ? `${target.session_name} (${target.id})` : target.id;
  console.log(`   → Target: ${label}`);

  // 3. Send test message
  const testPayload = `CONNECTIVITY_TEST_${Date.now()}`;
  console.log(`2. Sending: "${testPayload}"`);
  try {
    await brokerFetch("/send-message", {
      from_id: "test-script",
      to_id: target.id,
      text: testPayload,
      type: "text",
    });
    console.log("   ✓ Message sent");
  } catch (e) {
    console.error("   ✗ Send failed:", (e as Error).message);
    process.exit(1);
  }

  // 4. Poll to verify message is in broker
  console.log("3. Polling broker for message...");
  await new Promise((r) => setTimeout(r, 500));
  try {
    const result = await brokerFetch<{ messages: Message[] }>("/poll-messages", { id: target.id });
    const found = result.messages.find((m) => m.text === testPayload);
    if (found) {
      console.log(`   ✓ Message found in broker (id: ${found.id}, delivered=0)`);
      // Ack it to clean up
      await brokerFetch("/ack-messages", { id: target.id, message_ids: [found.id] });
      console.log("   ✓ Cleaned up (acked)");
    } else {
      console.log(`   ⚠ Message not found in poll — may have been acked by poller already`);
      console.log(`     (${result.messages.length} undelivered messages found for this peer)`);
    }
  } catch (e) {
    console.error("   ✗ Poll failed:", (e as Error).message);
    process.exit(1);
  }

  console.log("\n✓ Connectivity test complete");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
