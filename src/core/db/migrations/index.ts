import { coreMessages001 } from './001_core_messages.js';
import { coreSettings002 } from './002_core_settings.js';
import { coreJobs003 } from './003_core_jobs.js';
import { coreOutboxMessages004 } from './004_core_outbox_messages.js';
import { coreMessagesProcessingStatus005 } from './005_core_messages_processing_status.js';
import { coreMessagesMedia006 } from './006_core_messages_media.js';
import { coreJobsCanceladoStatus007 } from './007_core_jobs_cancelado_status.js';
import { coreMessagesProactive008 } from './008_core_messages_proactive.js';
import { coreOutboxAnchorRitual009 } from './009_core_outbox_anchor_ritual.js';

export const coreMigrations = [
  coreMessages001,
  coreSettings002,
  coreJobs003,
  coreOutboxMessages004,
  coreMessagesProcessingStatus005,
  coreMessagesMedia006,
  coreJobsCanceladoStatus007,
  coreMessagesProactive008,
  coreOutboxAnchorRitual009,
];
