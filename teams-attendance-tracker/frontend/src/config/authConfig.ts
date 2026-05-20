import { Configuration, PopupRequest } from '@azure/msal-browser';

/**
 * Configuration object to be passed to MSAL instance on creation
 */
export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.REACT_APP_AZURE_CLIENT_ID || '',
    authority: `https://login.microsoftonline.com/${process.env.REACT_APP_AZURE_TENANT_ID}`,
    redirectUri: process.env.REACT_APP_REDIRECT_URI || 'http://localhost:3000',
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
};

/**
 * Scopes you add here will be prompted for user consent during sign-in.
 * DELEGATED PERMISSIONS ONLY - no admin consent required
 */
export const loginRequest: PopupRequest = {
  scopes: [
    'User.Read',
    'OnlineMeetings.Read',
    'Calendars.Read',
    'OnlineMeetingArtifact.Read.All', // For attendance reports
  ],
};

/**
 * Add here the scopes to request when obtaining an access token for MS Graph API
 */
export const graphConfig = {
  graphMeEndpoint: 'https://graph.microsoft.com/v1.0/me',
};
