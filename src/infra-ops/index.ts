export { EmailAlerter } from './email-alerter.js';
export type { EmailAlerterConfig } from './email-alerter.js';
export { buildMailer } from './build-mailer.js';
export type { MailerConfig } from './build-mailer.js';
export type { Mailer, MailMessage } from './mailer.js';
export { AlertDispatchRepository } from './alert-dispatch-repository.js';
export {
  buildInfraOpsModule,
  DEAD_MANS_SWITCH_JOB_TYPE,
  COST_MONITOR_JOB_TYPE,
  DEAD_MANS_SWITCH_INTERVAL_MINUTES_SETTING,
  COST_MONITOR_INTERVAL_MINUTES_SETTING,
  SCHEDULER_STALE_AFTER_MS_SETTING,
  SCHEDULER_STALE_AFTER_MS_DEFAULT,
  ALERT_ANTI_FLOOD_WINDOW_MS_SETTING,
  ALERT_ANTI_FLOOD_WINDOW_MS_DEFAULT,
} from './manifest.js';
export type { BuildInfraOpsModuleDeps } from './manifest.js';
export { ensureRecurringJob } from './job-scheduling.js';
