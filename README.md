# Moneris CLI

Beautiful command-line interfaces for interacting with Moneris payment gateway APIs.

## Overview

This project provides two CLI implementations for Moneris payment processing:

1. **moneris-cli** - Uses Postman API Network context for accurate API implementation
2. **moneris-cli-no-postman** - Uses general knowledge of Moneris APIs

### Core Operations

**moneris-cli** supports:
- Authentication (OAuth2)
- Create payments with card details
- List payments with cursor-based pagination
- Delete all payments (demonstrates API limitation - payments cannot be deleted)

**moneris-cli-no-postman** supports:
- Authentication (OAuth2)
- Create payments
- List payments with page-based pagination

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file or set environment variables:

```bash
# Required for both CLIs
MONERIS_CLIENT_ID=your_client_id
MONERIS_CLIENT_SECRET=your_client_secret

# Optional (defaults shown)
MONERIS_ENV=sandbox                    # or 'production'

# Additional for moneris-cli (Postman version)
MONERIS_MERCHANT_ID=0123456789123      # Your merchant ID
MONERIS_API_VERSION=2025-08-14         # API version
```

## Usage

### moneris-cli (Postman API version)

```bash
# Authenticate
npm run dev:postman auth

# Create a payment
npm run dev:postman create-payment -a 100.50 -c CAD -d "Test payment" -r "ORDER-123"

# Create a payment with card details
npm run dev:postman create-payment \
  -a 100.50 \
  -c CAD \
  --card-number "4242424242424242" \
  --expiry-month "12" \
  --expiry-year "2025" \
  --cvv "123" \
  --cardholder-name "John Doe"

# List payments (cursor-based pagination)
npm run dev:postman list-payments -l 50

# List payments with filters
npm run dev:postman list-payments \
  -l 50 \
  --created-from "2024-01-01T00:00:00.000Z" \
  --created-to "2024-12-31T23:59:59.999Z"

# List next page using cursor
npm run dev:postman list-payments --cursor "d41d8cd98f00b204e9800998ecf8427e"

# Delete all payments (Note: Moneris API doesn't support payment deletion)
# Shows warning and requires --confirm flag
npm run dev:postman delete-all-payments

# Attempt deletion with confirmation (will fail with helpful message)
npm run dev:postman delete-all-payments --confirm
```

### moneris-cli-no-postman (General API version)

```bash
# Authenticate
npm run dev:no-postman auth

# Create a payment
npm run dev:no-postman create-payment -a 100.50 -c USD -d "Test payment" -r "ORDER-123"

# List payments (page-based pagination)
npm run dev:no-postman list-payments -l 20 -p 1

# List by status
npm run dev:no-postman list-payments -s completed
```

## Key Differences

### moneris-cli (Postman version)

- Uses actual Moneris API endpoints from Postman
- OAuth2 endpoint: `/oauth2/token`
- Includes required Moneris headers:
  - `Api-Version`: API version control
  - `X-Correlation-Id`: Request tracking (auto-generated UUID)
  - `X-Merchant-Id`: Merchant identification
- Cursor-based pagination for listing
- Supports card payment methods in create payment
- More accurate error responses

### moneris-cli-no-postman

- Uses general API knowledge
- OAuth2 endpoint: `/oauth/token`
- Basic headers only
- Page-based pagination
- Simpler payment creation
- Good for getting started

## Features

- Beautiful colored console output
- Automatic token management and expiration checking
- Comprehensive error handling
- Type-safe TypeScript implementation
- Single-file architecture for easy deployment
- Input validation with helpful error messages
- Safety confirmations for destructive operations
- Educational error handling (e.g., demonstrates API limitations)

## Project Structure

```
.
├── moneris-cli.ts              # Postman API version
├── moneris-cli-no-postman.ts   # General API version
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
└── README.md                   # This file
```

## Development

```bash
# Build both CLIs
npm run build

# Run TypeScript compiler
npx tsc

# Install globally (after build)
npm link
```

## Documentation

See [CLAUDE.md](./CLAUDE.md) for development notes and context.

## License

TBD
