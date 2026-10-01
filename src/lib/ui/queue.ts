export type QueueAction = {
    id: string;
    kind: string;
    state: string;
    attempts: number;
    lastError: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    nextAttemptAt?: Date | string;
    connectionLabel?: string;
    instanceId?: string | null;
    progress?: { processed?: number; total?: number | null; phase?: string } | null;
  };

export const jobWaiting = (action: QueueAction) => !!(action.state === 'pending' && action.nextAttemptAt && new Date(action.nextAttemptAt).getTime() > Date.now());
