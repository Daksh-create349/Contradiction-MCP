import { SyncService } from '../connectors/syncService.js';
import { DiscoveryService } from '../discovery/discoveryService.js';
import { logger } from '../utils/logger.js';

export interface ScheduledTask {
  id: string;
  name: string;
  intervalMs: number;
  lastRun?: Date;
  nextRun: Date;
  runCount: number;
  lastStatus?: 'success' | 'failed';
  lastError?: string;
  isRunning: boolean;
}

export class SchedulerService {
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly taskCallbacks = new Map<string, () => Promise<void>>();
  private readonly timerHandles = new Map<string, NodeJS.Timeout>();
  private isRunning = false;

  constructor(
    private readonly syncService?: SyncService,
    private readonly discoveryService?: DiscoveryService,
  ) {}

  public registerTask(id: string, name: string, intervalMs: number, fn: () => Promise<void>): void {
    if (this.tasks.has(id)) {
      throw new Error(`Scheduled task with id '${id}' is already registered`);
    }

    const task: ScheduledTask = {
      id,
      name,
      intervalMs,
      nextRun: new Date(Date.now() + intervalMs),
      runCount: 0,
      isRunning: false,
    };

    this.tasks.set(id, task);
    this.taskCallbacks.set(id, fn);

    if (this.isRunning) {
      this.scheduleTask(task, fn);
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    for (const [id, task] of this.tasks.entries()) {
      const fn = this.taskCallbacks.get(id);
      if (fn && !this.timerHandles.has(id)) {
        this.scheduleTask(task, fn);
      }
    }
    logger.info('In-process task scheduler started', { activeTasks: this.tasks.size });
  }

  public stop(): void {
    this.isRunning = false;
    for (const [, handle] of this.timerHandles.entries()) {
      clearTimeout(handle);
    }
    this.timerHandles.clear();
    logger.info('In-process task scheduler stopped');
  }

  private scheduleTask(task: ScheduledTask, fn: () => Promise<void>): void {
    if (!this.isRunning) return;

    const timer = setTimeout(async () => {
      if (!this.isRunning || task.isRunning) return;
      task.isRunning = true;
      task.lastRun = new Date();

      try {
        logger.info(`Executing scheduled task: ${task.name}`, { taskId: task.id });
        await fn();
        task.lastStatus = 'success';
        task.lastError = undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        task.lastStatus = 'failed';
        task.lastError = msg;
        logger.error(`Scheduled task '${task.name}' failed`, { taskId: task.id, error: msg });
      } finally {
        task.isRunning = false;
        task.runCount++;
        task.nextRun = new Date(Date.now() + task.intervalMs);
        if (this.isRunning) {
          this.scheduleTask(task, fn);
        }
      }
    }, task.intervalMs);

    this.timerHandles.set(task.id, timer);
  }

  public getStatus(): { isRunning: boolean; tasks: ScheduledTask[] } {
    return {
      isRunning: this.isRunning,
      tasks: Array.from(this.tasks.values()),
    };
  }
}
