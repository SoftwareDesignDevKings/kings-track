import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'path';

// Import routes
import studentsRoutes from './routes/students.routes';
import meetingsRoutes from './routes/meetings.routes';
import attendanceRoutes from './routes/attendance.routes';
import watcherRoutes from './routes/watcher.routes';
import canvasRoutes from './routes/canvas.routes';

// Import middleware
import { errorHandler, notFound } from './middleware/error.middleware';
import { optionalAuth } from './middleware/auth.middleware';

// Import config
import logger from './config/logger';
import { getAuthUrl, acquireTokenByCode } from './config/auth';
import { graphService } from './services/graph.service';
import { folderWatcherService } from './services/folder-watcher.service';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Authentication routes - DISABLED for Option 1 (CSV Import Mode)
// No authentication required when using CSV import
// app.get('/auth/login', async (req, res, next) => {
//   try {
//     const authUrl = await getAuthUrl();
//     res.json({
//       success: true,
//       authUrl,
//     });
//   } catch (error) {
//     logger.error('Error getting auth URL:', error);
//     next(error);
//   }
// });

// app.get('/auth/callback', async (req, res, next) => {
//   try {
//     const { code } = req.query;
//
//     if (!code || typeof code !== 'string') {
//       res.status(400).json({
//         success: false,
//         message: 'Authorization code is required',
//       });
//       return;
//     }
//
//     const tokenResponse = await acquireTokenByCode(code);
//
//     // In a real app, you'd create a session or JWT here
//     res.json({
//       success: true,
//       message: 'Authentication successful',
//       account: tokenResponse.account,
//     });
//   } catch (error) {
//     logger.error('Error in auth callback:', error);
//     next(error);
//   }
// });

// app.post('/auth/logout', (req, res) => {
//   // Clear session/tokens
//   res.json({
//     success: true,
//     message: 'Logged out successfully',
//   });
// });

// API routes
app.use('/api/students', optionalAuth, studentsRoutes);
app.use('/api/meetings', optionalAuth, meetingsRoutes);
app.use('/api/attendance', optionalAuth, attendanceRoutes);
app.use('/api/watcher', optionalAuth, watcherRoutes);
app.use('/api/canvas', optionalAuth, canvasRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Teams Attendance Tracker API',
    version: '1.0.0',
    endpoints: {
      students: '/api/students',
      meetings: '/api/meetings',
      attendance: '/api/attendance',
      auth: {
        login: '/auth/login',
        callback: '/auth/callback',
        logout: '/auth/logout',
      },
    },
  });
});

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    logger.info('Starting server...');

    app.listen(PORT, async () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`API: http://localhost:${PORT}/api`);
      logger.info(`Health check: http://localhost:${PORT}/health`);

      // Auto-start folder watcher if enabled
      const watchEnabled = process.env.WATCH_ENABLED !== 'false';
      if (watchEnabled) {
        try {
          await folderWatcherService.start();
          const status = folderWatcherService.getStatus();
          logger.info(`Folder watcher active. Watching: ${status.watchFolder}`);
        } catch (watchError: any) {
          logger.warn(`Folder watcher failed to start: ${watchError.message}`);
          logger.warn('You can start it manually via POST /api/watcher/start');
        }
      } else {
        logger.info('Folder watcher disabled (WATCH_ENABLED=false)');
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  logger.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();

export default app;
