import {
    installAgentIntegrations,
    loadAvailableModelIds,
    parseAgentSetupArgs,
    type AgentSetupOptions
} from '../src/cli/agentSetup.ts';

const requested = parseAgentSetupArgs(process.argv.slice(2));
const options: AgentSetupOptions = { ...requested, agents: ['pi'] };
const models = await loadAvailableModelIds(options.baseUrl);
const [result] = await installAgentIntegrations(options, models);

console.log(`Pi provider "freeai" with ${models.length} models: ${result.status} ${result.path}`);
