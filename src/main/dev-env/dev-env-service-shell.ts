/** POSIX shells exit with the service, so a crash shows as an exited terminal with its code. */
export function getDevEnvServiceShellCommand(command: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? command : `${command}; exit`
}
