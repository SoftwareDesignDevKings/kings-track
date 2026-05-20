import axios, { AxiosInstance } from 'axios';
import logger from '../config/logger';

interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state: string;
  enrollment_term_id: number;
}

interface CanvasUser {
  id: number;
  name: string;
  sortable_name: string;
  login_id: string;
  email?: string;
}

interface CanvasEnrollment {
  id: number;
  user_id: number;
  course_id: number;
  enrollment_state: string;
  user: CanvasUser;
}

export interface CanvasStudent {
  canvas_user_id: number;
  name: string;
  email: string;
  login_id: string;
  sortable_name: string;
}

export interface CanvasCourseInfo {
  id: number;
  name: string;
  course_code: string;
  class_code: string; // Extracted class code (e.g., "11SENX")
}

class CanvasService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.CANVAS_API_URL || '';
    const token = process.env.CANVAS_API_TOKEN || '';

    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v1`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  /**
   * Check if Canvas is configured
   */
  isConfigured(): boolean {
    return !!(process.env.CANVAS_API_URL && process.env.CANVAS_API_TOKEN);
  }

  /**
   * Get all courses where the user is a teacher (current year only)
   */
  async getCourses(): Promise<CanvasCourseInfo[]> {
    const currentYear = new Date().getFullYear();
    const allCourses: CanvasCourse[] = [];
    let page = 1;

    while (true) {
      const response = await this.client.get<CanvasCourse[]>('/courses', {
        params: {
          enrollment_type: 'teacher',
          per_page: 100,
          page,
        },
      });

      allCourses.push(...response.data);

      // Check for next page via Link header
      const linkHeader = response.headers['link'] || '';
      if (!linkHeader.includes('rel="next"')) break;
      page++;
    }

    // Filter to current year, available, online/external classes only (class code contains "X")
    return allCourses
      .filter(c => c.workflow_state === 'available')
      .filter(c => c.course_code.includes(`_${currentYear}`))
      .map(c => ({
        id: c.id,
        name: c.name,
        course_code: c.course_code,
        class_code: this.extractClassCode(c.course_code),
      }))
      .filter(c => c.class_code !== '')
      .filter(c => /X\d?$/.test(c.class_code)); // Only external/online classes (ends with X or X+digit)
  }

  /**
   * Extract class code from Canvas course_code
   * Canvas format: "11SENX_2026" → "11SENX"
   * Canvas format: "11SENX2_2026" → "11SENX2"
   */
  private extractClassCode(courseCode: string): string {
    const match = courseCode.match(/^(\d{1,2}[A-Z]{2,}\d?)_/);
    return match ? match[1] : '';
  }

  /**
   * Get all active student enrollments for a course
   */
  async getCourseStudents(courseId: number): Promise<CanvasStudent[]> {
    const students: CanvasStudent[] = [];
    let page = 1;

    while (true) {
      const response = await this.client.get<CanvasEnrollment[]>(
        `/courses/${courseId}/enrollments`,
        {
          params: {
            'type[]': 'StudentEnrollment',
            'state[]': 'active',
            'include[]': 'email',
            per_page: 100,
            page,
          },
        }
      );

      for (const enrollment of response.data) {
        if (enrollment.user && enrollment.enrollment_state === 'active') {
          students.push({
            canvas_user_id: enrollment.user.id,
            name: enrollment.user.name,
            email: enrollment.user.email || '',
            login_id: enrollment.user.login_id,
            sortable_name: enrollment.user.sortable_name,
          });
        }
      }

      const linkHeader = response.headers['link'] || '';
      if (!linkHeader.includes('rel="next"')) break;
      page++;
    }

    return students;
  }

  /**
   * Sync a specific course's roster: fetch students from Canvas and upsert into local DB
   */
  async syncCourseRoster(courseId: number, classCode: string): Promise<{
    studentsFound: number;
    studentsCreated: number;
    studentsUpdated: number;
  }> {
    const { StudentModel } = await import('../models/Student');
    const { query } = await import('../config/database');

    const canvasStudents = await this.getCourseStudents(courseId);
    let created = 0;
    let updated = 0;

    for (const cs of canvasStudents) {
      if (!cs.email) continue;

      // Try to find existing student by email
      let student = await StudentModel.findByEmail(cs.email);

      if (!student) {
        // Create new student
        student = await StudentModel.create({
          name: cs.name,
          email: cs.email,
          student_id: cs.login_id,
        });
        created++;
      } else if (!student.student_id && cs.login_id) {
        // Update student_id if missing
        await query(
          'UPDATE students SET student_id = $1 WHERE id = $2',
          [cs.login_id, student.id]
        );
        updated++;
      }

      // Upsert into canvas_enrollments table
      await query(
        `INSERT INTO canvas_enrollments (student_id, canvas_course_id, canvas_user_id, class_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, canvas_course_id) DO UPDATE SET
           canvas_user_id = EXCLUDED.canvas_user_id,
           class_code = EXCLUDED.class_code,
           updated_at = NOW()`,
        [student.id, courseId, cs.canvas_user_id, classCode]
      );
    }

    logger.info(`Canvas sync for ${classCode} (course ${courseId}): ${canvasStudents.length} students, ${created} created, ${updated} updated`);

    return {
      studentsFound: canvasStudents.length,
      studentsCreated: created,
      studentsUpdated: updated,
    };
  }

  /**
   * Get the base class code by stripping the trailing class number after X.
   * e.g., "11SENX2" → "11SENX", "12SENX3" → "12SENX", "11SENX" → "11SENX"
   */
  getBaseClassCode(classCode: string): string {
    // Strip trailing digit after X: "11SENX2" → "11SENX"
    const match = classCode.match(/^(.+X)\d?$/);
    return match ? match[1] : classCode;
  }

  /**
   * Get the enrolled students for a class code from local DB (after sync).
   * Uses amalgamated lookup — e.g., "11SENX" fetches students from 11SENX, 11SENX2, etc.
   * Students are deduplicated by student_id in case they appear in multiple related classes.
   */
  async getClassRoster(classCode: string): Promise<Array<{ student_id: string; name: string; email: string }>> {
    const { query } = await import('../config/database');
    const baseCode = this.getBaseClassCode(classCode);

    const result = await query(
      `SELECT DISTINCT s.id as student_id, s.name, s.email
       FROM canvas_enrollments ce
       JOIN students s ON s.id = ce.student_id
       WHERE ce.class_code LIKE $1
       ORDER BY s.name`,
      [baseCode + '%']
    );
    return result.rows;
  }
}

export const canvasService = new CanvasService();
