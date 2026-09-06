/**
 * Read-only check of what the configured Onshape key is permitted to do.
 *
 * Makes exactly one request — GET /users/sessioninfo — and writes nothing, to
 * Onshape or to disk. It exists so the capability model can be checked against
 * a real account without running the write experiment, and so the scope-bit
 * assumptions in src/capabilities.mjs can be re-tested when a key changes.
 *
 * It still refuses to run without --yes: it uses the live credentials in the
 * configuration file and makes a real outbound request, and a script that
 * reaches the network the moment it is typed is a script people run by
 * accident. Nothing it prints identifies the account: the name is reduced to
 * its length and the email is never read.
 *
 * Usage: node scripts/inspect-capabilities.mjs --yes [--config <path>]
 */
import { getConfig } from '../src/config.mjs';
import { probeCredentials } from '../src/connection-probe.mjs';
import { deriveCapabilities, SCOPE_BITS, summarizeScopes } from '../src/capabilities.mjs';

function usage() {
  return [
    'Usage: node scripts/inspect-capabilities.mjs --yes [--config <path>]',
    '',
    '  --yes            Required. Acknowledges that this makes one live Onshape request.',
    '  --config <path>  Read a specific configuration file (same rule as the server).',
    '',
    'Read-only: it calls GET /users/sessioninfo and writes nothing.'
  ].join('\n');
}

const argv = process.argv.slice(2);
if (!argv.includes('--yes')) {
  process.stderr.write(`${usage()}\n`);
  process.exit(2);
}

const config = getConfig({ argv: process.argv });
if (config.authMode === 'none') {
  process.stderr.write('No Onshape credentials are configured, so there is nothing to inspect.\n');
  process.exit(1);
}
if (config.authMode === 'oauth') {
  process.stderr.write('OAuth credentials belong to a browser session, not to this process. Run this with an API key.\n');
  process.exit(1);
}

process.stdout.write(`Onshape: ${config.onshapeBaseUrl} (auth=${config.authMode})\n`);

const probe = await probeCredentials(config);
if (!probe.ok) {
  process.stderr.write(`Probe failed: ${probe.reason}${probe.status ? ` (status ${probe.status})` : ''}\n`);
  process.exit(1);
}

const capabilities = deriveCapabilities({ sessionInfo: probe.sessionInfo });
const scopes = capabilities.scopes;

// The account name is the one field here that identifies a person, so only its
// shape is reported. The email is never read at all: pickSessionInfo drops it
// before this script ever sees the response.
process.stdout.write(`Account name: ${probe.sessionInfo?.name ? `${probe.sessionInfo.name.length} characters` : 'absent'}\n`);
process.stdout.write(`Plan: ${capabilities.plan.group ?? 'unknown'} (private documents: ${capabilities.plan.canCreatePrivateDocuments ? 'yes' : 'no'})\n`);
process.stdout.write(`Roles: ${capabilities.roles.join(', ') || 'none reported'}\n`);
process.stdout.write(`Scope mask: ${scopes.raw ?? 'absent'}\n`);
process.stdout.write(`Granted: ${summarizeScopes(scopes) || 'unknown'}\n`);
for (const name of Object.keys(SCOPE_BITS)) {
  process.stdout.write(`  ${name.padEnd(8)} ${scopes.known ? (scopes[name] ? 'yes' : 'no') : 'unknown'}\n`);
}
if (scopes.unknownBits?.length) {
  process.stdout.write(`Bits this app does not recognise: ${scopes.unknownBits.join(', ')}\n`);
}

process.stdout.write('\nPer feature:\n');
for (const [key, record] of Object.entries(capabilities.features)) {
  process.stdout.write(`  ${key.padEnd(16)} ${record.allowed ? 'allowed' : 'refused'}  ${record.reason}\n`);
}
