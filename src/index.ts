#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  connect,
  keyStores,
  utils,
  transactions,
  KeyPair,
  providers,
  Account,
  Near,
  ConnectConfig,
  WalletConnection,
} from "near-api-js";
import { parseSeedPhrase } from 'near-seed-phrase';
import * as dotenv from 'dotenv';
import { Buffer } from 'buffer';
import { PublicKey } from "near-api-js/lib/utils/key_pair.js";

// --- Environment Setup ---
dotenv.config(); // Load environment variables from .env file

const {
  MNEMONIC,
  NEAR_NETWORK_ID,
  NEAR_NODE_URL
} = process.env;

if (!MNEMONIC) {
  console.error("Error: MNEMONIC environment variable is not set.");
  process.exit(1);
}
if (!NEAR_NETWORK_ID) {
  console.error("Error: NEAR_NETWORK_ID environment variable is not set (e.g., 'testnet' or 'mainnet').");
  process.exit(1);
}

const DEFAULT_NODE_URL = NEAR_NETWORK_ID === 'mainnet'
  ? 'https://rpc.mainnet.near.org'
  : 'https://rpc.testnet.near.org';

const NODE_URL = NEAR_NODE_URL || DEFAULT_NODE_URL;

// --- NEAR Connection and Account Setup ---
let nearConnection: Near | null = null;
let nearAccount: Account | null = null;
let nearProvider: providers.Provider | null = null;
let nearWallet: WalletConnection | null = null;
let nearAccountId: string | null = null;

async function setupNear() {
  if (nearAccount && nearProvider) return; // Already initialized

  try {
    const { secretKey } = parseSeedPhrase(MNEMONIC as string);
    const keyPair = KeyPair.fromString(secretKey as any);
    const implicitAccountId = Buffer.from(keyPair.getPublicKey().data).toString("hex");
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(NEAR_NETWORK_ID, implicitAccountId, keyPair);

    const config: ConnectConfig = {
      // @ts-ignore - Assuming NEAR_NETWORK_ID is validated elsewhere or accepting potential runtime issues if not 'testnet' or 'mainnet'
      networkId: NEAR_NETWORK_ID, // Removed 'as "testnet" | "mainnet"' as @ts-ignore handles the type check suppression
      keyStore: keyStore,
      nodeUrl: NODE_URL,
    };

    nearConnection = await connect(config);
    nearWallet = new WalletConnection(nearConnection, implicitAccountId);
    nearConnection.connection.signer = nearWallet._keyStore; // Set the signer to the wallet's key store
    nearConnection.connection.networkId = NEAR_NETWORK_ID; // Set the network ID for the connection
    nearAccountId = nearWallet.getAccountId();
    nearAccount = await nearConnection.account(nearAccountId);
    nearProvider = nearConnection.connection.provider;
    console.error(`Connected to NEAR ${NEAR_NETWORK_ID} as ${nearAccountId}`);
  } catch (error) {
    console.error("Failed to initialize NEAR connection:", error);
    process.exit(1);
  }
}

function getAccount(): Account {
  if (!nearAccount) throw new Error("NEAR Account not initialized");
  return nearAccount;
}

function getProvider(): providers.Provider {
  if (!nearProvider) throw new Error("NEAR Provider not initialized");
  return nearProvider;
}

// --- MCP Server Setup ---
const server = new McpServer({
  name: "near-protocol-server",
  version: "1.1.0", // Version bump
});

// --- Helper Functions ---
function parseNear(amountString: string): string {
  try {
    return utils.format.parseNearAmount(amountString) || '0';
  } catch (e) {
    console.error(`Invalid NEAR amount format: ${amountString}`, e);
    throw new Error(`Invalid NEAR amount format: "${amountString}". Use a decimal number like "0.5".`);
  }
}

function formatNear(yoctoString: string): string {
  try {
    return utils.format.formatNearAmount(yoctoString, 5); // Format with 5 decimal places
  } catch (e) {
    return yoctoString; // Return original if formatting fails
  }
}

function encodeArgs(args: any): Buffer {
  try {
    return Buffer.from(JSON.stringify(args));
  } catch (e: unknown) {
    const error = e as Error;
    throw new Error(`Failed to encode arguments: ${error.message || 'Unknown error'}`);
  }
}

function decodeBase64(value: string): Buffer {
  try {
    return Buffer.from(value, 'base64');
  } catch (e) {
    throw new Error(`Invalid base64 string: ${value}`);
  }
}

