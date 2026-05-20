import { query } from '../config/database';
import { Student, CreateStudentDTO } from '../types';

export class StudentModel {
  static async findAll(): Promise<Student[]> {
    const result = await query('SELECT * FROM students ORDER BY name ASC');
    return result.rows;
  }

  static async findById(id: string): Promise<Student | null> {
    const result = await query('SELECT * FROM students WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async findByEmail(email: string): Promise<Student | null> {
    const result = await query('SELECT * FROM students WHERE email = $1', [email]);
    return result.rows[0] || null;
  }

  static async findByAzureAdId(azureAdId: string): Promise<Student | null> {
    const result = await query('SELECT * FROM students WHERE azure_ad_id = $1', [azureAdId]);
    return result.rows[0] || null;
  }

  static async create(data: CreateStudentDTO): Promise<Student> {
    const result = await query(
      `INSERT INTO students (email, name, student_id, azure_ad_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [data.email, data.name, data.student_id, data.azure_ad_id]
    );
    return result.rows[0];
  }

  static async update(id: string, data: Partial<CreateStudentDTO>): Promise<Student | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (data.email !== undefined) {
      fields.push(`email = $${paramCount++}`);
      values.push(data.email);
    }
    if (data.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(data.name);
    }
    if (data.student_id !== undefined) {
      fields.push(`student_id = $${paramCount++}`);
      values.push(data.student_id);
    }
    if (data.azure_ad_id !== undefined) {
      fields.push(`azure_ad_id = $${paramCount++}`);
      values.push(data.azure_ad_id);
    }

    fields.push(`updated_at = $${paramCount++}`);
    values.push(new Date());
    values.push(id);

    const result = await query(
      `UPDATE students SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await query('DELETE FROM students WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  static async search(searchTerm: string): Promise<Student[]> {
    const result = await query(
      `SELECT * FROM students
       WHERE name ILIKE $1 OR email ILIKE $1 OR student_id ILIKE $1
       ORDER BY name ASC`,
      [`%${searchTerm}%`]
    );
    return result.rows;
  }
}
