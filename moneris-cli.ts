#!/usr/bin/env node

/**
 * Moneris CLI (with Postman API Context)
 * A beautiful single-file CLI for Moneris payment gateway
 * Uses Postman API Network context for accurate API implementation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// Load environment variables
dotenv.config();

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface MonerisConfig {
  clientId: string;
  clientSecret: string;
  merchantId: string;
  baseUrl: string;
  apiVersion: string;
  environment: 'sandbox' | 'production';
}

interface AuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
}

interface PaymentMethod {
  paymentMethodSource: string;
  card: {
    cardNumber: string;
    expiryMonth: number;
    expiryYear: number;
    cardSecurityCode: string;
  };
  storePaymentMethod?: string;
}

interface Payment {
  idempotencyKey?: string;
  orderId?: string;
  invoiceNumber?: string;
  amount: {
    amount: number;
    currency: string;
  };
  customerId?: string;
  paymentMethod: PaymentMethod;
  ecommerceIndicator?: string;
  automaticCapture?: boolean;
  customData?: Record<string, string>;
  dynamicDescriptor?: string;
  ipv4?: string;
  ipv6?: string;
}

interface PaymentResponse {
  paymentId: string;
  merchantId: string;
  orderId: string;
  invoiceNumber: string;
  transactionDateTime: string;
  createdAt: string;
  modifiedAt: string;
  amount: {
    amount: number;
    currency: string;
  };
  authorizedAmount: {
    amount: number;
    currency: string;
  };
  capturableAmount: {
    amount: number;
    currency: string;
  };
  customerId: string;
  paymentMethod?: any;
  paymentStatus: string;
  transactionDetails?: {
    transactionUniqueId: string;
    authorizationCode: string;
    isoResponseCode: string;
    responseCode: string;
    message: string;
    ecommerceIndicator: string;
  };
  verificationDetails?: any;
  credentialOnFileResponse?: any;
  refundDetails?: any;
  customData?: Record<string, string>;
}

interface ListPaymentsResponse {
  data: PaymentResponse[];
  has_more: boolean;
  next_cursor?: string;
}

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.moneris');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');

const MONERIS_URLS = {
  sandbox: 'https://api.sb.moneris.io',
  production: 'https://api.moneris.io',
};

const API_VERSION = '2025-08-14';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get Moneris configuration from environment variables
 */
function getConfig(): MonerisConfig {
  const clientId = process.env.MONERIS_CLIENT_ID;
  const clientSecret = process.env.MONERIS_CLIENT_SECRET;
  const merchantId = process.env.MONERIS_MERCHANT_ID || '0123456789123';
  const environment = (process.env.MONERIS_ENV || 'sandbox') as 'sandbox' | 'production';
  const apiVersion = process.env.MONERIS_API_VERSION || API_VERSION;

  if (!clientId || !clientSecret) {
    console.error(chalk.red('✗ Missing credentials'));
    console.log(chalk.yellow('\nPlease set the following environment variables:'));
    console.log(chalk.cyan('  MONERIS_CLIENT_ID'));
    console.log(chalk.cyan('  MONERIS_CLIENT_SECRET'));
    console.log(chalk.cyan('  MONERIS_MERCHANT_ID (optional, default: 0123456789123)'));
    console.log(chalk.cyan('  MONERIS_ENV (optional: sandbox|production, default: sandbox)'));
    console.log(chalk.cyan('  MONERIS_API_VERSION (optional, default: 2025-08-14)'));
    process.exit(1);
  }

  return {
    clientId,
    clientSecret,
    merchantId,
    baseUrl: MONERIS_URLS[environment],
    apiVersion,
    environment,
  };
}

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Save auth token to file
 */
function saveToken(token: AuthToken): void {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
}

/**
 * Load auth token from file
 */
function loadToken(): AuthToken | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) {
      return null;
    }
    const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
    const token: AuthToken = JSON.parse(data);

    // Check if token is expired
    if (Date.now() >= token.expires_at) {
      return null;
    }

    return token;
  } catch (error) {
    return null;
  }
}

/**
 * Generate correlation ID for request tracking
 */
function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Format currency amount
 */
function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

/**
 * Format date
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Handle API errors with beautiful output
 */