function base64ByteLength(str: string): number {
    // Calculates the byte length of a base64 encoded string.
    const len = str.length;
    if (len === 0) return 0;
    let padding = 0;
    if (str.endsWith('==')) {
        padding = 2;
    } else if (str.endsWith('=')) {
        padding = 1;
    }
    return (len * 3 / 4) - padding;
}

// --- Prompt Implementations ---

// 1. Check Own Balance
server.prompt(
  "check_my_balance",
  "Get the current balance details of the configured NEAR account.",
  {}, // No input arguments needed for this specific prompt
  async () => {
    // This prompt doesn't need arguments, it implies using the server's account
    // The message generated is what the LLM will receive to understand the user's intent.
    // It will then likely call the get_account_balance tool for nearAccountId.
    if (!nearAccountId) await setupNear(); // Ensure account ID is loaded
    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `What is the current balance breakdown for my account (${nearAccountId})? Please use the get_account_balance tool.`
        }
      }]
    };
  }
);

// --- Tool Implementations ---

// 1. Get Balance
server.tool(
  "get_account_balance",
  "Get the balance of a specific NEAR account.",
  {
    accountId: z.string().describe("The NEAR account ID (e.g., example.testnet)"),
  },
  async ({ accountId }) => {
    console.error(`Tool: get_account_balance called for ${accountId}`);
    try {
      await setupNear(); // Ensure connection is ready
      const balance = await getAccount().getAccountBalance(); // Use pre-configured account for simplicity or allow target account ID

      return {
        content: [{
          type: "text",
          text: `Balance for ${accountId}:\n` +
                `  Total: ${formatNear(balance.total)} NEAR\n` +
                `  Staked: ${formatNear(balance.staked)} NEAR\n` +
                `  State Staked: ${formatNear(balance.stateStaked)} NEAR\n` +
                `  Available: ${formatNear(balance.available)} NEAR`
        }],
      };
    } catch (error: any) {
      console.error(`Error fetching balance for ${accountId}:`, error);
      let errorMessage = `Failed to fetch balance for ${accountId}.`;
      if (error.type === 'AccountDoesNotExist') {
        errorMessage = `Account ${accountId} does not exist on ${NEAR_NETWORK_ID}.`;
      } else if (error.message) {
        errorMessage += ` Reason: ${error.message}`;
      }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    }
  }
);

// 2. Get State (Refined)
server.tool(
  "view_account_state",
  "View the raw key-value state stored in a NEAR account's contract. Prefix is expected in base64.",
  {
    accountId: z.string().describe("The NEAR account ID of the contract (e.g., guest-book.testnet)"),
    prefix_base64: z.string().optional().describe("Base64 encoded prefix for the keys to view (optional, default views all state). Empty string for no prefix."),
  },
  async ({ accountId, prefix_base64 = "" }) => {
    console.error(`Tool: view_account_state called for ${accountId} with base64 prefix "${prefix_base64}"`);
    try {
      await setupNear();
      const response = await getProvider().query({
        request_type: "view_state",
        finality: "optimistic",
        account_id: accountId,
        prefix_base64: prefix_base64, // Provider expects base64
      });

      const values = (response as any).values;
      if (!values || values.length === 0) {
        return {
          content: [{
            type: "text",
            text: `Account ${accountId} has no contract state${prefix_base64 ? ` matching the prefix` : ''}. It might not have a contract deployed.`,
          }],
        };
      }

      // Decode keys and values from base64
      const decodedState = (response as any).values.map(({ key, value }: { key: string, value: string }) => {
          let decodedKey : string;
          let decodedValue: string;
          try {
              decodedKey = Buffer.from(key, 'base64').toString('utf-8');
          } catch(e){
              decodedKey = `[Binary Data: ${key}]`; // fallback for non-utf8 keys
          }
           try {
              decodedValue = Buffer.from(value, 'base64').toString('utf-8');
          } catch(e){
              decodedValue = `[Binary Data: ${value}]`; // fallback for non-utf8 values
          }
          return { key: decodedKey, value: decodedValue };
      });

      // Format for better readability
      const formattedState = decodedState.map((item: {key: string, value: string}) => `  Key: ${item.key}\n  Value: ${item.value}`).join('\n---\n');
      const prefixText = prefix_base64 ? ` (prefix base64: "${prefix_base64}")` : '';

      return {
        content: [{
          type: "text",
          text: `Contract state for ${accountId}${prefixText}:\n${formattedState}`,
        }],
      };

    } catch (error: any) {
      console.error(`Error fetching state for ${accountId}:`, error);
      let errorMessage = `Failed to fetch state for ${accountId}.`;
       if (error.type === 'AccountDoesNotExist') {
        errorMessage = `Account ${accountId} does not exist on ${NEAR_NETWORK_ID}.`;
      } else if (error.type === 'CONTRACT_CODE_NOT_FOUND' || (error.cause && error.cause.name === 'CONTRACT_CODE_NOT_FOUND')) {
        errorMessage = `Account ${accountId} does not have a contract deployed.`;
      } else if (error.message) {
        errorMessage += ` Reason: ${error.message}`;
      }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    }
  }
);

