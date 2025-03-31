# NEAR MCP Server

Full-featured Model Context Protocol (MCP) Server for NEAR Protocol.

## Features

- Connects to the NEAR blockchain (mainnet or testnet)
- Provides various tools for NEAR account management and contract interaction
- Uses the Model Context Protocol (MCP) for standardized communication

## Installation

```bash
npm install near-mcp-server
```

## Usage

1. Create a `.env` file with your NEAR credentials:
```
MNEMONIC="your seed phrase here"
NEAR_NETWORK_ID="testnet" # or mainnet
NEAR_ACCOUNT_ID="your-account.testnet"
NEAR_NODE_URL="" # optional, defaults to standard RPC endpoints
```

2. Run the server:
```bash
npm start
```

## Development

```bash
# Build the TypeScript code
npm run build

# Check TypeScript errors
npm run check-index

# Run in development mode (build + start)
npm run dev
```

## License

ISC
