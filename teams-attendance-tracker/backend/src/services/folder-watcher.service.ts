import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import { teamsCSVParserService, TeamsCSVImportResult } from './teams-csv-parser.service';
import logger from '../config/logger';

/**
 * Import history entry
 */
export interface WatcherHistoryEntry {
  fileName: string;
  timestamp: Date;
  success: boolean;
  meetingTitle: string;
  recordsImported: number;
  error?: string;
}

/**
 * Watcher status info
 */
export interface WatcherStatus {
  running: boolean;
  watchFolder: string;
  processedFolder: string;
  filesProcessedToday: number;
  totalFilesProcessed: number;
  lastImportTime: Date | null;
  lastImportFile: string | null;
}

/**
 * Folder Watcher Service
 *
 * Watches a designated folder for new Teams attendance CSV files.
 * When a new CSV is detected, it's automatically parsed and imported,
 * then moved to a 'processed' subfolder.
 */
export class FolderWatcherService {
  private watcher: FSWatcher | null = null;
  private watchFolder: string;
  private processedFolder: string;
  private history: WatcherHistoryEntry[] = [];
  private totalFilesProcessed = 0;
  private processing = new Set<string>();

  constructor() {
    this.watchFolder = this.resolveFolder(process.env.WATCH_FOLDER || '~/Downloads');
    this.processedFolder = this.resolveFolder(process.env.PROCESSED_FOLDER || './processed');
  }