// 3. Get Details
server.tool(
  "get_account_details",
  "Get detailed information about a NEAR account, including balance and storage usage.",
  {
    accountId: z.string().describe("The NEAR account ID (e.g., example.testnet)"),
  },
  async ({ accountId }) => {
    console.error(`Tool: get_account_details called for ${accountId}`);
    try {
      await setupNear();
      // Use the provider directly for view_account as it might be a different account
      const state = await getProvider().query({
        request_type: "view_account",
        finality: "optimistic",
        account_id: accountId,
      });

      // Note: getAccountBalance() might be more comprehensive for the *server's* account,
      // but for an arbitrary account, we use the state directly.
      return {
        content: [{
          type: "text",
          text: `Account details for ${accountId}:\n` +
                `  Amount (Balance): ${formatNear((state as any).amount)} NEAR\n` +
                `  Locked (Staked): ${formatNear((state as any).locked)} NEAR\n` +
                `  Storage Usage: ${(state as any).storage_usage} bytes\n` +
                `  Code Hash: ${(state as any).code_hash}`
        }],
      };
    } catch (error: any) {
      console.error(`Error fetching details for ${accountId}:`, error);
      let errorMessage = `Failed to fetch details for ${accountId}.`;
      if (error.type === 'AccountDoesNotExist') {
        errorMessage = `Account ${accountId} does not exist on ${NEAR_NETWORK_ID}.`;
      } else if (error.message) {
        errorMessage += ` Reason: ${error.message}`;
      }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    }
  }
);

// 4. Create Sub-Account
server.tool(
  "create_sub_account",
  "Create a new sub-account under the server's configured account.",
  {
    newAccountIdSuffix: z.string().describe("The suffix for the new sub-account (e.g., 'sub'). The full ID will be 'suffix.your-account.testnet'."),
    newAccountPublicKey: z.string().describe("The base58 encoded public key for the new account."),
    initialBalanceNear: z.string().describe("The initial balance in NEAR to fund the new account (e.g., '0.1')."),
  },
  async ({ newAccountIdSuffix, newAccountPublicKey, initialBalanceNear }) => {
    const newAccountId = `${newAccountIdSuffix}.${nearAccountId}`;
    console.error(`Tool: create_sub_account called for ${newAccountId}`);
    try {
      await setupNear();
      const publicKey = PublicKey.fromString(newAccountPublicKey);
      const amountYocto = parseNear(initialBalanceNear);

      const result = await getAccount().createAccount(newAccountId, publicKey, BigInt(amountYocto));

      return {
        content: [{
          type: "text",
          text: `Successfully created sub-account ${newAccountId} with initial balance ${initialBalanceNear} NEAR. Transaction hash: ${result.transaction.hash}`,
        }],
      };
    } catch (error: any) {
      console.error(`Error creating sub-account ${newAccountId}:`, error);
      let errorMessage = `Failed to create sub-account ${newAccountId}.`;
      if (error.type === 'AccountAlreadyExists') {
        errorMessage = `Account ${newAccountId} already exists.`;
      } else if (error.type === 'CreateAccountNotAllowed') {
        errorMessage += ` Check if the suffix '${newAccountIdSuffix}' is valid and doesn't conflict with existing implicit accounts.`
      } else if (error.message) {
        errorMessage += ` Reason: ${error.message}`;
      }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    }
  }
);

