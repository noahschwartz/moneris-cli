#!/usr/bin/env node

/**
 * Moneris CLI (No Postman)
 * A beautiful single-file CLI for Moneris payment gateway
 * Built using Moneris REST API documentation from api-developer.moneris.com
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
  merchantId: string;
  baseUrl: string;
  environment: 'sandbox' | 'production';
}

interface AuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
}

interface PaymentMethodData {
  paymentMethodType: 'CARD' | 'TEMPORARY_TOKEN';
  cardNumber?: string;
  expiryMonth?: string;
  expiryYear?: string;
  cvd?: string;
  temporaryToken?: string;
}

interface PaymentMethod {
  paymentMethodData: PaymentMethodData;
}

interface CredentialOnFileInformation {
  type?: 'FIRST' | 'SUBSEQUENT';
}

interface PaymentRequest {
  amount: string;
  currency: string;
  automaticCapture: boolean;
  paymentMethod?: PaymentMethod;
  credentialOnFileInformation?: CredentialOnFileInformation;
  description?: string;
  referenceNumber?: string;
}

interface TransactionDetails {
  responseCode?: string;
  isoResponseCode?: string;
  terminalMessage?: string;
  authorizationCode?: string;
}

interface PaymentResponse {
  paymentID?: string;
  paymentStatus?: 'SUCCEEDED' | 'DECLINED' | 'DECLINED_RETRY' | 'AUTHORIZED' | 'PROCESSING' | 'CANCELED';
  amount?: string;
  currency?: string;
  transactionDetails?: TransactionDetails;
  referenceNumber?: string;
  createdAt?: string;
}

interface ErrorResponse {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
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
  const merchantId = process.env.MONERIS_MERCHANT_ID;
  const environment = (process.env.MONERIS_ENV || 'sandbox') as 'sandbox' | 'production';

  if (!clientId || !clientSecret || !merchantId) {
    console.error(chalk.red('✗ Missing credentials'));
    console.log(chalk.yellow('\nPlease set the following environment variables:'));
    console.log(chalk.cyan('  MONERIS_CLIENT_ID'));
    console.log(chalk.cyan('  MONERIS_CLIENT_SECRET'));
    console.log(chalk.cyan('  MONERIS_MERCHANT_ID'));
    console.log(chalk.cyan('  MONERIS_ENV (optional: sandbox|production, default: sandbox)'));
    process.exit(1);
  }

  return {
    clientId,
    clientSecret,
    merchantId,
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

    // Check if token is expired (with 60 second buffer)
    if (Date.now() >= token.expires_at - 60000) {
      return null;
    }

    return token;
  } catch (error) {
    return null;
  }
}

/**
 * Format currency amount for display
 */
