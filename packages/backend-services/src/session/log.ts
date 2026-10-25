/**
 * One structured log line per event.
 *
 * Workers Logs indexes JSON fields, so `{ level, event, …fields }` is
 * queryable by event name and its values. Tests can assert the same fields by
 * parsing the line, without matching a prose message. Failures always go to
 * the console method that matches their level, so the platform's own level
 * filters keep working.
 */

type LogLevel = 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

/**
 * The bridge's logger. `event` names what happened (`wake.skipped`,
 * `login.failed`); `fields` carries the structured context beside it.
 */
export const log = {
  info(event: string, fields: LogFields = {}): void {
    write('info', event, fields);
  },
  warn(event: string, fields: LogFields = {}): void {
    write('warn', event, fields);
  },
  error(event: string, fields: LogFields = {}): void {
    write('error', event, fields);
  },
};

function write(level: LogLevel, event: string, fields: LogFields): void {
  const line = encode(level, event, fields);
  switch (level) {
    case 'error': {
      console.error(line);
      return;
    }
    case 'warn': {
      console.warn(line);
      return;
    }
    default: {
      console.log(line);
    }
  }
}

function encode(level: LogLevel, event: string, fields: LogFields): string {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    record[key] = logValue(value);
  }
  // Set after the fields so a field can never shadow the envelope.
  record.level = level;
  record.event = event;
  try {
    return JSON.stringify(record);
  } catch {
    // A circular field (or one JSON cannot represent) must not turn a log
    // call into a second failure; the event still names what happened.
    return JSON.stringify({ level, event, fields: '[unserializable]' });
  }
}

function logValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack !== undefined && { stack: value.stack }),
    };
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}