function handleError(error: unknown, context: string): void {
  console.error(chalk.red(`\n✗ ${context} failed`));

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      console.error(chalk.yellow(`Status: ${axiosError.response.status}`));
      console.error(chalk.yellow(`Message: ${JSON.stringify(axiosError.response.data, null, 2)}`));
    } else if (axiosError.request) {
      console.error(chalk.yellow('No response received from server'));
    } else {
      console.error(chalk.yellow(`Error: ${axiosError.message}`));
    }
  } else if (error instanceof Error) {
    console.error(chalk.yellow(`Error: ${error.message}`));
  } else {
    console.error(chalk.yellow(`Unknown error occurred`));
  }

  process.exit(1);
}

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * Create authenticated API client with Moneris-specific headers
 */
function createApiClient(token: string, config: MonerisConfig): AxiosInstance {
  return axios.create({
    baseURL: config.baseUrl,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Api-Version': config.apiVersion,
      'X-Merchant-Id': config.merchantId,
      'X-Correlation-Id': generateCorrelationId(),
    },
    timeout: 30000,
  });
}

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

/**
 * Authenticate with Moneris using OAuth2 and get access token
 */
async function authenticate(): Promise<void> {
  const config = getConfig();

  console.log(chalk.blue('\n🔐 Authenticating with Moneris...'));
  console.log(chalk.gray(`Environment: ${config.environment}`));
  console.log(chalk.gray(`Base URL: ${config.baseUrl}`));
  console.log(chalk.gray(`API Version: ${config.apiVersion}`));
  console.log(chalk.gray(`Merchant ID: ${config.merchantId}`));

  try {
    // OAuth2 Client Credentials Flow - Using actual Moneris endpoint
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', config.clientId);
    params.append('client_secret', config.clientSecret);

    const response = await axios.post(
      `${config.baseUrl}/oauth2/token`,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Correlation-Id': generateCorrelationId(),
        },
      }
    );

    const token: AuthToken = {
      access_token: response.data.access_token,
      token_type: response.data.token_type || 'Bearer',
      expires_in: response.data.expires_in || 3600,
      expires_at: Date.now() + ((response.data.expires_in || 3600) * 1000),
    };

    saveToken(token);

    console.log(chalk.green('\n✓ Authentication successful!'));
    console.log(chalk.gray(`Token type: ${token.token_type}`));
    console.log(chalk.gray(`Expires in: ${token.expires_in} seconds`));
    console.log(chalk.gray(`Token saved to: ${TOKEN_FILE}`));

  } catch (error) {
    handleError(error, 'Authentication');
  }
}

/**
 * Create a new payment
 */
async function createPayment(
  amount: number,
  currency: string,
  cardNumber: string,
  expiryMonth: string,
  expiryYear: string,
  cvv: string,
  cardholderName?: string,
  description?: string,
  reference?: string
): Promise<void> {
  const config = getConfig();
  const token = loadToken();

  if (!token) {
    console.error(chalk.red('\n✗ Not authenticated'));
    console.log(chalk.yellow('Please run: moneris-cli auth'));
    process.exit(1);
  }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    console.error(chalk.red('\n✗ Invalid amount'));
    console.log(chalk.yellow('Amount must be a positive number'));
    console.log(chalk.cyan('Example: --amount 10.00'));
    process.exit(1);
  }

  // Convert amount to cents (smallest currency unit)
  const amountInCents = Math.round(amount * 100);

  console.log(chalk.blue('\n💳 Creating payment...'));
  console.log(chalk.gray(`Amount: ${formatCurrency(amount, currency)} (${amountInCents} cents)`));
  if (description) console.log(chalk.gray(`Dynamic Descriptor: ${description}`));
  if (reference) console.log(chalk.gray(`Order ID: ${reference}`));

  try {
    const client = createApiClient(token.access_token, config);

    const paymentData: Payment = {
      amount: {
        amount: amountInCents,
        currency: currency.toUpperCase(),
      },
      idempotencyKey: generateCorrelationId(),
      orderId: reference,
      invoiceNumber: reference,
      automaticCapture: true,
      ecommerceIndicator: 'AUTHENTICATED_ECOMMERCE',
      dynamicDescriptor: description,
      paymentMethod: {
        paymentMethodSource: 'CARD',
        card: {
          cardNumber: cardNumber,
          expiryMonth: parseInt(expiryMonth),
          expiryYear: parseInt(expiryYear),
          cardSecurityCode: cvv,
        },
        storePaymentMethod: 'DO_NOT_STORE',
      },
    };

    const response = await client.post<PaymentResponse>('/payments', paymentData);
    const payment = response.data;

    console.log(chalk.green('\n✓ Payment created successfully!'));
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold(`Payment ID: ${payment.paymentId}`));
    if (payment.transactionDetails?.transactionUniqueId) {
      console.log(chalk.bold(`Transaction ID: ${payment.transactionDetails.transactionUniqueId}`));
    }
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    // Convert cents to dollars for display
    console.log(`Amount:      ${formatCurrency(payment.amount.amount / 100, payment.amount.currency)}`);
    console.log(`Currency:    ${payment.amount.currency}`);
    console.log(`Status:      ${getStatusColor(payment.paymentStatus)}${payment.paymentStatus}${chalk.reset('')}`);
    if (payment.orderId) {
      console.log(`Order ID:    ${payment.orderId}`);
    }
    if (payment.transactionDetails?.authorizationCode) {
      console.log(`Auth Code:   ${payment.transactionDetails.authorizationCode}`);
    }
    if (payment.transactionDetails?.message) {
      console.log(`Message:     ${payment.transactionDetails.message}`);
    }
    console.log(`Created:     ${formatDate(payment.createdAt)}`);
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  } catch (error) {
    handleError(error, 'Create payment');
  }
}

