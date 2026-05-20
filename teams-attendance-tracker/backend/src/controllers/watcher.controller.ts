import { Request, Response, NextFunction } from 'express';
import { folderWatcherService } from '../services/folder-watcher.service';
import logger from '../config/logger';

/**
 * Get watcher status
 */
export const getWatcherStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const status = folderWatcherService.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Error in getWatcherStatus:', error);
    next(error);
  }
};

/**
 * Start the folder watcher
 */
export const startWatcher = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (folderWatcherService.isRunning()) {
      res.json({ success: true, message: 'Watcher is already running' });
      return;
    }

    await folderWatcherService.start();
    const status = folderWatcherService.getStatus();

    res.json({
      success: true,
      message: `Watcher started. Watching: ${status.watchFolder}`,
      data: status,
    });
  } catch (error: any) {
    logger.error('Error starting watcher:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to start watcher',
    });
  }
};

/**
 * Stop the folder watcher
 */
export const stopWatcher = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await folderWatcherService.stop();
    res.json({
      success: true,
      message: 'Watcher stopped',
      data: folderWatcherService.getStatus(),
    });
  } catch (error) {
    logger.error('Error stopping watcher:', error);
    next(error);
  }
};

/**
 * Update watcher configuration
 */
export const updateWatcherConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { watchFolder, processedFolder } = req.body;

    if (!watchFolder && !processedFolder) {
      res.status(400).json({
        success: false,
        message: 'Provide at least one of: watchFolder, processedFolder',
      });
      return;
    }

    await folderWatcherService.updateConfig({ watchFolder, processedFolder });
    const status = folderWatcherService.getStatus();

    res.json({
      success: true,
      message: 'Watcher configuration updated',
      data: status,
    });
  } catch (error: any) {
    logger.error('Error updating watcher config:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update configuration',
    });
  }
};

/**
 * Scan and process all existing files in the watch folder
 */
export const scanExistingFiles = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const count = await folderWatcherService.scanExistingFiles();
    const history = folderWatcherService.getHistory(20);

    res.json({
      success: true,
      message: `Scanned and processed ${count} files`,
      data: { filesScanned: count, history },
    });
  } catch (error: any) {
    logger.error('Error scanning files:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to scan files',
    });
  }
};

/**
 * Get watcher import history
 */
export const getWatcherHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const history = folderWatcherService.getHistory(limit);

    res.json({
      success: true,
      data: history,
      count: history.length,
    });
  } catch (error) {
    logger.error('Error in getWatcherHistory:', error);
    next(error);
  }
};