// 5. Delete Account
server.tool(
  "delete_account",
  "Delete the server's configured account and transfer remaining balance. WARNING: This is irreversible!",
  {
    beneficiaryId: z.string().describe("The NEAR account ID to receive the remaining balance."),
  },
  async ({ beneficiaryId }) => {
    console.error(`Tool: delete_account called for ${nearAccountId}, beneficiary: ${beneficiaryId}`);
    try {
      await setupNear();
      const result = await getAccount().deleteAccount(beneficiaryId);
      return {
        content: [{
          type: "text",
          text: `Successfully submitted request to delete account ${nearAccountId} and transfer remaining balance to ${beneficiaryId}. Transaction hash: ${result.transaction.hash}`,
        }],
      };
    } catch (error: any) {
      console.error(`Error deleting account ${nearAccountId}:`, error);
      let errorMessage = `Failed to delete account ${nearAccountId}.`;
       if (error.type === 'DeleteAccountHasEnoughBalance' || error.type === 'DeleteAccountHasRent') {
           errorMessage = `Account ${nearAccountId} cannot be deleted because it still has enough balance to cover storage. Ensure the balance is near zero.`
       } else if (error.type === 'AccountDoesNotExist') {
        errorMessage = `Account ${beneficiaryId} (beneficiary) does not exist on ${NEAR_NETWORK_ID}.`;
      } else if (error.message) {
        errorMessage += ` Reason: ${error.message}`;
      }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    }
  }
);

// 6. Send Tokens
server.tool(
  "send_tokens",
  "Send NEAR tokens from the server's configured account to another account.",
  {
    receiverId: z.string().describe("The NEAR account ID receiving the tokens."),
    amountNear: z.string().describe("The amount of NEAR to send (e.g., '1.5')."),
  },
  async ({ receiverId, amountNear }) => {
    console.error(`Tool: send_tokens called: ${amountNear} NEAR to ${receiverId}`);
    try {
      await setupNear();
      const amountYocto = parseNear(amountNear);
      const result = await getAccount().sendMoney(receiverId, BigInt(amountYocto));
      return {
        content: [{
          type: "text",
          text: `Successfully sent ${amountNear} NEAR to ${receiverId}. Transaction hash: ${result.transaction.hash}`,
        }],
      };
    } catch (error: any) {
      console.error(`Error sending tokens to ${receiverId}:`, error);
      let errorMessage = `Failed to send ${amountNear} NEAR to ${receiverId}.`;
      if (error.type === 'AccountDoesNotExist') {
        errorMessage = `Account ${receiverId} does not exist on ${NEAR_NETWORK_ID}.`;
      } else if (error.type === 'NotEnoughBalance') {
          errorMessage = `Account ${nearAccountId} does not have enough balance to send ${amountNear} NEAR and cover gas fees.`;
      } else if (error.message) {
        errorMessage += ` Reason: ${error.message}`;
      }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    }
  }
);

// 7. Call Function (Change Method)
server.tool(
  "call_function",
  "Call a function (change method) on a specified contract.",
  {
    contractId: z.string().describe("The NEAR account ID of the contract."),
    methodName: z.string().describe("The name of the function to call."),
    args: z.record(z.unknown()).optional().describe("Arguments for the function call as a JSON object (default: {})."),
    gasTeras: z.string().optional().describe("Amount of Gas (in TeraGas, TGas) to attach (e.g., '30'). Default: 30 TGas."),
    attachedDepositNear: z.string().optional().describe("Amount of NEAR to attach as deposit (e.g., '0.1'). Default: 0 NEAR."),
  },
  async ({ contractId, methodName, args = {}, gasTeras = "30", attachedDepositNear = "0" }) => {
    console.error(`Tool: call_function called: ${contractId}.${methodName}(${JSON.stringify(args)})`);
    try {
      await setupNear();
      const gas = BigInt(gasTeras) * BigInt(10**12);
      const amountYocto = parseNear(attachedDepositNear);

      const result = await getAccount().functionCall({
          contractId,
          methodName,
          args,
          gas: gas,
          attachedDeposit: BigInt(amountYocto)
      });

      let resultValue = "void";
      try {
        const status = result.status as any;
        const successValue = status?.SuccessValue;
        if (successValue) {
            resultValue = Buffer.from(successValue, 'base64').toString();
             // Try parsing as JSON, fallback to raw string
            try { resultValue = JSON.parse(resultValue); } catch(e) { /* ignore */ }
        }
      } catch (e) {
         console.error("Error processing function call result:", e);
      }

      return {
        content: [{
          type: "text",
          text: `Successfully called ${methodName} on ${contractId}. Result: ${typeof resultValue === 'object' ? JSON.stringify(resultValue, null, 2) : resultValue}. Transaction hash: ${result.transaction.hash}`,
        }],
      };
    } catch (error: any) {
      console.error(`Error calling function ${contractId}.${methodName}:`, error);
      let errorMessage = `Failed to call function ${methodName} on ${contractId}.`;
      if (error.type === 'AccountDoesNotExist') {
        errorMessage = `Contract account ${contractId} does not exist on ${NEAR_NETWORK_ID}.`;
      } else if (error.type === 'MethodNotFound' || (error.cause && error.cause.name === 'METHOD_NOT_FOUND')) {
          errorMessage = `Method "${methodName}" not found on contract ${contractId}.`;
      } else if (error.message) {
        errorMessage += ` Reason: ${error.message}`;
      }
      // Potentially include specific contract panic messages if available
       if (error.kind && error.kind.ExecutionError) {
           errorMessage += ` Contract Error: ${error.kind.ExecutionError}`;
       }
      return { isError: true, content: [{ type: "text", text: errorMessage }] };
    }
  }
);

