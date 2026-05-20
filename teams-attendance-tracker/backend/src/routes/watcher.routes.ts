import { Router } from 'express';
import {
  getWatcherStatus,
  startWatcher,
  stopWatcher,
  updateWatcherConfig,
  getWatcherHistory,
  scanExistingFiles,
} from '../controllers/watcher.controller';

const router = Router();

/**
 * @route   GET /api/watcher/status
 * @desc    Get folder watcher status
 */
router.get('/status', getWatcherStatus);

/**
 * @route   POST /api/watcher/start
 * @desc    Start the folder watcher
 */
router.post('/start', startWatcher);

/**
 * @route   POST /api/watcher/stop
 * @desc    Stop the folder watcher
 */
router.post('/stop', stopWatcher);

/**
 * @route   PUT /api/watcher/config
 * @desc    Update watcher configuration (watch folder path, etc.)
 */
router.put('/config', updateWatcherConfig);

/**
 * @route   POST /api/watcher/scan
 * @desc    Scan and process all existing files in the watch folder
 */
router.post('/scan', scanExistingFiles);

/**
 * @route   GET /api/watcher/history
 * @desc    Get recent import history
 */
router.get('/history', getWatcherHistory);

export default router;
