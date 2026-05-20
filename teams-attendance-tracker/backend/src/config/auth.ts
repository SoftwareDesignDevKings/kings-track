import dotenv from 'dotenv';

dotenv.config();

/**
 * Auth configuration for DELEGATED PERMISSIONS ONLY
 *
 * This version uses tokens provided by the frontend (from user login)
 * NO CLIENT SECRET NEEDED - uses delegated permissions
 *
 * The frontend (React) handles user authentication with MSAL browser
 * and passes the access token to the backend for API calls.
 */

export const validateToken = (token: string): boolean => {
  // Basic validation - check if token exists and looks valid
  if (!token || token.length < 50) {
    return false;
  }

  // Check if it's a JWT (has 3 parts separated by dots)
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  return true;
};

// For backward compatibility, we keep these exports but they're not used
// in delegated flow since frontend handles authentication
export const getAuthUrl = () => {
  throw new Error('Auth URL not needed for delegated permissions. Frontend handles authentication.');
};

export const acquireTokenByCode = async (code: string) => {
  throw new Error('Token by code not needed for delegated permissions. Frontend handles authentication.');
};

export const acquireTokenByClientCredentials = async () => {
  throw new Error('Client credentials not used in delegated permissions mode.');
};