// 8. Batch Actions
const actionSchema = z.union([
    z.object({ type: z.literal('CreateAccount') }),
    z.object({ type: z.literal('DeployContract'), wasmBase64: z.string().describe("Base64 encoded WASM contract code.") }),
    z.object({ type: z.literal('FunctionCall'), contractId: z.string(), methodName: z.string(), args: z.record(z.unknown()).optional(), gasTeras: z.string().optional(), depositNear: z.string().optional() }),
    z.object({ type: z.literal('Transfer'), depositNear: z.string() }),
    z.object({ type: z.literal('Stake'), stakeYocto: z.string(), publicKey: z.string() }),
    z.object({ type: z.literal('AddKey'), publicKey: z.string(), accessKey: z.object({ nonce: z.number().int().optional(), permission: z.union([ z.literal('FullAccess'), z.object({ receiverId: z.string(), methodNames: z.array(z.string()), allowanceNear: z.string().optional() }) ]) }) }),
    z.object({ type: z.literal('DeleteKey'), publicKey: z.string() }),
    z.object({ type: z.literal('DeleteAccount'), beneficiaryId: z.string() })
]);

server.tool(
    "batch_actions",
    "Execute multiple NEAR actions atomically within a single transaction. Actions are executed in the specified order.",
    {
        receiverId: z.string().optional().describe("The primary receiver account ID for the transaction. If omitted, the server's account ID is used. Most actions define their own specific target."),
        actions: z.array(actionSchema).min(1).describe("An array of action objects to execute in sequence.")
    },
    async ({ receiverId, actions }) => {
        const targetReceiverId = receiverId || nearAccountId;
        console.error(`Tool: batch_actions called for receiver ${targetReceiverId} with ${actions.length} actions`);
        try {
            await setupNear();
            const nearActions = actions.map(actionDef => {
                switch (actionDef.type) {
                    case 'CreateAccount':
                        return transactions.createAccount();
                    case 'DeployContract':
                        return transactions.deployContract(decodeBase64(actionDef.wasmBase64));
                    case 'FunctionCall':
                        const args = actionDef.args ? encodeArgs(actionDef.args) : Buffer.from('');
                        const gas = BigInt(actionDef.gasTeras || "30") * BigInt(10**12);
                        const deposit = actionDef.depositNear ? BigInt(parseNear(actionDef.depositNear)) : BigInt(0);
                        return transactions.functionCall(actionDef.methodName, args, gas, deposit);
                    case 'Transfer':
                         const transferDeposit = BigInt(parseNear(actionDef.depositNear));
                        return transactions.transfer(transferDeposit);
                    case 'Stake':
                        return transactions.stake(BigInt(actionDef.stakeYocto), PublicKey.fromString(actionDef.publicKey));
                    case 'AddKey':
                        let accessKey;
                        if (actionDef.accessKey.permission === 'FullAccess') {
                            accessKey = transactions.fullAccessKey();
                        } else {
                            const permission = actionDef.accessKey.permission;
                            const allowance = permission.allowanceNear ? BigInt(parseNear(permission.allowanceNear)) : undefined;
                            accessKey = transactions.functionCallAccessKey(permission.receiverId, permission.methodNames, allowance);
                        }
                        return transactions.addKey(PublicKey.fromString(actionDef.publicKey), accessKey);
                    case 'DeleteKey':
                        return transactions.deleteKey(PublicKey.fromString(actionDef.publicKey));
                    case 'DeleteAccount':
                        return transactions.deleteAccount(actionDef.beneficiaryId);
                    default:
                        // This should not happen due to Zod validation, but keeps TSC happy
                        throw new Error(`Unknown action type in batch`);
                }
            });

            const result = await getAccount().signAndSendTransaction({
                receiverId: targetReceiverId,
                actions: nearActions
            });

            return {
                content: [{
                    type: "text",
                    text: `Successfully executed batch transaction with ${actions.length} actions for receiver ${targetReceiverId}. Transaction hash: ${result.transaction.hash}`,
                }],
            };
        } catch (error: any) {
            console.error(`Error executing batch actions for ${targetReceiverId}:`, error);
            let errorMessage = `Failed to execute batch actions for ${targetReceiverId}.`;
            if (error.message) {
                errorMessage += ` Reason: ${error.message}`;
            }
             if (error.kind && error.kind.ExecutionError) {
               errorMessage += ` Contract Error: ${error.kind.ExecutionError}`;
            }
            return { isError: true, content: [{ type: "text", text: errorMessage }] };
        }
    }
);

