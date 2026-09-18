export interface SlFailurePolicy {
  slWarnings: string;
  unprotectedSince: Date;
}

export function buildSlFailurePolicy(errorMessage: string, now: () => Date = () => new Date()): SlFailurePolicy {
  return {
    slWarnings: `SL_CREATION_FAILED:${errorMessage}`,
    unprotectedSince: now(),
  };
}

export function isCloseOnSlFailureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLOSE_ON_SL_FAILURE === 'true';
}
