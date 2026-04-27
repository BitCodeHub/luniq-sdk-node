export interface HPulseOptions {
  apiKey: string;
  endpoint: string;
  environment?: string;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  redactPII?: boolean;
}

export interface TrackArgs {
  visitorId: string;
  accountId?: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
}

export interface FlagsArgs {
  visitorId: string;
  accountId?: string;
  traits?: Record<string, unknown>;
}

export class Luniq {
  constructor(opts: HPulseOptions);
  track(name: string, args: TrackArgs): void;
  identify(args: { visitorId: string; accountId?: string; traits?: Record<string, unknown> }): void;
  flags(args: FlagsArgs): Promise<Record<string, string | boolean>>;
  flag(visitorId: string, key: string): string | boolean;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export default Luniq;