// 9. Deploy Contract
server.tool(
    "deploy_contract",
    "Deploy a WASM smart contract to the server's configured account.",
    {
        wasmBase64: z.string().describe("Base64 encoded string of the WASM contract bytecode."),
    },
    async ({ wasmBase64 }) => {
        console.error(`Tool: deploy_contract called for ${nearAccountId}`);
        try {
            await setupNear();
            const wasmBytes = decodeBase64(wasmBase64);
            console.error(`Deploying contract size: ${wasmBytes.length} bytes`);
            const result = await getAccount().deployContract(wasmBytes);
             return {
                content: [{
                    type: "text",
                    text: `Successfully deployed contract to ${nearAccountId}. Transaction hash: ${result.transaction.hash}`,
                }],
            };
        } catch (error: any) {
            console.error(`Error deploying contract to ${nearAccountId}:`, error);
            let errorMessage = `Failed to deploy contract to ${nearAccountId}.`;
             if (error.type === 'ContractSizeExceeded') {
                 errorMessage = `Contract size (${base64ByteLength(wasmBase64)} bytes) exceeds the limit.`;
             } else if (error.type === 'AccountAlreadyExists') {
                 // This shouldn't typically happen for deploy, but good to handle
                 errorMessage = `Account ${nearAccountId} seems to already exist with code? This might indicate an issue.`;
             } else if (error.message) {
                 errorMessage += ` Reason: ${error.message}`;
             }
             if (error.kind && error.kind.ExecutionError) {
               errorMessage += ` Contract Error: ${error.kind.ExecutionError}`; // e.g., LinkError
             }
            return { isError: true, content: [{ type: "text", text: errorMessage }] };
        }
    }
);

// 10. View Function (Refined)
server.tool(
    "view_function",
    "Call a view-only function on a specified contract (does not change state, does not cost gas beyond RPC fees).",
    {
        contractId: z.string().describe("The NEAR account ID of the contract."),
        methodName: z.string().describe("The name of the view function to call."),
        args: z.record(z.unknown()).optional().describe("Arguments for the function call as a JSON object (default: {}).")
    },
    async ({ contractId, methodName, args = {} }) => {
        console.error(`Tool: view_function called: ${contractId}.${methodName}(${JSON.stringify(args)})`);
        try {
            await setupNear();
             // Use provider directly for view calls
            const result = await getProvider().query({
                request_type: "call_function",
                finality: "optimistic",
                account_id: contractId,
                method_name: methodName,
                args_base64: encodeArgs(args).toString('base64')
            });

            let resultValue = "[No return value]";
            if ((result as any).result && (result as any).result.length > 0) {
                resultValue = Buffer.from((result as any).result).toString();
                 // Try parsing as JSON, fallback to raw string
                 try { resultValue = JSON.parse(resultValue); } catch(e) { /* ignore */ }
            }

            return {
                content: [{
                    type: "text",
                    text: `Result of calling ${methodName} on ${contractId}: ${typeof resultValue === 'object' ? JSON.stringify(resultValue, null, 2) : resultValue}`,
                }],
            };
        } catch (error: any) {
            console.error(`Error viewing function ${contractId}.${methodName}:`, error);
            let errorMessage = `Failed to view function ${methodName} on ${contractId}.`;
             if (error.type === 'AccountDoesNotExist') {
                 errorMessage = `Contract account ${contractId} does not exist on ${NEAR_NETWORK_ID}.`;
             } else if (error.type === 'CONTRACT_CODE_NOT_FOUND' || (error.cause && error.cause.name === 'CONTRACT_CODE_NOT_FOUND')) {
                 errorMessage = `Account ${contractId} does not have a contract deployed.`;
             } else if (error.type === 'METHOD_NOT_FOUND' || (error.cause && error.cause.name === 'METHOD_NOT_FOUND')) {
                 errorMessage = `Method "${methodName}" not found on contract ${contractId}.`;
             } else if (error.message) {
                errorMessage += ` Reason: ${error.message}`;
            }
             if (error.kind && error.kind.ExecutionError) {
               errorMessage += ` Contract Error: ${error.kind.ExecutionError}`; // e.g., GuestPanic
             }
            return { isError: true, content: [{ type: "text", text: errorMessage }] };
        }
    }
);

