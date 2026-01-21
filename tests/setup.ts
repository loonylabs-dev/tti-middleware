/**
 * Jest Setup File
 *
 * Loads environment variables from .env for integration tests.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });
