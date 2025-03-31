# NEAR Protocol Full-Featured MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This project implements a Model Context Protocol (MCP) server for interacting with the NEAR Protocol blockchain. It allows Large Language Models (LLMs) connected via an MCP client (like Claude Desktop) to query blockchain data and execute transactions using a pre-configured NEAR account.

**⚠️ Security Warning:** This server uses a mnemonic seed phrase stored in an environment variable (`MNEMONIC`) to derive the private key for signing transactions. This method is **NOT secure for production environments**. Use this server only for local development and testing with accounts that do not hold significant value. For production, implement a more secure key management solution (e.g., KMS, HSM, dedicated secrets manager).

## ✨ Features

This server exposes the following capabilities as MCP tools:

*   **`get_account_balance`**: Retrieve the total, staked, state-staked, and available balance for the server's configured account.
*   **`view_account_state`**: View the raw key-value state stored in a specified contract account. Supports optional base64-encoded key prefix filtering.
*   **`get_account_details`**: Get detailed information about a specified NEAR account, including balance and storage usage.
*   **`create_sub_account`**: Create a new sub-account under the server's configured account. Requires specifying the suffix, public key, and initial balance.
*   **`delete_account`**: Delete the server's configured account and transfer the remaining balance to a beneficiary. **Irreversible action!**
*   **`send_tokens`**: Transfer NEAR tokens from the server's configured account to another account.
*   **`call_function`**: Execute a change method (function call) on a specified smart contract, attaching gas and deposit if needed.
*   **`batch_actions`**: Execute multiple actions atomically within a single transaction targeting a specific receiver (or the server's account if omitted).
*   **`deploy_contract`**: Deploy a WASM smart contract to the server's configured account. Requires base64 encoded WASM bytecode.
*   **`view_function`**: Call a view-only function on a specified contract (does not change state or cost significant gas).
*   **`get_access_keys`**: List all access keys (public keys, permissions, nonce) associated with the server's configured account.
*   **`add_full_access_key`**: Add a new key with full access permission to the server's account.
*   **`add_function_call_key`**: Add a new key with limited function call permission (specific contract, methods, allowance) to the server's account.
*   **`delete_access_key`**: Delete an existing access key from the server's account.
*   **`verify_signature`**: Verify if a message signature is valid for a given public key.

## 🚀 Prerequisites

*   **Node.js:** Version 16 or higher. ([Download](https://nodejs.org/))
*   **npm** (usually comes with Node.js)
*   **A NEAR Account:** You need an existing NEAR account (e.g., on `testnet` or `mainnet`) and its **12 or 24-word mnemonic seed phrase**.
*   **NEAR Network:** Know the `networkId` you want to connect to (`testnet`, `mainnet`).
*   **(Optional) MCP Client:** An application that can connect to MCP servers, such as [Claude for Desktop](https://claude.ai/download).

## 🛠️ Installation & Setup

```bash
npm install near-mcp-server
```

1.  **Configure Environment Variables:**
    Create a `.env` file in the root of your project. **Important:** Add `.env` to your `.gitignore` file to avoid accidentally committing your secret seed phrase!

    ```dotenv
    # .env
    # Replace with your actual 12 or 24 word seed phrase (no quotes)
    MNEMONIC="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"

    # Set to 'testnet' or 'mainnet'
    NEAR_NETWORK_ID="testnet"

    # Replace with the NEAR account ID associated with the MNEMONIC
    NEAR_ACCOUNT_ID="your-account.testnet"

    # Optional: Specify a different RPC node URL if needed
    # NEAR_NODE_URL="https://rpc.testnet.near.org"
    ```

2.  **Build the Server:** Compile the TypeScript code to JavaScript.
    ```bash
    npm run build
    ```
    This creates a `build` directory with the compiled `index.js` file and makes it executable.

## 🏃 Running the Server

You can run the server in several ways:

*   **Using npm start:**
    ```bash
    npm start
    ```
*   **Directly with Node:**
    ```bash
    node build/index.js
    ```
*   **Using the binary name (if linked or installed globally):**
    ```bash
    near-mcp-server-full
    ```

The server will log connection details to stderr upon successful initialization:
`Connected to NEAR <networkId> as <accountId>`
`NEAR MCP Server running on stdio...`

Keep the terminal running while you use the server with a client. Logs and errors from the server will appear in this terminal (stderr).

## 🔌 Connecting to a Client (Example: Claude Desktop)

1.  **Find Claude Config:** Locate the Claude Desktop configuration file:
    *   **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
    *   **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
    (Create the file if it doesn't exist).

2.  **Edit Config:** Add an entry for this server under `mcpServers`. **Use the absolute path** to the compiled `build/index.js` file in your project directory.

    ```json
    {
      "mcpServers": {
        "near-protocol-server": {
          "command": "node",
          "args": [
            "/path/to/your/project/near-mcp-server/build/index.js"
          ]
          // Optional: Pass environment variables directly if needed
          // "env": {
          //   "MNEMONIC": "...",
          //   "NEAR_NETWORK_ID": "testnet",
          //   "NEAR_ACCOUNT_ID": "your-account.testnet"
          // }
        }
      }
    }
    ```

3.  **Restart Claude:** Save the configuration file and completely restart the Claude Desktop application.

4.  **Verify Connection:** Look for the hammer icon in the chat input area. Clicking it should list the NEAR tools defined in this server.

## 💬 Usage Examples (with Claude Desktop)

Once connected, you can ask Claude to use the NEAR tools:

*   `What's the balance of my account ({{NEAR_ACCOUNT_ID}})?`
*   `Get the account details for vitalik.near`
*   `View the state for contract guest-book.testnet`
*   `Send 0.1 NEAR from my account to friend.testnet`
*   `Call the 'add_message' function on 'guest-book.testnet' with arguments {"text": "Hello from MCP!"}`
*   `Deploy this contract (provide base64 WASM) to my account`
*   `Create a subaccount 'mysub' under my account with public key 'ed25519:...' and fund it with 0.5 NEAR`
*   `Show me all access keys for my account`
*   `Add a full access key 'ed25519:...' to my account`
*   `Delete the access key 'ed25519:...' from my account`
*   `Delete my account {{NEAR_ACCOUNT_ID}} and send the funds to 'beneficiary.testnet'` (**Use with extreme caution!**)
*   `Verify the message "test message" against signature "base64..." using public key "ed25519:..."`
*   `Execute these actions in a batch for my account: transfer 0.1 NEAR to bob.testnet, then call method 'increase' on counter.testnet`

Claude will identify the appropriate tool and ask for your confirmation before executing any transaction that modifies state or spends funds.

## 🔒 Security Considerations

*   **Private Key (Mnemonic):** Storing your seed phrase in `.env` is **insecure** for anything beyond local testing. Do not use this method for accounts holding real value. Explore hardware wallets, secure enclave solutions, or KMS for production use cases. Ensure your `.env` file is in `.gitignore`.
*   **Tool Permissions:** This server grants powerful capabilities to the connected LLM client. Be mindful of which clients you connect it to, especially tools like `delete_account`, `add_full_access_key`, and `deploy_contract`.
*   **Input Sanitization:** While Zod provides basic type validation, ensure any user/LLM-provided input used in sensitive operations (like contract calls or file paths if extended) is properly sanitized.
*   **Rate Limiting:** For a production server, consider adding rate limiting to prevent abuse.

## 🧪 Development

```bash
# Build the TypeScript code
npm run build

# Check TypeScript errors
npm run check-index

# Run in development mode (build + start)
npm run dev
```

## 🔧 Troubleshooting

*   **Server Not Starting:** Check for errors in the terminal where you ran `npm start`. Ensure all environment variables in `.env` are correctly set. Make sure Node.js v16+ is installed.
*   **Not Appearing in Client (Claude):**
    *   Double-check the `claude_desktop_config.json` syntax.
    *   Verify the **absolute path** to `build/index.js` is correct.
    *   Restart Claude Desktop completely.
    *   Check Claude's MCP logs.
*   **Tool Errors:** Check the server's terminal output (stderr) for specific error messages from `near-api-js` or the NEAR network. Common issues include insufficient balance, incorrect account IDs, or network problems.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request if you have suggestions or improvements.

## 📜 License

[MIT](./LICENSE)
