import { query } from '../config/database';
import { Meeting, CreateMeetingDTO } from '../types';

export class MeetingModel {
  static async findAll(limit = 50, offset = 0): Promise<Meeting[]> {
    const result = await query(
      'SELECT * FROM meetings ORDER BY start_time DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows;
  }

  static async findById(id: string): Promise<Meeting | null> {
    const result = await query('SELECT * FROM meetings WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async findByTeamsMeetingId(teamsMeetingId: string): Promise<Meeting | null> {
    const result = await query(
      'SELECT * FROM meetings WHERE teams_meeting_id = $1',
      [teamsMeetingId]
    );
    return result.rows[0] || null;
  }

  static async findByClassCode(classCode: string): Promise<Meeting[]> {
    const result = await query(
      'SELECT * FROM meetings WHERE class_code = $1 ORDER BY start_time DESC',
      [classCode]
    );
    return result.rows;
  }

  static async getDistinctClassCodes(): Promise<string[]> {
    const result = await query(
      'SELECT DISTINCT class_code FROM meetings WHERE class_code IS NOT NULL ORDER BY class_code'
    );
    return result.rows.map((r: any) => r.class_code);
  }

  static async findByDateRange(startDate: Date, endDate: Date): Promise<Meeting[]> {
    const result = await query(
      `SELECT * FROM meetings
       WHERE start_time >= $1 AND end_time <= $2
       ORDER BY start_time DESC`,
      [startDate, endDate]
    );
    return result.rows;
  }

  static async findByOrganizer(organizerEmail: string): Promise<Meeting[]> {
    const result = await query(
      'SELECT * FROM meetings WHERE organizer_email = $1 ORDER BY start_time DESC',
      [organizerEmail]
    );
    return result.rows;
  }

  static async create(data: CreateMeetingDTO): Promise<Meeting> {
    const result = await query(
      `INSERT INTO meetings (teams_meeting_id, title, start_time, end_time, organizer_email, meeting_url, class_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.teams_meeting_id,
        data.title,
        data.start_time,
        data.end_time,
        data.organizer_email,
        data.meeting_url,
        data.class_code
      ]
    );
    return result.rows[0];
  }

  static async update(id: string, data: Partial<CreateMeetingDTO>): Promise<Meeting | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (data.title !== undefined) {
      fields.push(`title = $${paramCount++}`);
      values.push(data.title);
    }
    if (data.start_time !== undefined) {
      fields.push(`start_time = $${paramCount++}`);
      values.push(data.start_time);
    }
    if (data.end_time !== undefined) {
      fields.push(`end_time = $${paramCount++}`);
      values.push(data.end_time);
    }
    if (data.organizer_email !== undefined) {
      fields.push(`organizer_email = $${paramCount++}`);
      values.push(data.organizer_email);
    }
    if (data.meeting_url !== undefined) {
      fields.push(`meeting_url = $${paramCount++}`);
      values.push(data.meeting_url);
    }
    if (data.class_code !== undefined) {
      fields.push(`class_code = $${paramCount++}`);
      values.push(data.class_code);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const result = await query(
      `UPDATE meetings SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM meetings WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  static async getUpcoming(limit = 10): Promise<Meeting[]> {
    const result = await query(
      `SELECT * FROM meetings
       WHERE start_time > NOW()
       ORDER BY start_time ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  static async getRecent(limit = 10): Promise<Meeting[]> {
    const result = await query(
      `SELECT * FROM meetings
       WHERE end_time < NOW()
       ORDER BY end_time DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
}