  /**
   * Resolve ~ and relative paths
   */
  private resolveFolder(folderPath: string): string {
    if (folderPath.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, folderPath.slice(1));
    }
    return path.resolve(folderPath);
  }

  /**
   * Start watching the configured folder
   */
  async start(): Promise<void> {
    if (this.watcher) {
      logger.warn('Folder watcher is already running');
      return;
    }

    // Ensure watch folder exists
    if (!fs.existsSync(this.watchFolder)) {
      throw new Error(`Watch folder does not exist: ${this.watchFolder}`);
    }

    // Ensure processed folder exists
    if (!fs.existsSync(this.processedFolder)) {
      fs.mkdirSync(this.processedFolder, { recursive: true });
      logger.info(`Created processed folder: ${this.processedFolder}`);
    }

    this.watcher = chokidar.watch(this.watchFolder, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        this.processedFolder, // ignore processed folder
      ],
      persistent: true,
      ignoreInitial: true, // Don't process existing files on start
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2s after last write before processing
        pollInterval: 500,
      },
      depth: 0, // Only watch top-level (no subdirectories)
    });

    this.watcher.on('add', (filePath) => this.handleNewFile(filePath));
    this.watcher.on('error', (error) => {
      logger.error('Folder watcher error:', error);
    });

    logger.info(`Folder watcher started. Watching: ${this.watchFolder}`);
    logger.info(`Processed files will be moved to: ${this.processedFolder}`);
  }

  /**
   * Scan and process all existing CSV files in the watch folder
   */
  async scanExistingFiles(): Promise<number> {
    if (!fs.existsSync(this.watchFolder)) {
      throw new Error(`Watch folder does not exist: ${this.watchFolder}`);
    }

    const files = fs.readdirSync(this.watchFolder)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => path.join(this.watchFolder, f));

    logger.info(`Scanning ${files.length} existing CSV files in ${this.watchFolder}`);

    let processed = 0;
    for (const filePath of files) {
      await this.handleNewFile(filePath);
      processed++;
    }

    return processed;
  }

  /**
   * Stop the folder watcher
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      logger.info('Folder watcher stopped');
    }
  }

  /**
   * Check if the watcher is currently running
   */
  isRunning(): boolean {
    return this.watcher !== null;
  }

  /**
   * Get current watcher status
   */
  getStatus(): WatcherStatus {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const filesProcessedToday = this.history.filter(
      (h) => h.timestamp >= today && h.success
    ).length;

    const lastSuccess = [...this.history].reverse().find((h) => h.success);

    return {
      running: this.isRunning(),
      watchFolder: this.watchFolder,
      processedFolder: this.processedFolder,
      filesProcessedToday,
      totalFilesProcessed: this.totalFilesProcessed,
      lastImportTime: lastSuccess?.timestamp || null,
      lastImportFile: lastSuccess?.fileName || null,
    };
  }

  /**
   * Get import history (most recent first)
   */
  getHistory(limit = 50): WatcherHistoryEntry[] {
    return [...this.history].reverse().slice(0, limit);
  }

  /**
   * Update the watch folder path
   */
  async updateConfig(config: { watchFolder?: string; processedFolder?: string }): Promise<void> {
    const wasRunning = this.isRunning();

    if (wasRunning) {
      await this.stop();
    }

    if (config.watchFolder) {
      this.watchFolder = this.resolveFolder(config.watchFolder);
    }
    if (config.processedFolder) {
      this.processedFolder = this.resolveFolder(config.processedFolder);
    }

    if (wasRunning) {
      await this.start();
    }
  }

  /**
   * Read a file and convert to UTF-8 string, handling UTF-16 LE/BE BOMs
   */
  private readFileAsUtf8(filePath: string): string {
    const buffer = fs.readFileSync(filePath);

    // Check for UTF-16 LE BOM (FF FE)
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
      return buffer.slice(2).toString('utf16le');
    }

    // Check for UTF-16 BE BOM (FE FF)
    if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
      // Swap bytes for big-endian
      const swapped = Buffer.alloc(buffer.length - 2);
      for (let i = 2; i < buffer.length - 1; i += 2) {
        swapped[i - 2] = buffer[i + 1];
        swapped[i - 1] = buffer[i];
      }
      return swapped.toString('utf16le');
    }

    // Check for UTF-8 BOM (EF BB BF)
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return buffer.slice(3).toString('utf-8');
    }

    // Default to UTF-8
    return buffer.toString('utf-8');
  }

  /**
   * Handle a new file detected in the watch folder
   */
  private async handleNewFile(filePath: string): Promise<void> {
    const fileName = path.basename(filePath);

    // Only process CSV files
    if (!fileName.toLowerCase().endsWith('.csv')) {
      return;
    }

    // Prevent double-processing
    if (this.processing.has(filePath)) {
      return;
    }
    this.processing.add(filePath);

    logger.info(`New CSV detected: ${fileName}`);

    try {
      // Read file content, handling UTF-16 encoding (Teams exports UTF-16 LE with BOM)
      const content = this.readFileAsUtf8(filePath);

      // Quick check: is this likely a Teams attendance report?
      if (!this.looksLikeTeamsAttendance(content, fileName)) {
        logger.debug(`Skipping ${fileName} - doesn't look like a Teams attendance report`);
        this.processing.delete(filePath);
        return;
      }

      // Parse and import
      const result = await teamsCSVParserService.parseAndImport(content, fileName);

      // Record history
      this.history.push({
        fileName,
        timestamp: new Date(),
        success: result.success,
        meetingTitle: result.meetingTitle,
        recordsImported: result.attendanceRecordsCreated,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      });

      if (result.success) {
        this.totalFilesProcessed++;
        // Move to processed folder
        await this.moveToProcessed(filePath, fileName);
        logger.info(
          `Successfully imported ${fileName}: ` +
          `${result.attendanceRecordsCreated} records for "${result.meetingTitle}"`
        );
      } else {
        logger.warn(`Import failed for ${fileName}: ${result.errors.join(', ')}`);
      }
    } catch (error: any) {
      logger.error(`Error processing ${fileName}:`, error);
      this.history.push({
        fileName,
        timestamp: new Date(),
        success: false,
        meetingTitle: '',
        recordsImported: 0,
        error: error.message,
      });
    } finally {
      this.processing.delete(filePath);
    }
  }

  /**
   * Check if a file's content looks like a Teams attendance report
   * (to avoid processing unrelated CSVs in the Downloads folder)
   */
  private looksLikeTeamsAttendance(content: string, fileName: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerName = fileName.toLowerCase();

    // Check filename patterns Teams typically uses
    if (
      lowerName.includes('attendance') ||
      lowerName.includes('meetingattendance') ||
      lowerName.includes('meeting_attendance')
    ) {
      return true;
    }

    // Check content for Teams-specific markers
    if (
      lowerContent.includes('1. summary') ||
      lowerContent.includes('2. participants') ||
      (lowerContent.includes('full name') && lowerContent.includes('join')) ||
      (lowerContent.includes('participant') && lowerContent.includes('duration'))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Move a processed file to the processed folder
   */
  private async moveToProcessed(filePath: string, fileName: string): Promise<void> {
    try {
      // Add timestamp to avoid naming conflicts
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const destName = `${timestamp}_${fileName}`;
      const destPath = path.join(this.processedFolder, destName);

      fs.renameSync(filePath, destPath);
      logger.debug(`Moved ${fileName} to processed folder`);
    } catch (error: any) {
      // If rename fails (cross-device), try copy + delete
      try {
        const destName = `${Date.now()}_${fileName}`;
        const destPath = path.join(this.processedFolder, destName);
        fs.copyFileSync(filePath, destPath);
        fs.unlinkSync(filePath);
        logger.debug(`Copied and removed ${fileName} to processed folder`);
      } catch (copyError: any) {
        logger.warn(`Could not move ${fileName} to processed folder: ${copyError.message}`);
      }
    }
  }
}

// Singleton instance
export const folderWatcherService = new FolderWatcherService();
