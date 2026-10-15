import type { Config } from "../../../packages/core/config.js";
import { ContactsRepository } from "../../../packages/modules/contacts/public-api.js";
import { Database } from "../../../packages/persistence/database.js";
import { ApiTokensRepository } from "../../../packages/modules/identity/public-api.js";
import { MfaRepository } from "../../../packages/modules/identity/public-api.js";
import { IdentityRepository } from "../../../packages/modules/identity/public-api.js";
import { AdministrationRepository } from "../../../packages/modules/identity/public-api.js";
import { AccountsRepository } from "../../../packages/modules/accounts/public-api.js";
import { ConversationsRepository } from "../../../packages/modules/conversations/public-api.js";
import { AgentsRepository } from "../../../packages/modules/agents/public-api.js";
import { ReportingRepository } from "../../../packages/modules/reporting/public-api.js";
import { CredentialCipher } from "../../../packages/security/cipher.js";
import {
  AgentOrchestrator,
  ProviderRegistry,
} from "../../../packages/modules/agents/application/agent-orchestrator.js";
import { OpenAiAdapter } from "../../../packages/adapters/llm-openai/openai.adapter.js";
import { LocalLlmAdapter } from "../../../packages/adapters/llm-local/local.adapter.js";
import { eventQueue } from "../../../packages/queue/queue.js";
export class AppServices {
  readonly contacts;
  readonly tokens;
  readonly mfa;
  readonly identity;
  readonly admin;
  readonly accounts;
  readonly conversations;
  readonly agents;
  readonly reports;
  readonly cipher;
  readonly providers;
  readonly orchestrator;
  readonly queue;
  constructor(
    readonly db: Database,
    readonly config: Config,
  ) {
    this.cipher = new CredentialCipher(config.MASTER_KEY);
    this.contacts = new ContactsRepository(db);
    this.tokens = new ApiTokensRepository(db);
    this.mfa = new MfaRepository(db, this.cipher);
    this.identity = new IdentityRepository(db, this.mfa);
    this.admin = new AdministrationRepository(db);
    this.accounts = new AccountsRepository(db);
    this.conversations = new ConversationsRepository(db);
    this.agents = new AgentsRepository(db);
    this.reports = new ReportingRepository(db);
    this.providers = new ProviderRegistry([
      ...(config.OPENAI_API_KEY || config.LLM_API_KEY
        ? [new OpenAiAdapter(config.OPENAI_API_KEY || config.LLM_API_KEY!)]
        : []),
      ...(config.LOCAL_LLM_URL
        ? [new LocalLlmAdapter(config.LOCAL_LLM_URL)]
        : []),
    ]);
    this.orchestrator = new AgentOrchestrator(this.agents, this.providers);
    this.queue = eventQueue(config.REDIS_URL);
  }
  async close() {
    await this.queue.close();
    await this.db.close();
  }
}
