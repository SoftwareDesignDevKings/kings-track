-- Create students table
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    student_id VARCHAR(50),
    azure_ad_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_students_email ON students(email);
CREATE INDEX idx_students_azure_ad_id ON students(azure_ad_id);
CREATE INDEX idx_students_student_id ON students(student_id);

-- Add comments for documentation
COMMENT ON TABLE students IS 'Stores student information for attendance tracking';
COMMENT ON COLUMN students.azure_ad_id IS 'Microsoft Azure AD user ID for authentication';
COMMENT ON COLUMN students.student_id IS 'Custom student identification number';
