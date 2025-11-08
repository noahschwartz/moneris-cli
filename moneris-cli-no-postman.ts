#!/usr/bin/env node

/**
 * Moneris CLI (No Postman)
 * A beautiful single-file CLI for Moneris payment gateway
 * Uses general knowledge of Moneris APIs
 */

import { Command } from 'commander';
import chalk from 'chalk';
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Load environment variables
dotenv.config();

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface MonerisConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  environment: 'sandbox' | 'production';
}

interface AuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
}

interface Payment {
  id?: string;
  amount: number;
  currency: string;
  description?: string;
  reference?: string;
  status?: string;
  created_at?: string;
}

interface PaymentResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reference?: string;
  created_at: string;
  transaction_id?: string;
}

interface ListPaymentsResponse {
  payments: PaymentResponse[];
  total: number;
  page: number;
  limit: number;
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get Moneris configuration from environment variables
 */
function getConfig(): MonerisConfig {
  const clientId = process.env.MONERIS_CLIENT_ID;
  const clientSecret = process.env.MONERIS_CLIENT_SECRET;
  const environment = (process.env.MONERIS_ENV || 'sandbox') as 'sandbox' | 'production';

  if (!clientId || !clientSecret) {
    console.error(chalk.red('✗ Missing credentials'));
    console.log(chalk.yellow('\nPlease set the following environment variables:'));
    console.log(chalk.cyan('  MONERIS_CLIENT_ID'));
    console.log(chalk.cyan('  MONERIS_CLIENT_SECRET'));
    console.log(chalk.cyan('  MONERIS_ENV (optional: sandbox|production, default: sandbox)'));
    process.exit(1);
  }

  return {
    clientId,
    clientSecret,
    baseUrl: MONERIS_URLS[environment],
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
 * Create authenticated API client
 */
function createApiClient(token: string, baseUrl: string): AxiosInstance {
  return axios.create({
    baseURL: baseUrl,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000,
  });
}

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

/**
 * Authenticate with Moneris and get access token
 */
async function authenticate(): Promise<void> {
  const config = getConfig();

  console.log(chalk.blue('\n🔐 Authenticating with Moneris...'));
  console.log(chalk.gray(`Environment: ${config.environment}`));
  console.log(chalk.gray(`Base URL: ${config.baseUrl}`));

  try {
    // OAuth2 Client Credentials Flow
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', config.clientId);
    params.append('client_secret', config.clientSecret);

    const response = await axios.post(
      `${config.baseUrl}/oauth/token`,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
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
  description?: string,
  reference?: string
): Promise<void> {
  const config = getConfig();
  const token = loadToken();

  if (!token) {
    console.error(chalk.red('\n✗ Not authenticated'));
    console.log(chalk.yellow('Please run: moneris-cli-no-postman auth'));
    process.exit(1);
  }

  console.log(chalk.blue('\n💳 Creating payment...'));
  console.log(chalk.gray(`Amount: ${formatCurrency(amount, currency)}`));
  if (description) console.log(chalk.gray(`Description: ${description}`));
  if (reference) console.log(chalk.gray(`Reference: ${reference}`));

  try {
    const client = createApiClient(token.access_token, config.baseUrl);

    const paymentData: Payment = {
      amount,
      currency: currency.toUpperCase(),
      description,
      reference,
    };

    const response = await client.post<PaymentResponse>('/payments', paymentData);
    const payment = response.data;

    console.log(chalk.green('\n✓ Payment created successfully!'));
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold(`Payment ID: ${payment.id}`));
    if (payment.transaction_id) {
      console.log(chalk.bold(`Transaction ID: ${payment.transaction_id}`));
    }
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(`Amount:      ${formatCurrency(payment.amount, payment.currency)}`);
    console.log(`Currency:    ${payment.currency}`);
    console.log(`Status:      ${chalk.yellow(payment.status)}`);
    if (payment.reference) {
      console.log(`Reference:   ${payment.reference}`);
    }
    console.log(`Created:     ${formatDate(payment.created_at)}`);
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  } catch (error) {
    handleError(error, 'Create payment');
  }
}

/**
 * List all payments
 */
async function listPayments(
  limit: number = 10,
  page: number = 1,
  status?: string
): Promise<void> {
  const config = getConfig();
  const token = loadToken();

  if (!token) {
    console.error(chalk.red('\n✗ Not authenticated'));
    console.log(chalk.yellow('Please run: moneris-cli-no-postman auth'));
    process.exit(1);
  }

  console.log(chalk.blue('\n📋 Fetching payments...'));

  try {
    const client = createApiClient(token.access_token, config.baseUrl);

    const params: Record<string, any> = {
      limit,
      page,
    };

    if (status) {
      params.status = status;
    }

    const response = await client.get<ListPaymentsResponse>('/payments', { params });
    const { payments, total } = response.data;

    if (payments.length === 0) {
      console.log(chalk.yellow('\n⚠ No payments found'));
      return;
    }

    console.log(chalk.green(`\n✓ Found ${total} payment(s)\n`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    payments.forEach((payment, index) => {
      console.log(chalk.bold(`\n${index + 1}. Payment ${payment.id}`));
      console.log(`   Amount:      ${formatCurrency(payment.amount, payment.currency)}`);
      console.log(`   Status:      ${getStatusColor(payment.status)}${payment.status}${chalk.reset('')}`);
      if (payment.reference) {
        console.log(`   Reference:   ${payment.reference}`);
      }
      if (payment.transaction_id) {
        console.log(`   Transaction: ${payment.transaction_id}`);
      }
      console.log(`   Created:     ${formatDate(payment.created_at)}`);
    });

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    console.log(chalk.gray(`Page ${page} • Showing ${payments.length} of ${total} total payments\n`));

  } catch (error) {
    handleError(error, 'List payments');
  }
}

/**
 * Get colored status based on payment status
 */
function getStatusColor(status: string): string {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('success') || statusLower.includes('completed') || statusLower.includes('approved')) {
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
  .name('moneris-cli-no-postman')
  .description('A beautiful CLI for Moneris payment gateway (using general API knowledge)')
  .version('1.0.0');

// Auth command
program
  .command('auth')
  .description('Authenticate with Moneris and save access token')
  .action(async () => {
    await authenticate();
  });

// Create payment command
program
  .command('create-payment')
  .description('Create a new payment')
  .requiredOption('-a, --amount <number>', 'Payment amount', parseFloat)
  .option('-c, --currency <string>', 'Currency code (e.g., USD, CAD)', 'USD')
  .option('-d, --description <string>', 'Payment description')
  .option('-r, --reference <string>', 'Payment reference')
  .action(async (options) => {
    await createPayment(
      options.amount,
      options.currency,
      options.description,
      options.reference
    );
  });

// List payments command
program
  .command('list-payments')
  .description('List all payments')
  .option('-l, --limit <number>', 'Number of payments to retrieve', '10')
  .option('-p, --page <number>', 'Page number', '1')
  .option('-s, --status <string>', 'Filter by status')
  .action(async (options) => {
    await listPayments(
      parseInt(options.limit),
      parseInt(options.page),
      options.status
    );
  });

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

// Parse commands
program.parse(process.argv);
