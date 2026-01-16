/**
 * Transfer queue types and interfaces
 */

/**
 * Task status enum
 */
export type TaskStatus =
  | 'pending'      // Waiting to start
  | 'running'      // Currently transferring
  | 'paused'       // Paused by user
  | 'completed'    // Successfully completed
  | 'failed'       // Failed after all retries
  | 'cancelled';   // Cancelled by user

/**
 * Transfer type
 */
export type TransferType = 'upload' | 'download';

/**
 * Transfer priority
 */
export type TransferPriority = 'high' | 'normal' | 'low';

/**
 * Transfer direction for display
 */
export type TransferDirection = 'to' | 'from';

/**
 * Transfer task interface
 */
export interface TransferTask {
  // Identification
  id: string;                        // Unique task identifier
  type: TransferType;                // Upload or download
  status: TaskStatus;                // Current status
  priority: TransferPriority;        // Transfer priority (auto-calculated based on file size)

  // Host information
  hostId: string;                    // Host configuration ID
  hostName: string;                  // Display name for host

  // File information
  localPath: string;                 // Local file/directory path
  remotePath: string;                // Remote file/directory path
  fileName: string;                  // File or directory name
  fileSize: number;                  // Total size in bytes
  isDirectory: boolean;              // Whether it's a directory transfer

  // Progress tracking
  transferred: number;               // Bytes transferred
  speed: number;                     // Current speed in bytes/sec
  progress: number;                  // Progress percentage (0-100)

  // Timing information
  createdAt: Date;                   // When task was created
  startedAt?: Date;                  // When transfer started
  completedAt?: Date;                // When completed/failed/cancelled
  estimatedTime?: number;            // Estimated remaining time in ms

  // Retry mechanism
  retryCount: number;                // Current retry attempt
  maxRetries: number;                // Maximum retry attempts
  lastError?: string;                // Last error message

  // Cancellation support
  abortController?: AbortController; // For cancelling transfers
}

/**
 * Options for creating a transfer task
 */
export interface CreateTransferTaskOptions {
  type: TransferType;
  hostId: string;
  hostName: string;
  localPath: string;
  remotePath: string;
  fileName?: string;                 // Will be inferred from localPath if not provided
  fileSize?: number;                 // Will be determined during transfer if not provided
  isDirectory?: boolean;             // Will be determined from file stats if not provided
  maxRetries?: number;               // Defaults to 3
}

/**
 * Transfer queue interface
 */
export interface TransferQueue {
  tasks: TransferTask[];             // All tasks in queue
  concurrent: number;                // Max concurrent transfers
  running: Map<string, TransferTask>; // Currently running tasks
  paused: Set<string>;               // Paused task IDs
}

/**
 * Transfer statistics
 */
export interface TransferStats {
  total: number;
  pending: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalBytes: number;
  transferredBytes: number;
  averageSpeed: number;
}

/**
 * Queue status
 */
export interface QueueStatus {
  isPaused: boolean;
  maxConcurrent: number;
  runningCount: number;
  stats: TransferStats;
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier?: number;
}

/**
 * Transfer task event types
 */
export interface TransferTaskEvent {
  task: TransferTask;
  timestamp: Date;
}

export interface TransferQueueEvent {
  tasks: TransferTask[];
  timestamp: Date;
}

/**
 * Transfer history item (persisted)
 */
export interface TransferHistoryItem {
  id: string;
  type: TransferType;
  status: TaskStatus;
  priority: TransferPriority;
  hostName: string;
  localPath: string;
  remotePath: string;
  fileName: string;
  fileSize: number;
  isDirectory: boolean;
  createdAt: string;                 // ISO string
  completedAt?: string;              // ISO string
  duration?: number;                 // Duration in ms
  averageSpeed?: number;             // Average speed
  error?: string;                    // Error message if failed
}

/**
 * History filter options
 */
export interface HistoryFilterOptions {
  type?: TransferType;               // Filter by transfer type
  status?: TaskStatus;               // Filter by status
  hostId?: string;                   // Filter by host
  startDate?: Date;                  // Filter by start date
  endDate?: Date;                    // Filter by end date
  limit?: number;                    // Limit number of results
}
