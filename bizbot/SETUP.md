# BizBot setup on Conway Cloud

Answers for the automaton setup wizard, chosen for a **$10 test run**.

## 1. Before you start (one time)

1. **Create your own wallet.** Install Coinbase Wallet or MetaMask, create a wallet and write the
   recovery phrase on paper. Never share it or paste it anywhere, including into the automaton or a chat.
2. **Get USDC on Base.** Buy about $12 of USDC and make sure it's on the **Base** network
   (Coinbase lets you withdraw USDC to Base directly). The extra $2 covers mistakes and fees.
3. Your wallet address `0xc89cC7D72Fa1CA6d50E6B2D60871E660c3509a30` is already filled in below.

## 2. Create the Conway sandbox and set up BizBot (answers filled in for you)

1. Go to https://app.conway.tech, sign in and create a Linux sandbox (the smallest size is enough).
2. Open its terminal and paste this whole block:

   ```bash
   corepack enable pnpm 2>/dev/null || npm i -g pnpm
   git clone -b claude/new-session-ap7s9g https://github.com/REB1236/Business-automate.git ~/bizbot
   cd ~/bizbot && pnpm install && pnpm build
   node bizbot/setup-bizbot.mjs
   ```

   `setup-bizbot.mjs` answers every setup question for you, using the table below, and prints
   BizBot's wallet address at the end.
3. Start BizBot so it keeps running after you close the terminal:

   ```bash
   cd ~/bizbot && nohup node dist/index.js --run > ~/bizbot.log 2>&1 &
   ```

## 3. The answers the script gives

| Wizard question | Answer |
|---|---|
| Chain type | `evm` |
| Conway API key | provisioned automatically; left blank if that fails (create one in the Conway dashboard) |
| Name | `BizBot` |
| Genesis prompt | the contents of `genesis-prompt.txt` |
| Creator wallet address | `0xc89cC7D72Fa1CA6d50E6B2D60871E660c3509a30` |
| OpenAI / Anthropic / Ollama | blank (inference is billed through Conway) |
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
tail -50 ~/bizbot.log
node packages/cli/dist/index.js status
node packages/cli/dist/index.js logs --tail 50
cat ~/.automaton/REVENUE.md   # if BizBot followed the genesis prompt
```

Check daily for the first week. If it's only spending, stop it rather than adding money.

## 6. Back up the wallet

Download `~/.automaton/wallet.json` from the sandbox and keep it somewhere safe. It's BizBot's private
key. If the sandbox is deleted without a backup, any money in BizBot's wallet is lost.
