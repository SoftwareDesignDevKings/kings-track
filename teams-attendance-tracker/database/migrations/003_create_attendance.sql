-- Create attendance_records table
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    join_time TIMESTAMP NOT NULL,
    leave_time TIMESTAMP,
    duration_minutes INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'present',
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_attendance_entry UNIQUE(meeting_id, student_id, join_time)
);

-- Create indexes for better query performance
CREATE INDEX idx_attendance_meeting_id ON attendance_records(meeting_id);
CREATE INDEX idx_attendance_student_id ON attendance_records(student_id);
CREATE INDEX idx_attendance_join_time ON attendance_records(join_time);
CREATE INDEX idx_attendance_status ON attendance_records(status);

-- Add check constraint for valid status values
ALTER TABLE attendance_records ADD CONSTRAINT check_attendance_status
    CHECK (status IN ('present', 'late', 'absent', 'partial'));

-- Add check constraint to ensure leave_time is after join_time
ALTER TABLE attendance_records ADD CONSTRAINT check_attendance_times
    CHECK (leave_time IS NULL OR leave_time > join_time);

-- Add comments for documentation
COMMENT ON TABLE attendance_records IS 'Stores attendance records for students in meetings';
COMMENT ON COLUMN attendance_records.duration_minutes IS 'Duration of attendance in minutes';
COMMENT ON COLUMN attendance_records.status IS 'Attendance status: present, late, absent, or partial';
