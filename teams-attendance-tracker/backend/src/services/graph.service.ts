import { Client } from '@microsoft/microsoft-graph-client';
import logger from '../config/logger';
import { GraphMeeting, GraphAttendanceRecord } from '../types';
import { validateToken } from '../config/auth';

/**
 * Microsoft Graph API Service - DELEGATED PERMISSIONS
 *
 * Uses access tokens provided from frontend (user login)
 * NO client secrets or application permissions required
 */
export class GraphService {
  private accessToken: string | null = null;

  /**
   * Initialize Graph client with user access token from frontend
   */
  async initialize(userAccessToken: string): Promise<void> {
    try {
      if (!validateToken(userAccessToken)) {
        throw new Error('Invalid access token provided');
      }

      this.accessToken = userAccessToken;
      logger.info('Graph API client initialized with user token');
    } catch (error) {
      logger.error('Failed to initialize Graph API client', error);
      throw error;
    }
  }

  /**
   * Get authenticated Graph client
   */
  private getClient(): Client {
    if (!this.accessToken) {
      throw new Error('Graph client not initialized. Provide user access token first.');
    }

    return Client.init({
      authProvider: (done) => {
        done(null, this.accessToken!);
      },
    });
  }

  /**
   * Get online meetings for a specific user
   */
  async getUserMeetings(userId: string, startDate?: Date, endDate?: Date): Promise<GraphMeeting[]> {
    try {
      const client = this.getClient();

      let query = `/users/${userId}/calendar/events`;
      const params: string[] = ['$filter=isOnlineMeeting eq true'];

      if (startDate) {
        params.push(`start/dateTime ge '${startDate.toISOString()}'`);
      }
      if (endDate) {
        params.push(`end/dateTime le '${endDate.toISOString()}'`);
      }

      if (params.length > 0) {
        query += `?${params.join(' and ')}`;
      }

      const response = await client.api(query).get();

      logger.info(`Retrieved ${response.value.length} meetings for user ${userId}`);
      return response.value;
    } catch (error) {
      logger.error(`Failed to get meetings for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Get attendance reports for a specific meeting
   */
  async getMeetingAttendanceReports(userId: string, meetingId: string): Promise<any[]> {
    try {
      const client = this.getClient();

      const response = await client
        .api(`/users/${userId}/onlineMeetings/${meetingId}/attendanceReports`)
        .get();

      logger.info(`Retrieved ${response.value.length} attendance reports for meeting ${meetingId}`);
      return response.value;
    } catch (error) {
      logger.error(`Failed to get attendance reports for meeting ${meetingId}`, error);
      throw error;
    }
  }

  /**
   * Get attendance records for a specific attendance report
   */
  async getAttendanceRecords(
    userId: string,
    meetingId: string,
    reportId: string
  ): Promise<GraphAttendanceRecord[]> {
    try {
      const client = this.getClient();

      const response = await client
        .api(`/users/${userId}/onlineMeetings/${meetingId}/attendanceReports/${reportId}/attendanceRecords`)
        .get();

      logger.info(`Retrieved ${response.value.length} attendance records for report ${reportId}`);
      return response.value;
    } catch (error) {
      logger.error(`Failed to get attendance records for report ${reportId}`, error);
      throw error;
    }
  }

  /**
   * Get user information by email
   */
  async getUserByEmail(email: string): Promise<any> {
    try {
      const client = this.getClient();

      const response = await client
        .api(`/users/${email}`)
        .select('id,displayName,mail,userPrincipalName')
        .get();

      logger.info(`Retrieved user information for ${email}`);
      return response;
    } catch (error) {
      logger.error(`Failed to get user by email ${email}`, error);
      throw error;
    }
  }

  /**
   * Get all users in the organization (for syncing students)
   */
  async getAllUsers(filter?: string): Promise<any[]> {
    try {
      const client = this.getClient();

      let query = '/users';
      const params = ['$select=id,displayName,mail,userPrincipalName'];

      if (filter) {
        params.push(`$filter=${filter}`);
      }

      query += `?${params.join('&')}`;

      const response = await client.api(query).get();

      logger.info(`Retrieved ${response.value.length} users from organization`);
      return response.value;
    } catch (error) {
      logger.error('Failed to get all users', error);
      throw error;
    }
  }

  /**
   * Get a specific online meeting by ID
   */
  async getOnlineMeeting(userId: string, meetingId: string): Promise<any> {
    try {
      const client = this.getClient();

      const response = await client
        .api(`/users/${userId}/onlineMeetings/${meetingId}`)
        .get();

      logger.info(`Retrieved online meeting ${meetingId}`);
      return response;
    } catch (error) {
      logger.error(`Failed to get online meeting ${meetingId}`, error);
      throw error;
    }
  }

  /**
   * Get call records (alternative method for attendance data)
   */
  async getCallRecords(startDate: Date, endDate: Date): Promise<any[]> {
    try {
      const client = this.getClient();

      const response = await client
        .api('/communications/callRecords')
        .filter(`startDateTime ge ${startDate.toISOString()} and endDateTime le ${endDate.toISOString()}`)
        .get();

      logger.info(`Retrieved ${response.value.length} call records`);
      return response.value;
    } catch (error) {
      logger.error('Failed to get call records', error);
      throw error;
    }
  }
}

// Export singleton instance
export const graphService = new GraphService();
