import { query } from '../config/database';
import { AttendanceRecord, CreateAttendanceRecordDTO, AttendanceReportFilter } from '../types';

export class AttendanceRecordModel {
  static async findAll(limit = 100, offset = 0): Promise<AttendanceRecord[]> {
    const result = await query(
      'SELECT * FROM attendance_records ORDER BY join_time DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows;
  }

  static async findById(id: string): Promise<AttendanceRecord | null> {
    const result = await query('SELECT * FROM attendance_records WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async findByMeeting(meetingId: string): Promise<AttendanceRecord[]> {
    const result = await query(
      `SELECT ar.*, s.name as student_name, s.email as student_email
       FROM attendance_records ar
       JOIN students s ON ar.student_id = s.id
       WHERE ar.meeting_id = $1
       ORDER BY ar.join_time ASC`,
      [meetingId]
    );
    return result.rows;
  }

  static async findByStudent(studentId: string): Promise<AttendanceRecord[]> {
    const result = await query(
      `SELECT ar.*, m.title as meeting_title, m.start_time, m.end_time
       FROM attendance_records ar
       JOIN meetings m ON ar.meeting_id = m.id
       WHERE ar.student_id = $1
       ORDER BY m.start_time DESC`,
      [studentId]
    );
    return result.rows;
  }

  static async findByStudentAndMeeting(
    studentId: string,
    meetingId: string
  ): Promise<AttendanceRecord[]> {
    const result = await query(
      `SELECT * FROM attendance_records
       WHERE student_id = $1 AND meeting_id = $2
       ORDER BY join_time ASC`,
      [studentId, meetingId]
    );
    return result.rows;
  }

  static async create(data: CreateAttendanceRecordDTO): Promise<AttendanceRecord> {
    const result = await query(
      `INSERT INTO attendance_records (meeting_id, student_id, join_time, leave_time, duration_minutes, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.meeting_id,
        data.student_id,
        data.join_time,
        data.leave_time,
        data.duration_minutes,
        data.status
      ]
    );
    return result.rows[0];
  }

  static async update(
    id: string,
    data: Partial<CreateAttendanceRecordDTO>
  ): Promise<AttendanceRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (data.join_time !== undefined) {
      fields.push(`join_time = $${paramCount++}`);
      values.push(data.join_time);
    }
    if (data.leave_time !== undefined) {
      fields.push(`leave_time = $${paramCount++}`);
      values.push(data.leave_time);
    }
    if (data.duration_minutes !== undefined) {
      fields.push(`duration_minutes = $${paramCount++}`);
      values.push(data.duration_minutes);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(data.status);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const result = await query(
      `UPDATE attendance_records SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM attendance_records WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  static async getAttendanceReport(filter: AttendanceReportFilter): Promise<AttendanceRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (filter.student_id) {
      conditions.push(`ar.student_id = $${paramCount++}`);
      values.push(filter.student_id);
    }

    if (filter.meeting_id) {
      conditions.push(`ar.meeting_id = $${paramCount++}`);
      values.push(filter.meeting_id);
    }

    if (filter.start_date) {
      conditions.push(`m.start_time >= $${paramCount++}`);
      values.push(filter.start_date);
    }

    if (filter.end_date) {
      conditions.push(`m.end_time <= $${paramCount++}`);
      values.push(filter.end_date);
    }

    if (filter.status) {
      conditions.push(`ar.status = $${paramCount++}`);
      values.push(filter.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT ar.*, s.name as student_name, s.email as student_email,
              m.title as meeting_title, m.start_time, m.end_time
       FROM attendance_records ar
       JOIN students s ON ar.student_id = s.id
       JOIN meetings m ON ar.meeting_id = m.id
       ${whereClause}
       ORDER BY m.start_time DESC, s.name ASC`,
      values
    );

    return result.rows;
  }

  static async getAttendanceStats(studentId: string): Promise<{
    total_meetings: number;
    present: number;
    late: number;
    absent: number;
    attendance_rate: number;
  }> {
    const result = await query(
      `SELECT
         COUNT(DISTINCT m.id) as total_meetings,
         COUNT(CASE WHEN ar.status = 'present' THEN 1 END) as present,
         COUNT(CASE WHEN ar.status = 'late' THEN 1 END) as late,
         COUNT(CASE WHEN ar.status = 'absent' THEN 1 END) as absent,
         ROUND(
           (COUNT(CASE WHEN ar.status IN ('present', 'late') THEN 1 END)::numeric /
            NULLIF(COUNT(DISTINCT m.id), 0) * 100),
           2
         ) as attendance_rate
       FROM meetings m
       LEFT JOIN attendance_records ar ON m.id = ar.meeting_id AND ar.student_id = $1
       WHERE m.end_time < NOW()`,
      [studentId]
    );

    return result.rows[0];
  }

  static async bulkCreate(records: CreateAttendanceRecordDTO[]): Promise<AttendanceRecord[]> {
    if (records.length === 0) return [];

    const values: unknown[] = [];
    const placeholders: string[] = [];

    records.forEach((record, index) => {
      const offset = index * 6;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
      );
      values.push(
        record.meeting_id,
        record.student_id,
        record.join_time,
        record.leave_time,
        record.duration_minutes,
        record.status
      );
    });

    const result = await query(
      `INSERT INTO attendance_records (meeting_id, student_id, join_time, leave_time, duration_minutes, status)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (meeting_id, student_id, join_time) DO NOTHING
       RETURNING *`,
      values
    );

    return result.rows;
  }
}
