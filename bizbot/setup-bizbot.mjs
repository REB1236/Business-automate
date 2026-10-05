#!/usr/bin/env node
// Answers the automaton setup wizard with BizBot's settings.
// Run from the automaton folder after building:  node bizbot/setup-bizbot.mjs
// Then start the agent with:                    node dist/index.js --run

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const CREATOR_ADDRESS = "0xc89cC7D72Fa1CA6d50E6B2D60871E660c3509a30";
const genesisLines = fs
  .readFileSync(path.join(here, "genesis-prompt.txt"), "utf8")
  .trimEnd()
  .split("\n");

// Prompt text the wizard prints → answer. Order matters only for duplicates.
const answers = [
  ["Chain type", "evm"],
  ["Conway API key", ""], // only asked if automatic provisioning fails
  ["name your automaton", "BizBot"],
  ["Creator wallet address", CREATOR_ADDRESS],
  ["OpenAI API key", ""],
  ["Anthropic API key", ""],
  ["Ollama base URL", ""],
  ["Max single transfer", "200"],
  ["Max hourly transfers", "300"],
  ["Max daily transfers", "500"],
  ["Minimum reserve", "200"],
  ["Max x402 payment", "50"],
  ["Max daily inference", "300"],
  ["Require confirmation above", "100"],
];

const child = spawn(process.execPath, [path.join(root, "dist/index.js"), "--setup"], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
let genesisQueue = null; // lines still to send for the genesis prompt

const send = (text) => child.stdin.write(text + "\n");

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  buffer += text;

  const marker = "press Enter twice to finish:";
  if (!genesisQueue && buffer.includes(marker)) {
    buffer = buffer.slice(buffer.indexOf(marker) + marker.length);
    genesisQueue = [...genesisLines, "", ""]; // two empty lines end the prompt
  }

  if (genesisQueue) {
    // Each genesis line is its own prompt ("  "); answer one per prompt.
    if (buffer.endsWith("  ")) {
      buffer = "";
      send(genesisQueue.shift());
      if (!genesisQueue.length) genesisQueue = null;
    }
    return;
  }

  for (let i = 0; i < answers.length; i++) {
    const [label, value] = answers[i];
    if (buffer.includes(label) && /: $|\]: $/.test(buffer)) {
      answers.splice(i, 1);
      buffer = "";
      send(value);
      return;
    }
  }
});

child.on("exit", (code) => {
  if (code === 0) {
    const home = process.env.HOME || "";
    const config = JSON.parse(fs.readFileSync(path.join(home, ".automaton/automaton.json"), "utf8"));
    console.log(`\nBizBot's wallet address (send the $10 USDC on Base here):\n  ${config.walletAddress}`);
    console.log("\nBizBot is configured. Start it with:  node dist/index.js --run");
  } else {
    console.error(`\nSetup exited with code ${code}.`);
  }
  process.exit(code ?? 1);
});
