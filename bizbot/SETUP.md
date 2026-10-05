# BizBot setup on Conway Cloud

Answers for the automaton setup wizard, chosen for a **$10 test run**.

## 1. Before you start (one time)

1. **Create your own wallet.** Install Coinbase Wallet or MetaMask, create a wallet and write the
   recovery phrase on paper. Never share it or paste it anywhere, including into the automaton or a chat.
2. **Get USDC on Base.** Buy about $12 of USDC and make sure it's on the **Base** network
   (Coinbase lets you withdraw USDC to Base directly). The extra $2 covers mistakes and fees.
3. Copy your wallet's public address (starts with `0x`). You'll need it for the wizard.

## 2. Create the Conway sandbox

1. Go to https://app.conway.tech, sign in and create a Linux sandbox (the smallest size is enough).
2. Open its terminal and run:

   ```bash
   curl -fsSL https://conway.tech/automaton.sh | sh
   ```

   This installs Automaton, builds it and starts the setup wizard.

## 3. Wizard answers

| Wizard question | Answer |
|---|---|
| Chain type | press Enter (`evm`) |
| Conway API key | provisioned automatically; if it fails, create one in the Conway dashboard |
| Name | `BizBot` |
| Genesis prompt | paste the contents of `genesis-prompt.txt` |
| Creator wallet address | **your** `0x...` address from step 1 |
| OpenAI / Anthropic / Ollama | press Enter to skip (inference is billed through Conway) |
| Max single transfer (cents) | `200` |
| Max hourly transfers (cents) | `300` |
| Max daily transfers (cents) | `500` |
| Minimum reserve (cents) | `200` |
| Max x402 payment (cents) | `50` |
| Max daily inference spend (cents) | `300` |
| Require confirmation above (cents) | `100` |

The default minimum reserve is $10, which would block every transfer with only $10 in the wallet,
so it's lowered to $2 here.

## 4. Fund it

At the end, the wizard prints **BizBot's** wallet address (not yours). Send **$10 USDC on Base**
to that address. On startup it automatically buys $5 of Conway credits from the USDC.

## 5. Check on it

```bash
node packages/cli/dist/index.js status
node packages/cli/dist/index.js logs --tail 50
cat ~/.automaton/REVENUE.md   # if BizBot followed the genesis prompt
```

Check daily for the first week. If it's only spending, stop it rather than adding money.

## 6. Back up the wallet

Download `~/.automaton/wallet.json` from the sandbox and keep it somewhere safe. It's BizBot's private
key. If the sandbox is deleted without a backup, any money in BizBot's wallet is lost.
