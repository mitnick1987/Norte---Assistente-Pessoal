import { coreMessages001 } from './001_core_messages.js';
import { coreSettings002 } from './002_core_settings.js';
import { coreJobs003 } from './003_core_jobs.js';
import { coreOutboxMessages004 } from './004_core_outbox_messages.js';
import { coreMessagesProcessingStatus005 } from './005_core_messages_processing_status.js';
import { coreMessagesMedia006 } from './006_core_messages_media.js';

export const coreMigrations = [
  coreMessages001,
  coreSettings002,
  coreJobs003,
  coreOutboxMessages004,
  coreMessagesProcessingStatus005,
  coreMessagesMedia006,
];