function formatCurrency(amount: string, currency: string): string {
  const numAmount = parseFloat(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(numAmount);
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
    const axiosError = error as AxiosError<ErrorResponse>;
    if (axiosError.response) {
      console.error(chalk.yellow(`\nHTTP Status: ${axiosError.response.status}`));

      const errorData = axiosError.response.data;
      if (errorData) {
        if (errorData.title) console.error(chalk.yellow(`Title: ${errorData.title}`));
        if (errorData.detail) console.error(chalk.yellow(`Detail: ${errorData.detail}`));
        if (errorData.type) console.error(chalk.yellow(`Type: ${errorData.type}`));

        // If it's not a Problem JSON format, show raw data
        if (!errorData.title && !errorData.detail) {
          console.error(chalk.yellow(`Response: ${JSON.stringify(errorData, null, 2)}`));
        }
      }
    } else if (axiosError.request) {
      console.error(chalk.yellow('No response received from Moneris server'));
      console.error(chalk.gray('Please check your network connection and ensure the Moneris API is accessible'));
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

/**
 * Get colored status based on payment status
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'SUCCEEDED':
      return chalk.green(status);
    case 'AUTHORIZED':
      return chalk.blue(status);
    case 'PROCESSING':
      return chalk.yellow(status);
    case 'DECLINED':
    case 'DECLINED_RETRY':
    case 'CANCELED':
      return chalk.red(status);
    default:
      return chalk.gray(status);
  }
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
 * Authenticate with Moneris and get access token using OAuth 2.0
 * Reference: https://api-developer.moneris.com/GettingStarted
 */
async function authenticate(): Promise<void> {
  const config = getConfig();

  console.log(chalk.blue('\n🔐 Authenticating with Moneris...'));
  console.log(chalk.gray(`Environment: ${config.environment}`));
  console.log(chalk.gray(`Base URL: ${config.baseUrl}`));
  console.log(chalk.gray(`Merchant ID: ${config.merchantId}`));

  try {
    // OAuth2 Client Credentials Flow
    // POST /oauth2/token with form data
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', config.clientId);
    params.append('client_secret', config.clientSecret);
    params.append('scope', 'payment.write');

    const response = await axios.post(
      `${config.baseUrl}/oauth2/token`,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const token: AuthToken = {
      access_token: response.data.access_token,
      token_type: response.data.token_type || 'Bearer',
      expires_in: parseInt(response.data.expires_in) || 3600,
      expires_at: Date.now() + ((parseInt(response.data.expires_in) || 3600) * 1000),
    };

    saveToken(token);

    console.log(chalk.green('\n✓ Authentication successful!'));
    console.log(chalk.gray(`Token type: ${token.token_type}`));
    console.log(chalk.gray(`Expires in: ${token.expires_in} seconds (${Math.floor(token.expires_in / 60)} minutes)`));
    console.log(chalk.gray(`Token saved to: ${TOKEN_FILE}`));

  } catch (error) {
    handleError(error, 'Authentication');
  }
}

/**
 * Create a new payment using Moneris REST API
 * Reference: https://api-developer.moneris.com/BasicPurchase
 */
async function createPayment(
  amount: string,
  currency: string,
  cardNumber?: string,
  expiryMonth?: string,
  expiryYear?: string,
  cvd?: string,
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

    // Build payment request based on Moneris API structure
    const paymentData: PaymentRequest = {
      amount: amount,
      currency: currency.toUpperCase(),
      automaticCapture: true, // Purchase = authorize + capture in one call
    };

    // Add payment method if card details provided
    if (cardNumber && expiryMonth && expiryYear && cvd) {
      paymentData.paymentMethod = {
        paymentMethodData: {
          paymentMethodType: 'CARD',
          cardNumber,
          expiryMonth,
          expiryYear,
          cvd,
        },
      };

      // Credential on file information (required for card transactions)
      paymentData.credentialOnFileInformation = {
        type: 'FIRST',
      };
    }

    if (description) {
      (paymentData as any).description = description;
    }

    if (reference) {
      paymentData.referenceNumber = reference;
    }

    // POST /merchants/{merchantId}/payments
    const response = await client.post<PaymentResponse>(
      `/merchants/${config.merchantId}/payments`,
      paymentData
    );

    const payment = response.data;

    console.log(chalk.green('\n✓ Payment created successfully!'));
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    if (payment.paymentID) {
      console.log(chalk.bold(`Payment ID: ${payment.paymentID}`));
    }
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    if (payment.amount) {
      console.log(`Amount:      ${formatCurrency(payment.amount, payment.currency || currency)}`);
    }
    if (payment.currency) {
      console.log(`Currency:    ${payment.currency}`);
    }
    if (payment.paymentStatus) {
      console.log(`Status:      ${getStatusColor(payment.paymentStatus)}`);
    }
    if (payment.referenceNumber) {
      console.log(`Reference:   ${payment.referenceNumber}`);
    }
    if (payment.createdAt) {
      console.log(`Created:     ${formatDate(payment.createdAt)}`);
    }

    // Show transaction details if available
    if (payment.transactionDetails) {
      console.log(chalk.cyan('\nTransaction Details:'));
      const td = payment.transactionDetails;
      if (td.authorizationCode) {
        console.log(`  Auth Code:   ${td.authorizationCode}`);
      }
      if (td.responseCode) {
        console.log(`  Response:    ${td.responseCode}`);
      }
      if (td.isoResponseCode) {
        console.log(`  ISO Code:    ${td.isoResponseCode}`);
      }
      if (td.terminalMessage) {
        console.log(`  Message:     ${td.terminalMessage}`);
      }
    }

    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  } catch (error) {
    handleError(error, 'Create payment');
  }
}

/**
 * Get payment by ID
 * Reference: Moneris API supports GET /merchants/{merchantId}/payments/{paymentId}
 */
async function getPayment(paymentId: string): Promise<void> {
  const config = getConfig();
  const token = loadToken();

  if (!token) {
    console.error(chalk.red('\n✗ Not authenticated'));
    console.log(chalk.yellow('Please run: moneris-cli-no-postman auth'));
    process.exit(1);
  }

  console.log(chalk.blue(`\n🔍 Fetching payment ${paymentId}...`));

  try {
    const client = createApiClient(token.access_token, config.baseUrl);

    const response = await client.get<PaymentResponse>(
      `/merchants/${config.merchantId}/payments/${paymentId}`
    );

    const payment = response.data;

    console.log(chalk.green('\n✓ Payment retrieved successfully!'));
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    if (payment.paymentID) {
      console.log(chalk.bold(`Payment ID: ${payment.paymentID}`));
    }
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    if (payment.amount && payment.currency) {
      console.log(`Amount:      ${formatCurrency(payment.amount, payment.currency)}`);
    }
    if (payment.currency) {
      console.log(`Currency:    ${payment.currency}`);
    }
    if (payment.paymentStatus) {
      console.log(`Status:      ${getStatusColor(payment.paymentStatus)}`);
    }
    if (payment.referenceNumber) {
      console.log(`Reference:   ${payment.referenceNumber}`);
    }
    if (payment.createdAt) {
      console.log(`Created:     ${formatDate(payment.createdAt)}`);
    }

    // Show transaction details if available
    if (payment.transactionDetails) {
      console.log(chalk.cyan('\nTransaction Details:'));
      const td = payment.transactionDetails;
      if (td.authorizationCode) {
        console.log(`  Auth Code:   ${td.authorizationCode}`);
      }
      if (td.responseCode) {
        console.log(`  Response:    ${td.responseCode}`);
      }
      if (td.isoResponseCode) {
        console.log(`  ISO Code:    ${td.isoResponseCode}`);
      }
      if (td.terminalMessage) {
        console.log(`  Message:     ${td.terminalMessage}`);
      }
    }

    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  } catch (error) {
    handleError(error, 'Get payment');
  }
}

/**
 * Void/cancel a payment
 * Reference: Moneris API supports canceling payments
 */
async function voidPayment(paymentId: string): Promise<void> {
  const config = getConfig();
  const token = loadToken();

  if (!token) {
    console.error(chalk.red('\n✗ Not authenticated'));
    console.log(chalk.yellow('Please run: moneris-cli-no-postman auth'));
    process.exit(1);
  }

  console.log(chalk.blue(`\n❌ Voiding payment ${paymentId}...`));

  try {
    const client = createApiClient(token.access_token, config.baseUrl);

    // POST /merchants/{merchantId}/payments/{paymentId}/void
    const response = await client.post<PaymentResponse>(
      `/merchants/${config.merchantId}/payments/${paymentId}/void`,
      {}
    );

    const payment = response.data;

    console.log(chalk.green('\n✓ Payment voided successfully!'));
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    if (payment.paymentID) {
      console.log(chalk.bold(`Payment ID: ${payment.paymentID}`));
    }
    if (payment.paymentStatus) {
      console.log(`Status:      ${getStatusColor(payment.paymentStatus)}`);
    }
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  } catch (error) {
    handleError(error, 'Void payment');
  }
}

/**
 * Test penny value simulator
 * Reference: https://api-developer.moneris.com/responsehandling
 * In test environment, the cents value determines success/failure
 */
async function testPayment(cents: number): Promise<void> {
  const config = getConfig();

  if (config.environment !== 'sandbox') {
    console.error(chalk.red('\n✗ Test payments only work in sandbox environment'));
    console.log(chalk.yellow('Please set MONERIS_ENV=sandbox'));
    process.exit(1);
  }

  const amount = `1.${cents.toString().padStart(2, '0')}`;

  console.log(chalk.blue('\n🧪 Testing payment with Penny Value Simulator...'));
  console.log(chalk.gray(`Test amount: $${amount} (cents value ${cents} determines the response)`));

  await createPayment(
    amount,
    'CAD',
    '4242424242424242', // Test card
    '12',
    '25',
    '123',
    `Test payment - penny value ${cents}`,
    `test-${Date.now()}`
  );
}

// ============================================================================
// CLI SETUP
// ============================================================================

const program = new Command();

program
  .name('moneris-cli-no-postman')
  .description('A beautiful CLI for Moneris payment gateway (built from REST API docs)')
  .version('1.0.0');

// Auth command
program
  .command('auth')
  .description('Authenticate with Moneris OAuth 2.0 and save access token')
  .action(async () => {
    await authenticate();
  });

// Create payment command
program
  .command('create-payment')
  .description('Create a new payment (purchase = authorize + capture)')
  .requiredOption('-a, --amount <amount>', 'Payment amount (e.g., 10.50)')
  .option('-c, --currency <currency>', 'Currency code (e.g., USD, CAD)', 'CAD')
  .option('--card <number>', 'Card number (test: 4242424242424242)')
  .option('--exp-month <month>', 'Expiry month (MM)')
  .option('--exp-year <year>', 'Expiry year (YY)')
  .option('--cvd <cvd>', 'Card verification digits')
  .option('-d, --description <description>', 'Payment description')
  .option('-r, --reference <reference>', 'Payment reference number')
  .action(async (options) => {
    await createPayment(
      options.amount,
      options.currency,
      options.card,
      options.expMonth,
      options.expYear,
      options.cvd,
      options.description,
      options.reference
    );
  });

// Get payment command
program
  .command('get-payment')
  .description('Get payment details by ID')
  .requiredOption('-i, --id <paymentId>', 'Payment ID')
  .action(async (options) => {
    await getPayment(options.id);
  });

// Void payment command
program
  .command('void-payment')
  .description('Void/cancel a payment')
  .requiredOption('-i, --id <paymentId>', 'Payment ID to void')
  .action(async (options) => {
    await voidPayment(options.id);
  });

// Test payment command (Penny Value Simulator)
program
  .command('test-payment')
  .description('Create a test payment using Penny Value Simulator (sandbox only)')
  .requiredOption('-p, --pennies <cents>', 'Cents value (00-99) that determines response', parseInt)
  .action(async (options) => {
    if (options.pennies < 0 || options.pennies > 99) {
      console.error(chalk.red('✗ Pennies must be between 0 and 99'));
      process.exit(1);
    }
    await testPayment(options.pennies);
  });

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

// Parse commands
program.parse(process.argv);
