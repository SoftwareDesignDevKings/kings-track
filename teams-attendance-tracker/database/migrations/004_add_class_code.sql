-- Add class_code column to meetings for grouping by class
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS class_code VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_meetings_class_code ON meetings(class_code);

COMMENT ON COLUMN meetings.class_code IS 'Class/course code extracted from meeting title (e.g., 11SENX, 12SENX)';