/**
 * List all payments with cursor-based pagination
 */
async function listPayments(
  limit?: number,
  cursor?: string,
  createdFrom?: string,
  createdTo?: string
): Promise<void> {
  const config = getConfig();
  const token = loadToken();

  if (!token) {
    console.error(chalk.red('\n✗ Not authenticated'));
    console.log(chalk.yellow('Please run: moneris-cli auth'));
    process.exit(1);
  }

  console.log(chalk.blue('\n📋 Fetching payments...'));

  try {
    const client = createApiClient(token.access_token, config);

    const params: Record<string, any> = {};

    // Only add query parameters if they were explicitly provided
    if (limit) {
      params.limit = limit;
    }
    if (cursor) {
      params.cursor = cursor;
    }
    if (createdFrom) {
      params.created_from = createdFrom;
    }
    if (createdTo) {
      params.created_to = createdTo;
    }

    const response = await client.get<ListPaymentsResponse>('/payments', { params });
    const { data: payments, has_more, next_cursor } = response.data;

    if (payments.length === 0) {
      console.log(chalk.yellow('\n⚠ No payments found'));
      return;
    }

    console.log(chalk.green(`\n✓ Found ${payments.length} payment(s)\n`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    payments.forEach((payment, index) => {
      console.log(chalk.bold(`\n${index + 1}. Payment ${payment.paymentId}`));
      // Convert cents to dollars for display
      console.log(`   Amount:      ${formatCurrency(payment.amount.amount / 100, payment.amount.currency)}`);
      console.log(`   Status:      ${getStatusColor(payment.paymentStatus)}${payment.paymentStatus}${chalk.reset('')}`);
      if (payment.orderId) {
        console.log(`   Order ID:    ${payment.orderId}`);
      }
      if (payment.transactionDetails?.transactionUniqueId) {
        console.log(`   Transaction: ${payment.transactionDetails.transactionUniqueId}`);
      }
      console.log(`   Created:     ${formatDate(payment.createdAt)}`);
    });

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    if (has_more && next_cursor) {
      console.log(chalk.gray(`Has more results. Use cursor for next page:`));
      console.log(chalk.yellow(`  --cursor ${next_cursor}\n`));
    } else {
      console.log(chalk.gray(`No more results.\n`));
    }

  } catch (error) {
    handleError(error, 'List payments');
  }
}

/**
 * Delete all payments (Note: Moneris API does not support payment deletion)
 */
async function deleteAllPayments(confirm: boolean = false): Promise<void> {
  const config = getConfig();
  const token = loadToken();

  if (!token) {
    console.error(chalk.red('\n✗ Not authenticated'));
    console.log(chalk.yellow('Please run: moneris-cli auth'));
    process.exit(1);
  }

  console.log(chalk.blue('\n🗑️  Attempting to delete all payments...'));

  try {
    const client = createApiClient(token.access_token, config);

    // First, fetch all payments
    let allPayments: PaymentResponse[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    console.log(chalk.gray('Fetching all payments...'));

    while (hasMore) {
      const params: Record<string, any> = {};
      if (cursor) {
        params.cursor = cursor;
      }

      const response = await client.get<ListPaymentsResponse>('/payments', { params });
      allPayments = allPayments.concat(response.data.data);
      hasMore = response.data.has_more;
      cursor = response.data.next_cursor;
    }

    if (allPayments.length === 0) {
      console.log(chalk.yellow('\n⚠ No payments found'));
      return;
    }

    console.log(chalk.yellow(`\n⚠ Found ${allPayments.length} payment(s)`));
    console.log(chalk.red('\n⚠ Important: The Moneris API does not support deleting payments'));
    console.log(chalk.gray('   Payments cannot be deleted for compliance and audit purposes.'));
    console.log(chalk.gray('   To reverse a payment, use the refund feature instead.\n'));

    // Confirm attempt
    if (!confirm) {
      console.log(chalk.yellow('Use --confirm flag to attempt deletion anyway (will fail):'));
      console.log(chalk.cyan('  moneris-cli delete-all-payments --confirm\n'));
      return;
    }

    // Try to delete each payment (will fail with 404)
    let deletedCount = 0;
    let failedCount = 0;

    console.log(chalk.gray('Attempting deletion (expected to fail)...\n'));

    for (const payment of allPayments) {
      try {
        await client.delete(`/payments/${payment.paymentId}`);
        deletedCount++;
        console.log(chalk.gray(`  ✓ Deleted payment ${payment.paymentId}`));
      } catch (error) {
        failedCount++;
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          console.log(chalk.yellow(`  ⚠ Payment ${payment.paymentId} - DELETE not supported (404)`));
        } else {
          console.log(chalk.red(`  ✗ Failed to delete payment ${payment.paymentId}`));
          if (axios.isAxiosError(error) && error.response) {
            console.log(chalk.gray(`    Status: ${error.response.status}`));
          }
        }
      }
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.green(`✓ Deleted: ${deletedCount} payment(s)`));
    console.log(chalk.yellow(`⚠ Not supported: ${failedCount} payment(s)`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.gray('\nNote: Use refunds to reverse payments instead of deletion.\n'));

  } catch (error) {
    handleError(error, 'Delete all payments');
  }
}

/**
 * Get colored status based on payment status
 */
function getStatusColor(status: string): string {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('succeed') || statusLower.includes('completed') || statusLower.includes('approved')) {
    return chalk.green('');
  } else if (statusLower.includes('pending') || statusLower.includes('processing')) {
    return chalk.yellow('');
  } else if (statusLower.includes('failed') || statusLower.includes('declined') || statusLower.includes('error')) {
    return chalk.red('');
  }
  return chalk.gray('');
}

// ============================================================================
// CLI SETUP
// ============================================================================

const program = new Command();

program
  .name('moneris-cli')
  .description('A beautiful CLI for Moneris payment gateway (using Postman API context)')
  .version('1.0.0');

// Auth command
program
  .command('auth')
  .description('Authenticate with Moneris OAuth2 and save access token')
  .action(async () => {
    await authenticate();
  });

// Create payment command
program
  .command('create-payment')
  .description('Create a new payment')
  .requiredOption('-a, --amount <number>', 'Payment amount', parseFloat)
  .option('-c, --currency <string>', 'Currency code (e.g., USD, CAD)', 'CAD')
  .requiredOption('--card-number <string>', 'Card number')
  .requiredOption('--expiry-month <string>', 'Card expiry month (MM)')
  .requiredOption('--expiry-year <string>', 'Card expiry year (YYYY)')
  .requiredOption('--cvv <string>', 'Card CVV/security code')
  .option('--cardholder-name <string>', 'Cardholder name')
  .option('-d, --description <string>', 'Payment description')
  .option('-r, --reference <string>', 'Payment reference')
  .action(async (options) => {
    await createPayment(
      options.amount,
      options.currency,
      options.cardNumber,
      options.expiryMonth,
      options.expiryYear,
      options.cvv,
      options.cardholderName,
      options.description,
      options.reference
    );
  });

// List payments command
program
  .command('list-payments')
  .description('List all payments (cursor-based pagination)')
  .option('-l, --limit <number>', 'Number of payments to retrieve (max 50)')
  .option('--cursor <string>', 'Cursor for pagination')
  .option('--created-from <string>', 'Filter by created from date (ISO 8601)')
  .option('--created-to <string>', 'Filter by created to date (ISO 8601)')
  .action(async (options) => {
    await listPayments(
      options.limit ? parseInt(options.limit) : undefined,
      options.cursor,
      options.createdFrom,
      options.createdTo
    );
  });

// Delete all payments command
program
  .command('delete-all-payments')
  .description('Delete all payments (useful for cleaning up test data)')
  .option('--confirm', 'Confirm deletion (required to proceed)')
  .action(async (options) => {
    await deleteAllPayments(options.confirm);
  });

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

// Parse commands
program.parse(process.argv);