// 11. Get All Access Keys
server.tool(
    "get_access_keys",
    "List all access keys associated with the server's configured account.",
    {}, // No input arguments needed
    async () => {
        console.error(`Tool: get_access_keys called for ${nearAccountId}`);
        try {
            await setupNear();
            const keys = await getAccount().getAccessKeys();

            if (!keys || keys.length === 0) {
                return { content: [{ type: "text", text: `Account ${nearAccountId} has no access keys.` }] };
            }

            const formattedKeys = keys.map((key: any) => {
                let permissionInfo;
                if (key.access_key.permission === 'FullAccess') {
                    permissionInfo = "  Permission: FullAccess";
                } else {
                    const fc = key.access_key.permission.FunctionCall;
                    permissionInfo = `  Permission: FunctionCall\n    Receiver: ${fc.receiver_id}\n    Methods: ${fc.method_names.length > 0 ? fc.method_names.join(', ') : '[Any]'}\n    Allowance: ${fc.allowance ? formatNear(fc.allowance) + ' NEAR' : 'Unlimited'}`;
                }
                return `Public Key: ${key.public_key}\n  Nonce: ${key.access_key.nonce}\n${permissionInfo}`;
            }).join('\n---\n');

            return {
                content: [{
                    type: "text",
                    text: `Access keys for ${nearAccountId}:\n${formattedKeys}`
                }],
            };
        } catch (error: any) {
            console.error(`Error fetching access keys for ${nearAccountId}:`, error);
            return { isError: true, content: [{ type: "text", text: `Failed to fetch access keys for ${nearAccountId}. Reason: ${error.message}` }] };
        }
    }
);

// 12. Add Full Access Key
server.tool(
    "add_full_access_key",
    "Add a new key with full access permissions to the server's configured account.",
    {
        publicKey: z.string().describe("The base58 encoded public key to add."),
    },
    async ({ publicKey }) => {
        console.error(`Tool: add_full_access_key called for ${nearAccountId}`);
        try {
            await setupNear();
            const pubKey = PublicKey.fromString(publicKey);
            const result = await getAccount().addKey(pubKey); // Default is FullAccess

            return {
                content: [{
                    type: "text",
                    text: `Successfully added full access key ${publicKey} to ${nearAccountId}. Transaction hash: ${result.transaction.hash}`,
                }],
            };
        } catch (error: any) {
            console.error(`Error adding full access key ${publicKey} to ${nearAccountId}:`, error);
            let errorMessage = `Failed to add full access key ${publicKey} to ${nearAccountId}.`;
             if (error.type === 'AddKeyAlreadyExists') {
                 errorMessage = `Public key ${publicKey} already exists for account ${nearAccountId}.`;
             } else if (error.message) {
                errorMessage += ` Reason: ${error.message}`;
            }
            return { isError: true, content: [{ type: "text", text: errorMessage }] };
        }
    }
);

