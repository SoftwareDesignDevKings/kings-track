import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';
import logger from '../config/logger';

/**
 * Authentication middleware
 * Validates JWT tokens and Microsoft authentication
 *
 * TODO: Implement proper JWT validation when auth is fully set up
 * For now, this is a placeholder that can be enhanced
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new AppError('No authorization header provided', 401);
    }

    const token = authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
      throw new AppError('No token provided', 401);
    }

    // TODO: Implement JWT verification
    // For development, we'll allow all requests
    if (process.env.NODE_ENV === 'development') {
      logger.info('Auth middleware: Development mode, allowing request');
      next();
      return;
    }

    // In production, verify the token
    // const decoded = jwt.verify(token, process.env.JWT_SECRET || '');
    // req.user = decoded;

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError('Authentication failed', 401));
    }
  }
};

/**
 * Optional authentication middleware
 * Continues even if auth fails
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader) {
      const token = authHeader.split(' ')[1];

      if (token) {
        // TODO: Verify token and attach user to request
        // const decoded = jwt.verify(token, process.env.JWT_SECRET || '');
        // req.user = decoded;
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

/**
 * Role-based authorization middleware
 * Checks if user has required role
 */
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // TODO: Implement role checking
    // if (!req.user) {
    //   return next(new AppError('Not authenticated', 401));
    // }

    // if (!roles.includes(req.user.role)) {
    //   return next(new AppError('Not authorized to access this resource', 403));
    // }

    next();
  };
};
