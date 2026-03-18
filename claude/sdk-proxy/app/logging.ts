export type LogLevel = 'info' | 'debug'

const LOG_LEVELS: Record<LogLevel, number> = {
  info: 1,
  debug: 2,
}

function parseLogLevel(value = process.env.LOG_LEVEL): LogLevel {
  if (value?.trim().toLowerCase() === 'debug') return 'debug'
  return 'info'
}

const currentLogLevel = parseLogLevel()

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[currentLogLevel] >= LOG_LEVELS[level]
}

export function getLogLevel(): LogLevel {
  return currentLogLevel
}

export function info(message: string): void {
  if (shouldLog('info')) console.log(message)
}

export function debug(message: string): void {
  if (shouldLog('debug')) console.log(message)
}