// 13. Add Function Call Key
server.tool(
    "add_function_call_key",
    "Add a new key with limited function call permissions to the server's configured account.",
    {
        publicKey: z.string().describe("The base58 encoded public key to add."),
        contractId: z.string().describe("The contract ID this key is allowed to call."),
        methodNames: z.array(z.string()).optional().describe("Array of method names allowed (empty array or omit for any method)."),
        allowanceNear: z.string().optional().describe("Allowance in NEAR for this key (e.g., '0.25'). Omit for no allowance limit.")
    },
    async ({ publicKey, contractId, methodNames = [], allowanceNear }) => {
        console.error(`Tool: add_function_call_key called for ${nearAccountId}, target contract: ${contractId}`);
        try {
            await setupNear();
            const pubKey = PublicKey.fromString(publicKey);
            const allowance = allowanceNear ? BigInt(parseNear(allowanceNear)) : undefined;
            const result = await getAccount().addKey(pubKey, contractId, methodNames, allowance);

            return {
                content: [{
                    type: "text",
                    text: `Successfully added function call access key ${publicKey} to ${nearAccountId} for contract ${contractId}. Transaction hash: ${result.transaction.hash}`,
                }],
            };
        } catch (error: any) {
            console.error(`Error adding function call key ${publicKey} to ${nearAccountId}:`, error);
            let errorMessage = `Failed to add function call key ${publicKey} to ${nearAccountId}.`;
             if (error.type === 'AddKeyAlreadyExists') {
                 errorMessage = `Public key ${publicKey} already exists for account ${nearAccountId}.`;
             } else if (error.message) {
                 errorMessage += ` Reason: ${error.message}`;
             }
            return { isError: true, content: [{ type: "text", text: errorMessage }] };
        }
    }
);

// 14. Delete Access Key
server.tool(
    "delete_access_key",
    "Delete an existing access key from the server's configured account.",
    {
        publicKey: z.string().describe("The base58 encoded public key to delete."),
    },
    async ({ publicKey }) => {
        console.error(`Tool: delete_access_key called for ${nearAccountId}, key: ${publicKey}`);
        try {
            await setupNear();
            const pubKey = PublicKey.fromString(publicKey);
            const result = await getAccount().deleteKey(pubKey);

            return {
                content: [{
                    type: "text",
                    text: `Successfully deleted access key ${publicKey} from ${nearAccountId}. Transaction hash: ${result.transaction.hash}`,
                }],
            };
        } catch (error: any) {
            console.error(`Error deleting key ${publicKey} from ${nearAccountId}:`, error);
            let errorMessage = `Failed to delete access key ${publicKey} from ${nearAccountId}.`;
             if (error.type === 'DeleteKeyDoesNotExist') {
                 errorMessage = `Public key ${publicKey} does not exist for account ${nearAccountId}.`;
             } else if (error.message) {
                 errorMessage += ` Reason: ${error.message}`;
             }
            return { isError: true, content: [{ type: "text", text: errorMessage }] };
        }
    }
);

// 15. Validate Message Signature
server.tool(
    "verify_signature",
    "Verify if a message signature is valid for a given public key.",
    {
        message: z.string().describe("The message that was signed (provide as plain string)."),
        signatureBase64: z.string().describe("The base64 encoded signature string."),
        publicKey: z.string().describe("The base58 encoded public key to verify against.")
    },
    async ({ message, signatureBase64, publicKey }) => {
         console.error(`Tool: verify_signature called for key: ${publicKey}`);
         try {
             const messageBytes = Buffer.from(message); // Signatures are usually on raw bytes
             const signatureBytes = decodeBase64(signatureBase64);
             const pubKey = PublicKey.fromString(publicKey);

             const isValid = pubKey.verify(messageBytes, signatureBytes);

             return {
                 content: [{
                     type: "text",
                     text: `Signature verification result for public key ${publicKey}: ${isValid ? 'Valid' : 'Invalid'}`
                 }],
             };
         } catch (error: any) {
             console.error(`Error verifying signature for key ${publicKey}:`, error);
             let errorMessage = `Failed to verify signature for public key ${publicKey}.`;
             if (error.message) {
                 errorMessage += ` Reason: ${error.message}`;
             }
             // Specific errors for key parsing or signature format could be added here
             return { isError: true, content: [{ type: "text", text: errorMessage }] };
         }
    }
);


// --- Main Execution ---
async function main() {
  try {
    await setupNear(); // Initialize NEAR connection and account before starting server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("NEAR MCP Server running on stdio...");
  } catch (error) {
    console.error("Fatal error initializing server:", error);
    process.exit(1);
  }
}

main();
